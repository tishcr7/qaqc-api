// You'll need to install: express, mssql, cors, firebase-admin
const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');

// --- FIREBASE SETUP ---
// Point to the credentials file you downloaded (you already had this)
const serviceAccount = require('./firebase-credentials.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const firestoreDb = admin.firestore();
// --- END FIREBASE SETUP ---

const app = express();
app.use(cors());
app.use(express.json()); // Middleware to parse incoming JSON data

// --- Your SQL Server Configuration ---
// (You can optionally move these into environment variables for safety)
const dbConfig = {
    user: 'LSP',
    password: 'Loongsen@2025',
    server: 'svr-mits.database.windows.net',
    database: 'LoongSen',
    options: {
        encrypt: true,
        trustServerCertificate: false
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Simple root route (useful for Render / health check)
app.get('/', (req, res) => {
  res.send('QC API is alive');
});

// --- API Endpoint to GET Job Order Details (from SQL Server) ---
app.get('/api/joborder/:id', async (req, res) => {
    const jobOrderId = req.params.id;
    console.log(`Received GET request for Job Order: ${jobOrderId}`);
    const queryString = `SELECT P.Qty, P.Weight, C.Measurement, P.StkCode, C.SizeWidth, C.SizeLength, C.SizeThick, Cust.CustName FROM dbo.tblCS_Config_ProductNo AS C INNER JOIN dbo.tblProd_Trans_PlanMs AS P ON C.StkCode = P.StkCode LEFT OUTER JOIN dbo.tblCS_Trans_OrderMs AS O ON P.OrderID = O.TransID LEFT OUTER JOIN dbo.tblSystem_Config_CustInfo AS Cust ON O.CustCode = Cust.CustID WHERE (C.bStatus = 1 AND P.LotNo = @jobOrderId)`;
    try {
        let pool = await sql.connect(dbConfig);
        const result = await pool.request().input('jobOrderId', sql.NVarChar, jobOrderId).query(queryString);
        if (result.recordset.length > 0) {
            const record = result.recordset[0];
            const orderQty = (record.Measurement === 'KGS') ? record.Weight : record.Qty;
            res.json({ CustomerName: record.CustName, OrderQty: orderQty, Width: record.SizeWidth, Length: record.SizeLength, Thickness: record.SizeThick });
        } else {
            res.status(404).json({ error: 'Job Order not found' });
        }
    } catch (err) {
        console.error("SQL error", err);
        res.status(500).json({ error: 'Database query failed' });
    }
});

// --- NEW API Endpoint to POST Inspection Data (to Firebase) ---
app.post('/api/inspections', async (req, res) => {
    const inspectionData = req.body;
    console.log("Received POST request to save inspection:", inspectionData && inspectionData.jobOrder);

    if (!inspectionData || !inspectionData.jobOrder) {
        return res.status(400).json({ error: 'Missing inspection data or Job Order.' });
    }

    try {
        // Add a server-side timestamp for accuracy
        inspectionData.serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
        
        // Add the data to a Firestore collection called "inspections"
        const docRef = await firestoreDb.collection('inspections').add(inspectionData);
        
        console.log("Successfully saved inspection with ID:", docRef.id);
        res.status(201).json({ message: 'Inspection saved successfully!', id: docRef.id });

    } catch (error) {
        console.error("Error saving to Firestore:", error);
        res.status(500).json({ error: 'Failed to save inspection data.' });
    }
});

// ==== IMPORTANT: use Render's provided PORT or fallback to 3000 for local dev ====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
});
// --- HEALTH CHECK ---
app.get('/api/health/db', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT 1 as test');
        res.json({ success: true, test: result.recordset[0].test });
    } catch (err) {
        res.status(503).json({ success: false, error: err.message });
    }
});
