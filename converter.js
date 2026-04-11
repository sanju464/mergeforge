/**
 * Merge Forge — Conversion Engine
 *
 * All processing runs in the browser using CDN-loaded globals:
 *   window.PDFLib  — pdf-lib  (https://unpkg.com/pdf-lib/dist/pdf-lib.min.js)
 *   window.JSZip   — JSZip    (cdnjs jszip 3.10.1)
 *   window.pdfjsLib — PDF.js  (cdnjs pdf.js 3.11.174)
 *
 * Genuinely unsupported pairs throw ConversionError with a plain message
 * ("This format pair cannot be processed in the browser.") — no REST stubs.
 */

export class ConversionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConversionError';
  }
}

// ─── Library access (gates on CDN load) ──────────────────────────────────────

function getPDFLib() {
  if (!window.PDFLib) {
    throw new ConversionError('pdf-lib is still loading — please wait a moment and try again.');
  }
  return window.PDFLib;
}

function getJSZip() {
  if (!window.JSZip) {
    throw new ConversionError('JSZip is still loading — please wait a moment and try again.');
  }
  return window.JSZip;
}

function getPdfjsLib() {
  const lib = window.pdfjsLib;
  if (!lib) {
    throw new ConversionError('PDF.js is still loading — please wait a moment and try again.');
  }
  // Set the worker path if not already set
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  return lib;
}

// ─── Library readiness check (used by App to gate the button) ────────────────

export function librariesReady() {
  return !!(window.PDFLib && window.JSZip && window.pdfjsLib);
}

// ─── Format detection ─────────────────────────────────────────────────────────

const EXT_MAP = {
  pdf: 'PDF',
  png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG',
  gif: 'GIF', webp: 'WEBP', svg: 'SVG',
  docx: 'DOCX', doc: 'DOC', txt: 'TXT',
  pptx: 'PPTX', ppt: 'PPT',
  xlsx: 'XLSX', xls: 'XLS', csv: 'CSV',
  mp4: 'MP4', mp3: 'MP3', wav: 'WAV', webm: 'WEBM',
  zip: 'ZIP', json: 'JSON', xml: 'XML', html: 'HTML', md: 'MD',
};

export function detectFormat(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  return EXT_MAP[ext] || file.type.split('/')[1]?.toUpperCase() || 'UNKNOWN';
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Format sets
const RASTER_FORMATS = new Set(['PNG', 'JPEG', 'WEBP', 'GIF']);
const IMAGE_FORMATS  = new Set(['PNG', 'JPEG', 'WEBP', 'GIF', 'SVG']);
const TEXT_FORMATS   = new Set(['TXT', 'CSV', 'JSON', 'MD']);
const IMAGE_MIME     = { PNG: 'image/png', JPEG: 'image/jpeg', WEBP: 'image/webp', GIF: 'image/gif' };

// ─── File I/O helpers ─────────────────────────────────────────────────────────

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = e => resolve(e.target.result);
    r.onerror = () => reject(new ConversionError(`Could not read file: ${file.name}`));
    r.readAsArrayBuffer(file);
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = e => resolve(e.target.result);
    r.onerror = () => reject(new ConversionError(`Could not read file: ${file.name}`));
    r.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = e => resolve(e.target.result);
    r.onerror = () => reject(new ConversionError(`Could not read file: ${file.name}`));
    r.readAsText(file);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new ConversionError('Failed to decode image.'));
    img.src = src;
  });
}

async function imageToCanvas(file, maxDim = 4096) {
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImageElement(dataUrl);
  let w = img.naturalWidth  || img.width  || 800;
  let h = img.naturalHeight || img.height || 600;
  if (maxDim && (w > maxDim || h > maxDim)) {
    const ratio = maxDim / Math.max(w, h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new ConversionError('Canvas toBlob produced null.')),
      mime,
      quality
    );
  });
}

// ─── Embed an image file as a pdf-lib image object ───────────────────────────

async function embedImageInPDF(pdfDoc, file) {
  const fmt = detectFormat(file);
  if (fmt === 'PNG') {
    const bytes = await readFileAsArrayBuffer(file);
    return await pdfDoc.embedPng(bytes);
  }
  if (fmt === 'JPEG') {
    const bytes = await readFileAsArrayBuffer(file);
    return await pdfDoc.embedJpg(bytes);
  }
  // WEBP, GIF, SVG — rasterize through canvas then embed as JPEG
  const canvas = await imageToCanvas(file, 4096);
  const blob   = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  const bytes  = await blob.arrayBuffer();
  return await pdfDoc.embedJpg(bytes);
}

