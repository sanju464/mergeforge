const path = require('path');
const fs = require('fs');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mergeRouter = require('./routes/merge');

const app = express();
const PORT = process.env.PORT || 5000;

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: false, // For local dev if needed
}));
app.use(cors());
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});
app.use('/api/', limiter);

// Routes
app.use('/api/merge', mergeRouter);

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug Route
app.get('/debug', (req, res) => {
    const publicDir = path.join(__dirname, 'public');
    const assetsDir = path.join(publicDir, 'assets');
    
    let publicFiles = [];
    let assetFiles = [];
    
    try {
        if (fs.existsSync(publicDir)) {
            publicFiles = fs.readdirSync(publicDir);
        }
        if (fs.existsSync(assetsDir)) {
            assetFiles = fs.readdirSync(assetsDir);
        }
        res.json({ publicDir, assetsDir, publicFiles, assetFiles });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve Static Frontend (in Production)
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all must be LAST
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(500).send('Frontend build not found. Ensure the client is built and copied to server/public.');
    }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`MergeForge Backend running on port ${PORT}`);
});
