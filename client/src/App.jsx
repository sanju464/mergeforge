import { useState, useRef, useCallback, useEffect } from 'react';
import {
  convert,
  detectFormat,
  formatSize,
  librariesReady,
  CAPABILITIES,
  CONVERT_OUTPUT_FORMATS,
  MERGE_OUTPUT_FORMATS,
  ACCEPT_TYPES,
} from './converter.js';
import './App.css';

// ─── SVG icons (inline, no library) ─────────────────────────────────────────

const UploadIcon = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const RemoveIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

// ─── Toast system ─────────────────────────────────────────────────────────────

function Toast({ toasts, onRemove }) {
  return (
    <div className="toast-container" role="alert" aria-live="polite">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`toast ${t.type}`}
          onClick={() => onRemove(t.id)}
          style={{ cursor: 'pointer' }}
          title="Click to dismiss"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── File row ─────────────────────────────────────────────────────────────────

function FileRow({ file, index, onRemove }) {
  const fmt = detectFormat(file);
  return (
    <div className="file-item" role="row">
      <span className="file-name" title={file.name}>{file.name}</span>
      <span className="file-type-badge" aria-label={`Type: ${fmt}`}>{fmt}</span>
      <span className="file-size">{formatSize(file.size)}</span>
      <button
        className="file-remove-btn"
        onClick={() => onRemove(index)}
        aria-label={`Remove ${file.name}`}
        title="Remove"
      >
        <RemoveIcon />
      </button>
    </div>
  );
}

// ─── Drop zone ────────────────────────────────────────────────────────────────

function DropZone({ onFiles, mode }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = useCallback(e => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  }, [onFiles]);

  const handleDragOver  = e => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleChange    = e => {
    const files = Array.from(e.target.files);
    if (files.length) onFiles(files);
    e.target.value = '';
  };
  const handleClick = () => inputRef.current?.click();

  const accept = Object.entries(ACCEPT_TYPES)
    .flatMap(([mime, exts]) => [mime, ...exts])
    .join(',');

  return (
    <div
      className={`dropzone-wrapper${dragOver ? ' drag-over' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label="Drop files here or click to browse"
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleClick()}
      id="dropzone-area"
    >
      <input
        ref={inputRef}
        type="file"
        className="dropzone-input"
        multiple={mode === 'merge'}
        accept={accept}
        onChange={handleChange}
        aria-hidden="true"
        tabIndex={-1}
        id="file-input"
      />
      <div className="dropzone-icon"><UploadIcon /></div>
      <div className="dropzone-label">
        <strong>Drop files here</strong>{' '}or click to browse
      </div>
      <div className="dropzone-sublabel">
        PDF · PNG · JPEG · WEBP · GIF · SVG · TXT · CSV · JSON · DOCX · PPTX · MP4 · MP3
      </div>
    </div>
  );
}

// ─── Status / progress bar ────────────────────────────────────────────────────

function StatusBar({ status }) {
  if (!status) return null;

  const indicatorClass = {
    idle: 'idle', loading: 'loading', success: 'success', error: 'error',
  }[status.type] ?? 'idle';

  return (
    <div className="status-bar" role="status" aria-live="polite">
      <div className={`status-indicator ${indicatorClass}`} aria-hidden="true" />
      <div className="status-text">
        <div className="status-title">{status.title}</div>
        {status.detail && <div className="status-detail">{status.detail}</div>}
        {status.type === 'loading' && (
          <div className="progress-bar-track">
            <div
              className={`progress-bar-fill${status.pct == null ? ' indeterminate' : ''}`}
              style={status.pct != null ? { width: `${status.pct}%` } : {}}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Capability matrix ────────────────────────────────────────────────────────

function CapabilityMatrix() {
  return (
    <section className="capability-section" aria-label="Conversion capability matrix">
      <div className="capability-title">Conversion coverage</div>
      <div className="cap-grid">
        {CAPABILITIES.map(cap => (
          <div key={cap.label} className="cap-cell" title={cap.note}>
            <div className={`cap-dot ${cap.status}`} aria-hidden="true" />
            <span className="cap-label">{cap.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [mode, setMode]           = useState('convert'); // 'convert' | 'merge'
  const [files, setFiles]         = useState([]);
  const [outputFormat, setOutputFormat] = useState('PDF');
  const [status, setStatus]       = useState(null);
  const [toasts, setToasts]       = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [quality, setQuality]     = useState(0.92);
  const [libsReady, setLibsReady] = useState(librariesReady());
  const toastTimers               = useRef({});

  // Poll for CDN library readiness
  useEffect(() => {
    if (libsReady) return;
    const id = setInterval(() => {
      if (librariesReady()) {
        // Set PDF.js worker source when available
        if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        setLibsReady(true);
        clearInterval(id);
      }
    }, 250);
    return () => clearInterval(id);
  }, [libsReady]);

  // Cleanup toast timers on unmount
  useEffect(() => {
    const tm = toastTimers.current;
    return () => Object.values(tm).forEach(clearTimeout);
  }, []);

  // Switch mode — reset state
  const switchMode = m => {
    setMode(m);
    setFiles([]);
    setStatus(null);
    setOutputFormat('PDF');
  };

  // Add files — enforce single-file in convert mode, deduplicate in merge
  const handleFiles = useCallback(incoming => {
    setFiles(prev => {
      if (mode === 'convert') {
        if (incoming.length > 1) {
          showToast('Convert mode accepts one file. Switch to Merge to combine files.', 'warning');
        }
        return [incoming[0]];
      }
      const existing = new Set(prev.map(f => f.name));
      const fresh    = incoming.filter(f => !existing.has(f.name));
      if (fresh.length < incoming.length) {
        const skipped = incoming.length - fresh.length;
        showToast(`${skipped} duplicate file${skipped > 1 ? 's' : ''} ignored.`, 'warning');
      }
      return [...prev, ...fresh];
    });
    setStatus(null);
  }, [mode]);

  const removeFile = idx => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    setStatus(null);
  };

  // Toast helpers
  const showToast = (message, type = 'error') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    toastTimers.current[id] = setTimeout(() => removeToast(id), 6000);
  };

  const removeToast = id => {
    clearTimeout(toastTimers.current[id]);
    delete toastTimers.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Run conversion
  const handleConvert = async () => {
    if (!libsReady) {
      showToast('Libraries are still loading — please wait a moment.', 'warning');
      return;
    }
    if (files.length === 0) {
      showToast('No files selected. Drop or browse files first.', 'warning');
      return;
    }
    if (mode === 'convert' && files.length !== 1) {
      showToast('Select exactly one file to convert.', 'warning');
      return;
    }
    if (mode === 'merge' && files.length < 2) {
      showToast('Add at least two files to merge.', 'warning');
      return;
    }

    setIsRunning(true);
    setStatus({ type: 'loading', title: 'Initializing...', pct: 0 });

    try {
      const result = await convert(
        files,
        outputFormat,
        { quality },
        ({ pct, message }) => {
          setStatus({
            type: 'loading',
            title: message || 'Processing...',
            pct: pct ?? null,
          });
        }
      );

      // Download with a consistent mergeforge- prefix
      const outName = `mergeforge-output.${result.ext}`;
      const url = URL.createObjectURL(result.blob);
      const a   = document.createElement('a');
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);

      setStatus({
        type: 'success',
        title: `Done — ${outName} downloaded`,
        detail: `${formatSize(result.blob.size)} · ${result.mime}`,
      });
      showToast(`${outName} is ready.`, 'success');

    } catch (err) {
      const msg = err.message || 'Conversion failed.';
      setStatus({ type: 'error', title: msg });
      showToast(msg, 'error');
    } finally {
      setIsRunning(false);
    }
  };

  const outputFormats = mode === 'convert' ? CONVERT_OUTPUT_FORMATS : MERGE_OUTPUT_FORMATS;

  const canRun = !isRunning && libsReady && files.length > 0 &&
    (mode === 'convert' ? files.length === 1 : files.length >= 2);

  const actionLabel = (() => {
    if (!libsReady) return 'Loading libraries...';
    if (mode === 'convert') return isRunning ? 'Converting...' : 'Convert & download';
    return isRunning ? 'Merging...' : 'Merge & download';
  })();

  return (
    <div className="app-wrapper">

      {/* ── Header ── */}
      <header className="site-header" role="banner">
        <div className="container">
          <div className="header-inner">
            <span className="site-logo">
              merge<span>forge</span>
            </span>
            <span className="site-tagline">file conversion without the weight</span>
            <div className="header-mode-indicator">
              {libsReady
                ? <span className="mono text-muted" style={{ fontSize: '0.65rem' }}>client-side · no upload</span>
                : <span className="mono text-muted" style={{ fontSize: '0.65rem', color: 'var(--warning)' }}>loading libraries...</span>
              }
            </div>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="main-content" role="main">
        <div className="container">

          {/* Mode toggle */}
          <div className="mode-toggle" role="group" aria-label="Operation mode">
            <button
              id="mode-convert"
              className={`mode-btn${mode === 'convert' ? ' active' : ''}`}
              onClick={() => switchMode('convert')}
              aria-pressed={mode === 'convert'}
            >
              convert
            </button>
            <button
              id="mode-merge"
              className={`mode-btn${mode === 'merge' ? ' active' : ''}`}
              onClick={() => switchMode('merge')}
              aria-pressed={mode === 'merge'}
            >
              merge
            </button>
          </div>

          {/* Drop zone */}
          <DropZone onFiles={handleFiles} mode={mode} />

          {/* File list */}
          {files.length > 0 ? (
            <div className="file-list" role="table" aria-label="Selected files">
              <div className="file-list-header" role="row">
                <span role="columnheader">filename</span>
                <span role="columnheader">type</span>
                <span role="columnheader" style={{ textAlign: 'right' }}>size</span>
                <span role="columnheader" aria-label="Actions" />
              </div>
              {files.map((f, i) => (
                <FileRow key={`${f.name}-${i}`} file={f} index={i} onRemove={removeFile} />
              ))}
            </div>
          ) : (
            <div className="empty-state" aria-label="No files selected">
              no files selected — drop files above or click to browse
            </div>
          )}

          {/* Controls */}
          <div className="controls-row">
            <div className="control-group">
              <label htmlFor="output-format-select" className="control-label">
                output format
              </label>
              <select
                id="output-format-select"
                className="control-select"
                value={outputFormat}
                onChange={e => setOutputFormat(e.target.value)}
              >
                {outputFormats.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            {/* Quality selector — only relevant for lossy image output */}
            {(outputFormat === 'JPEG' || outputFormat === 'WEBP') && (
              <div className="control-group" style={{ maxWidth: 180 }}>
                <label htmlFor="quality-select" className="control-label">quality</label>
                <select
                  id="quality-select"
                  className="control-select"
                  value={quality}
                  onChange={e => setQuality(parseFloat(e.target.value))}
                >
                  <option value={1.0}>maximum (1.0)</option>
                  <option value={0.92}>high (0.92)</option>
                  <option value={0.80}>medium (0.80)</option>
                  <option value={0.60}>low (0.60)</option>
                </select>
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
              <button
                id="action-btn"
                className="btn-primary"
                onClick={handleConvert}
                disabled={!canRun}
                aria-busy={isRunning}
                aria-label={actionLabel}
              >
                {isRunning
                  ? <><span style={{ fontSize: '0.7rem', opacity: 0.7 }}>[ &middot;&middot;&middot; ]</span>{actionLabel}</>
                  : <><DownloadIcon />{actionLabel}</>
                }
              </button>

              {files.length > 0 && (
                <button
                  id="clear-btn"
                  className="btn-secondary"
                  onClick={() => { setFiles([]); setStatus(null); }}
                >
                  clear all
                </button>
              )}
            </div>
          </div>

          {/* Contextual hint */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <span className="mono text-muted" style={{ fontSize: '0.65rem' }}>
              {mode === 'convert'
                ? 'Convert mode: one file in, different format out.'
                : 'Merge mode: multiple files in, one combined output.'}
            </span>
          </div>

          {/* Status bar */}
          <StatusBar status={status} />

          {/* Capability matrix */}
          <CapabilityMatrix />

        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="site-footer" role="contentinfo">
        <div className="container">
          <div className="footer-inner">
            <div className="footer-note">
              All processing runs in your browser. No files leave your machine.
              <br />
              Unsupported pairs (DOCX, PPTX, video) cannot be converted client-side.
            </div>
            <div className="footer-legend">
              <div className="legend-item">
                <div className="legend-dot" style={{ background: 'var(--success)' }} aria-hidden="true" />
                <span className="legend-text">client-side</span>
              </div>
              <div className="legend-item">
                <div className="legend-dot" style={{ background: 'var(--border-light)' }} aria-hidden="true" />
                <span className="legend-text">not supported</span>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* Toasts */}
      <Toast toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