// ─── Merge any mix of PDFs + images into one PDF ─────────────────────────────

async function mergeFilesToPDF(files, onProgress) {
  const { PDFDocument } = getPDFLib();
  const mergedDoc = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fmt  = detectFormat(file);

    onProgress?.({
      step: 'merging',
      pct: Math.round(((i + 0.5) / files.length) * 88),
      message: `Processing file ${i + 1} of ${files.length} — ${file.name}`,
    });

    if (fmt === 'PDF') {
      let bytes;
      try   { bytes = await readFileAsArrayBuffer(file); }
      catch { throw new ConversionError(`Could not read "${file.name}".`); }
      let srcDoc;
      try   { srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true }); }
      catch { throw new ConversionError(`"${file.name}" is not a valid or readable PDF.`); }
      const copied = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
      copied.forEach(p => mergedDoc.addPage(p));

    } else if (IMAGE_FORMATS.has(fmt)) {
      let pdfImage;
      try   { pdfImage = await embedImageInPDF(mergedDoc, file); }
      catch (err) { throw new ConversionError(`Could not embed "${file.name}": ${err.message}`); }
      const { width, height } = pdfImage.scale(1);
      const page = mergedDoc.addPage([width, height]);
      page.drawImage(pdfImage, { x: 0, y: 0, width, height });

    } else {
      throw new ConversionError(
        `"${file.name}" (${fmt}) cannot be included in a PDF merge. Only PDFs and images are supported.`
      );
    }
  }

  onProgress?.({ step: 'saving', pct: 94, message: 'Writing PDF...' });
  const bytes = await mergedDoc.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), ext: 'pdf', mime: 'application/pdf' };
}

// ─── PDF → images (each page → PNG or JPEG, packaged as ZIP) ─────────────────

async function pdfToImages(file, outputFmt, onProgress) {
  const pdfjsLib = getPdfjsLib();
  const JSZip    = getJSZip();

  const bytes = await readFileAsArrayBuffer(file);
  let pdfDoc;
  try   { pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise; }
  catch { throw new ConversionError(`Could not parse "${file.name}" as a PDF.`); }

  const numPages = pdfDoc.numPages;
  const mime = outputFmt === 'JPEG' ? 'image/jpeg' : 'image/png';
  const imgExt = outputFmt === 'JPEG' ? 'jpg' : 'png';
  const zip = new JSZip();

  for (let i = 1; i <= numPages; i++) {
    onProgress?.({
      step: 'rendering',
      pct: Math.round(((i - 1) / numPages) * 88),
      message: `Rendering page ${i} of ${numPages}...`,
    });

    const page     = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 }); // 2× for quality
    const canvas   = document.createElement('canvas');
    canvas.width   = Math.round(viewport.width);
    canvas.height  = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await canvasToBlob(canvas, mime, 0.92);
    const buf  = await blob.arrayBuffer();
    zip.file(`page-${String(i).padStart(3, '0')}.${imgExt}`, buf);
  }

  onProgress?.({ step: 'zipping', pct: 94, message: `Packaging ${numPages} pages into ZIP...` });
  const zipBlob = await zip.generateAsync({
    type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 },
  });
  return { blob: zipBlob, ext: 'zip', mime: 'application/zip' };
}

// ─── Image → Image (Canvas API) ───────────────────────────────────────────────

async function convertImage(file, outputFmt, quality = 0.92) {
  const canvas = await imageToCanvas(file, 8192);
  const mime   = IMAGE_MIME[outputFmt] || 'image/png';
  const blob   = await canvasToBlob(canvas, mime, quality);
  return { blob, ext: outputFmt.toLowerCase(), mime };
}

// ─── SVG → raster image ───────────────────────────────────────────────────────

async function svgToRaster(file, outputFmt, quality = 0.92) {
  const text    = await readFileAsText(file);
  const svgBlob = new Blob([text], { type: 'image/svg+xml' });
  const url     = URL.createObjectURL(svgBlob);
  let img;
  try   { img = await loadImageElement(url); }
  finally { URL.revokeObjectURL(url); }
  const w = img.naturalWidth  || img.width  || 800;
  const h = img.naturalHeight || img.height || 600;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  const mime = IMAGE_MIME[outputFmt] || 'image/png';
  const blob = await canvasToBlob(canvas, mime, quality);
  return { blob, ext: outputFmt.toLowerCase(), mime };
}

// ─── Text / CSV / JSON → PDF (pdf-lib drawText, paginated) ───────────────────

