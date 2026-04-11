const libre = require('libreoffice-convert');
const { PDFDocument } = require('pdf-lib');
const { promisify } = require('util');
const convertAsync = promisify(libre.convert);

/**
 * Converts a file buffer to a PDF buffer based on its mimetype.
 * Supports PDF (raw), Images (JPG/PNG), and Office docs (DOCX/PPTX via LibreOffice).
 */
async function convertToPdf(buffer, mimetype) {
    if (mimetype === 'application/pdf') {
        return buffer;
    }

    // Handle Images
    if (mimetype.startsWith('image/')) {
        const pdfDoc = await PDFDocument.create();
        let image;
        try {
            if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
                image = await pdfDoc.embedJpg(buffer);
            } else if (mimetype === 'image/png') {
                image = await pdfDoc.embedPng(buffer);
            } else {
                throw new Error('Unsupported image format. Use JPG or PNG.');
            }

            const { width, height } = image.scale(1);
            const page = pdfDoc.addPage([width, height]);
            page.drawImage(image, {
                x: 0,
                y: 0,
                width,
                height,
            });
            
            return await pdfDoc.save();
        } catch (err) {
            console.error('Image to PDF conversion error:', err);
            throw new Error('Failed to convert image to PDF.');
        }
    }

    // Handle Office Documents
    const officeTypes = [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-powerpoint'
    ];

    if (officeTypes.includes(mimetype)) {
        try {
            // This requires LibreOffice installed in the environment (Docker/Linux)
            return await convertAsync(buffer, '.pdf', undefined);
        } catch (err) {
            console.error('LibreOffice conversion error:', err);
            throw new Error('Failed to convert office document. Ensure LibreOffice is installed inside the environment.');
        }
    }

    throw new Error(`Unsupported file type: ${mimetype}`);
}

module.exports = { convertToPdf };
