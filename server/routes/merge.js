const express = require('express');
const router = express.Router();
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const { convertToPdf } = require('../utils/converter');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const execAsync = promisify(exec);

// Process files in-memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB per file
        files: 20 // Max 20 files per session
    }
});

/**
 * POST /api/merge
 * Expects 'files' as multipart/form-data
 * Optional 'order' parameter to specify the merging sequence
 */
router.post('/', upload.array('files'), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded.' });
        }

        // Get merging order from body (expected as a JSON string of filenames or indices)
        let order;
        try {
            order = req.body.order ? JSON.parse(req.body.order) : null;
        } catch (e) {
            return res.status(400).json({ error: 'Invalid order format. Must be a JSON array.' });
        }

        // Sort files according to order if provided
        let sortedFiles = [...files];
        if (order && Array.isArray(order)) {
            sortedFiles = order.map(id => files.find(f => f.originalname === id || f.filename === id)).filter(Boolean);
            
            // Fallback for cases where files might be missing from order
            if (sortedFiles.length < files.length) {
                const missing = files.filter(f => !sortedFiles.includes(f));
                sortedFiles = [...sortedFiles, ...missing];
            }
        }

        const mergedPdf = await PDFDocument.create();

        for (const file of sortedFiles) {
            try {
                // Convert to PDF buffer
                const pdfBuffer = await convertToPdf(file.buffer, file.mimetype);
                
                // Load the converted PDF
                const pdfDoc = await PDFDocument.load(pdfBuffer);
                const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
                
                copiedPages.forEach((page) => {
                    mergedPdf.addPage(page);
                });
            } catch (err) {
                console.error(`Error processing file ${file.originalname}:`, err);
                // We'll skip individual failures for now or return error? 
                // Better to fail fast for data integrity.
                return res.status(500).json({ error: `Failed to process ${file.originalname}: ${err.message}` });
            }
        }

        // Save PDF to memory
        const mergedPdfBytes = await mergedPdf.save();
        let finalBuffer = Buffer.from(mergedPdfBytes);

        // Handle Encryption
        const password = req.body.password;
        if (password && password.trim() !== '') {
            const tmpDir = os.tmpdir();
            const inputPath = path.join(tmpDir, `input_${Date.now()}.pdf`);
            const outputPath = path.join(tmpDir, `output_${Date.now()}.pdf`);

            try {
                await fs.writeFile(inputPath, finalBuffer);
                
                // qpdf command: --encrypt user-password owner-password key-length -- input output
                const cmd = `qpdf --encrypt "${password}" "${password}" 256 -- "${inputPath}" "${outputPath}"`;
                await execAsync(cmd);
                
                finalBuffer = await fs.readFile(outputPath);
            } catch (err) {
                console.error('Encryption error:', err);
                // If encryption fails, we should probably inform the user but we might fall back? 
                // Security wise, it's better to fail if the user requested a password.
                return res.status(500).json({ error: 'Failed to encrypt PDF with password.' });
            } finally {
                // Cleanup
                try {
                    await fs.unlink(inputPath).catch(() => {});
                    await fs.unlink(outputPath).catch(() => {});
                } catch (e) {}
            }
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="merged_forge.pdf"');
        res.send(finalBuffer);

    } catch (err) {
        console.error('Merge error:', err);
        res.status(500).json({ error: 'An internal error occurred during merging.' });
    }
});

module.exports = router;