async function textFilesToPDF(files, onProgress) {
  const { PDFDocument, StandardFonts, rgb } = getPDFLib();
  const pdfDoc = await PDFDocument.create();
  const font   = await pdfDoc.embedFont(StandardFonts.Courier);

  const PAGE_W = 595, PAGE_H = 842, MARGIN = 48;
  const FS = 9.5, LH = 14;
  const maxCharsPerLine = Math.floor((PAGE_W - MARGIN * 2) / (FS * 0.6));
  const linesPerPage    = Math.floor((PAGE_H - MARGIN * 2) / LH);

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    onProgress?.({
      step: 'text',
      pct: Math.round((fi / files.length) * 88),
      message: `Processing file ${fi + 1} of ${files.length} — ${file.name}`,
    });

    let rawText = await readFileAsText(file);
    const fmt   = detectFormat(file);

    // Pretty-print JSON
    if (fmt === 'JSON') {
      try { rawText = JSON.stringify(JSON.parse(rawText), null, 2); } catch { /* use as-is */ }
    }

    // File separator when merging multiple files
    if (fi > 0) {
      rawText = `\n${'─'.repeat(58)}\n${file.name}\n${'─'.repeat(58)}\n\n` + rawText;
    }

    // Wrap long lines
    const rawLines = rawText.split('\n');
    const lines = [];
    for (const raw of rawLines) {
      if (raw.length === 0) { lines.push(''); continue; }
      for (let i = 0; i < raw.length; i += maxCharsPerLine) {
        lines.push(raw.slice(i, i + maxCharsPerLine));
      }
    }

    let lineIdx = 0;
    while (lineIdx < lines.length) {
      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      let y = PAGE_H - MARGIN;
      for (let i = 0; i < linesPerPage && lineIdx < lines.length; i++, lineIdx++) {
        const ln = lines[lineIdx];
        if (ln.trim()) {
          page.drawText(ln, { x: MARGIN, y, size: FS, font, color: rgb(0.1, 0.1, 0.1) });
        }
        y -= LH;
      }
    }
  }

  onProgress?.({ step: 'saving', pct: 94, message: 'Writing PDF...' });
  const bytes = await pdfDoc.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), ext: 'pdf', mime: 'application/pdf' };
}

// ─── CSV → JSON array ─────────────────────────────────────────────────────────

async function csvToJSON(file) {
  const text = await readFileAsText(file);
  const rows = text.trim().split('\n')
    .map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
  if (rows.length < 2) throw new ConversionError(`"${file.name}" has no data rows.`);
  const headers = rows[0];
  const records = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    return obj;
  });
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
  return { blob, ext: 'json', mime: 'application/json' };
}

// ─── Any files → ZIP ──────────────────────────────────────────────────────────

