import { useState } from 'react';
import type { FormEvent } from 'react';
import './App.css';
import type { CheckResponse, RuleResult } from './types';

const DEFAULT_RULES = [
  'The document must include a purpose or objective section.',
  'The document must mention at least one concrete date.',
  'The document must describe who is responsible for execution.',
];

const API_BASE = import.meta.env.VITE_API_URL || '';

const getStatusClass = (status: RuleResult['status']) =>
  status === 'pass' ? 'status-pill pass' : 'status-pill fail';

function App() {
  const rules = DEFAULT_RULES;
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [results, setResults] = useState<RuleResult[] | null>(null);
  const [meta, setMeta] = useState<CheckResponse['meta'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const canSubmit = Boolean(pdfFile);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type !== 'application/pdf') {
      setError('Please upload a valid PDF file.');
      event.target.value = '';
      return;
    }
    if (file && file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB.');
      event.target.value = '';
      return;
    }
    setError(null);
    setPdfFile(file ?? null);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'application/pdf') {
      if (file.size > 10 * 1024 * 1024) {
        setError('File size must be less than 10MB.');
        return;
      }
      setPdfFile(file);
      setError(null);
    } else {
      setError('Please drop a valid PDF file.');
    }
  };

  const toggleRowExpansion = (index: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const passCount = results?.filter((r) => r.status === 'pass').length ?? 0;
  const failCount = results?.filter((r) => r.status === 'fail').length ?? 0;
  const avgConfidence =
    results && results.length > 0
      ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      : 0;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pdfFile) {
      setError('Please upload a PDF before checking.');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const formData = new FormData();
      formData.append('pdf', pdfFile);
      formData.append('rules', JSON.stringify(rules));

      const response = await fetch(`${API_BASE}/api/check`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to check the PDF.');
      }

      const data: CheckResponse = await response.json();
      setResults(data.results);
      setMeta(data.meta);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to check the document.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">NIYAMR AI</p>
          <h1>PDF Rule Checker</h1>
          <p className="subtitle">
            Upload a PDF, enter three simple rules, and get instant LLM-powered
            validation with evidence.
          </p>
        </div>
      </header>

      <main className="card">
        <form className="form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label htmlFor="pdf-input">
              1. Upload PDF
              <span className="label-hint">(Max 10MB)</span>
            </label>
            <div
              className={`file-upload-area ${dragActive ? 'drag-active' : ''} ${pdfFile ? 'has-file' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <input
                id="pdf-input"
                type="file"
                accept="application/pdf"
                onChange={handleFileChange}
                className="file-input"
              />
              {pdfFile ? (
                <div className="file-info">
                  <span className="file-icon">📄</span>
                  <div className="file-details">
                    <span className="file-name">{pdfFile.name}</span>
                    <span className="file-size">
                      {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                  <button
                    type="button"
                    className="file-remove"
                    onClick={() => {
                      setPdfFile(null);
                      setResults(null);
                      setMeta(null);
                    }}
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="file-upload-placeholder">
                  <span className="upload-icon">📤</span>
                  <p>
                    <strong>Drag & drop your PDF here</strong>
                  </p>
                  <p className="upload-hint">or click to browse</p>
                </div>
              )}
            </div>
          </div>

          <div className="field-group">
            <label>2. Rules to Check</label>
            <div className="rules-display">
              {rules.map((rule, idx) => (
                <div className="rule-display-item" key={`rule-${idx}`}>
                  <span className="rule-number">Rule {idx + 1}</span>
                  <p className="rule-text">{rule}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="actions">
            <button type="submit" disabled={!canSubmit || loading}>
              {loading ? (
                <>
                  <span className="spinner"></span>
                  Analyzing...
                </>
              ) : (
                'Check document'
              )}
            </button>
          </div>
        </form>

        {error && (
          <div className="banner error" role="alert">
            <span className="banner-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}
        {loading && (
          <div className="loading-overlay">
            <div className="loading-content">
              <div className="loading-spinner-large"></div>
              <p>Analyzing document with AI...</p>
              <p className="loading-subtitle">This may take a few moments</p>
            </div>
          </div>
        )}
        {results && (
          <section className="results">
            <div className="results-header">
              <h2>Analysis Results</h2>
              <div className="results-summary">
                <div className="summary-stat">
                  <span className="stat-value stat-pass">{passCount}</span>
                  <span className="stat-label">Passed</span>
                </div>
                <div className="summary-stat">
                  <span className="stat-value stat-fail">{failCount}</span>
                  <span className="stat-label">Failed</span>
                </div>
                <div className="summary-stat">
                  <span className="stat-value">{Math.round(avgConfidence)}%</span>
                  <span className="stat-label">Avg Confidence</span>
                </div>
              </div>
            </div>
            <div className="results-meta">
              <div className="meta-item">
                <span className="meta-icon">🤖</span>
                <span className="meta-label">Model:</span>
                <span className="meta-value">{meta?.model ?? 'unknown'}</span>
              </div>
              {meta?.pageCount && (
                <div className="meta-item">
                  <span className="meta-icon">📄</span>
                  <span className="meta-label">Pages:</span>
                  <span className="meta-value">{meta.pageCount}</span>
                </div>
              )}
              {meta?.textLength && (
                <div className="meta-item">
                  <span className="meta-icon">📊</span>
                  <span className="meta-label">Text Length:</span>
                  <span className="meta-value">~{meta.textLength.toLocaleString()} chars</span>
                </div>
              )}
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Status</th>
                    <th>Evidence</th>
                    <th>Reasoning</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result, index) => (
                    <tr
                      key={result.rule}
                      className={expandedRows.has(index) ? 'expanded' : ''}
                    >
                      <td className="rule-cell">
                        <div className="rule-text">{result.rule}</div>
                      </td>
                      <td>
                        <span className={getStatusClass(result.status)}>
                          {result.status === 'pass' ? '✓' : '✗'} {result.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="evidence-cell">
                        <div className="cell-content">
                          {result.evidence.length > 80 ? (
                            <>
                              <span className="cell-preview">
                                {result.evidence.substring(0, 80)}...
                              </span>
                              <button
                                type="button"
                                className="expand-toggle"
                                onClick={() => toggleRowExpansion(index)}
                              >
                                {expandedRows.has(index) ? 'Show less' : 'Show more'}
                              </button>
                              {expandedRows.has(index) && (
                                <div className="cell-expanded">{result.evidence}</div>
                              )}
                            </>
                          ) : (
                            result.evidence
                          )}
                        </div>
                      </td>
                      <td className="reasoning-cell">
                        <div className="cell-content">
                          {result.reasoning.length > 100 ? (
                            <>
                              <span className="cell-preview">
                                {result.reasoning.substring(0, 100)}...
                              </span>
                              <button
                                type="button"
                                className="expand-toggle"
                                onClick={() => toggleRowExpansion(index)}
                              >
                                {expandedRows.has(index) ? 'Show less' : 'Show more'}
                              </button>
                              {expandedRows.has(index) && (
                                <div className="cell-expanded">{result.reasoning}</div>
                              )}
                            </>
                          ) : (
                            result.reasoning
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="confidence">
                          <div className="confidence-header">
                            <span className="confidence-value">{result.confidence}%</span>
                            <span
                              className={`confidence-badge ${
                                result.confidence >= 80
                                  ? 'high'
                                  : result.confidence >= 50
                                  ? 'medium'
                                  : 'low'
                              }`}
                            >
                              {result.confidence >= 80
                                ? 'High'
                                : result.confidence >= 50
                                ? 'Medium'
                                : 'Low'}
                            </span>
                          </div>
                          <div className="confidence-bar">
                            <div
                              className={`confidence-fill ${
                                result.confidence >= 80
                                  ? 'high'
                                  : result.confidence >= 50
                                  ? 'medium'
                                  : 'low'
                              }`}
                              style={{ width: `${result.confidence}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        Built with React, Express, and Groq LLM
      </footer>
    </div>
  );
}

export default App;