async function packToZIP(files, onProgress) {
  const JSZip = getJSZip();
  const zip   = new JSZip();

  for (let i = 0; i < files.length; i++) {
    onProgress?.({
      step: 'packing',
      pct: Math.round((i / files.length) * 85),
      message: `Adding file ${i + 1} of ${files.length} — ${files[i].name}`,
    });
    zip.file(files[i].name, files[i]);
  }

  onProgress?.({ step: 'compressing', pct: 90, message: 'Compressing archive...' });
  const blob = await zip.generateAsync({
    type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 },
  });
  return { blob, ext: 'zip', mime: 'application/zip' };
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function convert(files, outputFormat, options = {}, onProgress) {
  if (!files?.length) throw new ConversionError('No files provided.');

  const fmt     = outputFormat.toUpperCase();
  const inFmt   = detectFormat(files[0]);
  const isMulti = files.length > 1;
  const quality = options.quality ?? 0.92;

  onProgress?.({ step: 'start', pct: 4, message: 'Starting...' });

  // ── ZIP: always works for any set of files ─────────────────────────────────
  if (fmt === 'ZIP') {
    return await packToZIP(files, onProgress);
  }

  // ── Multi-file operations ──────────────────────────────────────────────────
  if (isMulti) {
    if (fmt === 'PDF') {
      const allPdfOrImage = files.every(f => {
        const ff = detectFormat(f);
        return ff === 'PDF' || IMAGE_FORMATS.has(ff);
      });
      const allText = files.every(f => TEXT_FORMATS.has(detectFormat(f)));

      if (allPdfOrImage) return await mergeFilesToPDF(files, onProgress);
      if (allText)       return await textFilesToPDF(files, onProgress);

      const badFmts = [...new Set(
        files
          .filter(f => { const ff = detectFormat(f); return ff !== 'PDF' && !IMAGE_FORMATS.has(ff) && !TEXT_FORMATS.has(ff); })
          .map(f => detectFormat(f))
      )];
      throw new ConversionError(
        badFmts.length
          ? `Cannot merge ${badFmts.join(', ')} files into a PDF — only PDFs and images are supported.`
          : 'This format pair cannot be processed in the browser.'
      );
    }

    throw new ConversionError('This format pair cannot be processed in the browser.');
  }

  // ── Single file conversions ────────────────────────────────────────────────
  const file = files[0];

  // Raster image → raster image (PNG ↔ JPEG ↔ WEBP ↔ GIF)
  if (RASTER_FORMATS.has(inFmt) && RASTER_FORMATS.has(fmt)) {
    return await convertImage(file, fmt, quality);
  }

  // Any image (including SVG) → PDF
  if (IMAGE_FORMATS.has(inFmt) && fmt === 'PDF') {
    return await mergeFilesToPDF([file], onProgress);
  }

  // PDF → PDF (re-save / linearize)
  if (inFmt === 'PDF' && fmt === 'PDF') {
    return await mergeFilesToPDF([file], onProgress);
  }

  // PDF → PNG or JPEG (renders all pages → ZIP of images)
  if (inFmt === 'PDF' && (fmt === 'PNG' || fmt === 'JPEG')) {
    return await pdfToImages(file, fmt, onProgress);
  }

  // SVG → raster
  if (inFmt === 'SVG' && RASTER_FORMATS.has(fmt)) {
    return await svgToRaster(file, fmt, quality);
  }

  // TXT / CSV / JSON / MD → PDF
  if (TEXT_FORMATS.has(inFmt) && fmt === 'PDF') {
    return await textFilesToPDF([file], onProgress);
  }

  // CSV → JSON
  if (inFmt === 'CSV' && fmt === 'JSON') {
    return await csvToJSON(file);
  }

  throw new ConversionError(
    `This format pair cannot be processed in the browser.`
  );
}

// ─── Capability matrix data ───────────────────────────────────────────────────

export const CAPABILITIES = [
  { label: 'PDF merge',      status: 'native', note: 'Multiple PDFs → one PDF via pdf-lib' },
  { label: 'Mixed merge',    status: 'native', note: 'PDFs + images → one PDF via pdf-lib' },
  { label: 'PDF → Images',   status: 'native', note: 'All pages rendered to PNG via PDF.js, zipped' },
  { label: 'Image → PDF',    status: 'native', note: 'PNG, JPEG, WEBP, GIF → PDF via pdf-lib' },
  { label: 'Image → Image',  status: 'native', note: 'PNG ↔ JPEG ↔ WEBP ↔ GIF via Canvas' },
  { label: 'Any → ZIP',      status: 'native', note: 'Any files → ZIP archive via JSZip' },
  { label: 'TXT → PDF',      status: 'native', note: 'Plain text to paginated PDF' },
  { label: 'CSV → JSON',     status: 'native', note: 'Header-row CSV to JSON array' },
  { label: 'CSV/JSON → PDF', status: 'native', note: 'Text-based data to paginated PDF' },
  { label: 'SVG → PNG/JPEG', status: 'native', note: 'SVG rasterized via Canvas API' },
  { label: 'DOCX → PDF',     status: 'stub',   note: 'Cannot be processed in the browser' },
  { label: 'PPTX → PDF',     status: 'stub',   note: 'Cannot be processed in the browser' },
  { label: 'MP4 → MP3',      status: 'stub',   note: 'Cannot be processed in the browser' },
  { label: 'Video convert',  status: 'stub',   note: 'Cannot be processed in the browser' },
];

// ─── Format options ───────────────────────────────────────────────────────────

export const CONVERT_OUTPUT_FORMATS = [
  { value: 'PDF',  label: 'PDF' },
  { value: 'PNG',  label: 'PNG — (PDF input: all pages → ZIP)' },
  { value: 'JPEG', label: 'JPEG' },
  { value: 'WEBP', label: 'WEBP' },
  { value: 'GIF',  label: 'GIF' },
  { value: 'JSON', label: 'JSON' },
  { value: 'ZIP',  label: 'ZIP' },
];

export const MERGE_OUTPUT_FORMATS = [
  { value: 'PDF', label: 'PDF — merged document' },
  { value: 'ZIP', label: 'ZIP — archive bundle' },
];

export const ACCEPT_TYPES = {
  'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'application/json': ['.json'],
  'video/mp4': ['.mp4'],
  'audio/mpeg': ['.mp3'],
};
