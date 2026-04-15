import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, Link } from 'react-router-dom';
import { FileUploader } from './components/FileUploader';
import { EnrichmentReport } from './components/EnrichmentReport';
import { DiffViewer } from './components/DiffViewer';
import { HowItWorksPage } from './components/HowItWorksPage';
import { parseXtbCapitalGainsPdf, parseXtbDividendsPdf, parseTradeRepublicPdf, PdfParsingError } from './utils/pdfParser';
import { enrichXmlWithGains } from './utils/xmlModifier';
import { Download, AlertCircle, AlertTriangle, Loader2, Languages, Info, Sun, Moon } from 'lucide-react';
import type { EnrichmentResult, TaxRow8A, TaxRow, TaxRow92B, TaxRowG13 } from './types';
import './index.css';

function HomePage() {
  const { t } = useTranslation();
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [dividendsPdfFile, setDividendsPdfFile] = useState<File | null>(null);
  const [trPdfFile, setTrPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to results when they appear
  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result]);

  const handleProcess = async () => {
    if (!xmlFile || (!pdfFile && !dividendsPdfFile && !trPdfFile)) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      const originalXmlText = await xmlFile.text();

      const parsedData = { 
        rows8A: [] as TaxRow8A[], 
        rows92A: [] as TaxRow[], 
        rows92B: [] as TaxRow92B[], 
        rowsG13: [] as TaxRowG13[] 
      };
      const sources = {
        table8A: new Set<string>(),
        table92A: new Set<string>(),
        table92B: new Set<string>(),
        tableG13: new Set<string>(),
      };

      const mergeData = (data: typeof parsedData, brokerName: string) => {
        if (data.rows8A.length) {
          parsedData.rows8A.push(...data.rows8A);
          sources.table8A.add(brokerName);
        }
        if (data.rows92A.length) {
          parsedData.rows92A.push(...data.rows92A);
          sources.table92A.add(brokerName);
        }
        if (data.rows92B.length) {
          parsedData.rows92B.push(...data.rows92B);
          sources.table92B.add(brokerName);
        }
        if (data.rowsG13.length) {
          parsedData.rowsG13.push(...data.rowsG13);
          sources.tableG13.add(brokerName);
        }
      };

      // Parse each broker file with its dedicated parser
      if (pdfFile) {
        const data = await parseXtbCapitalGainsPdf(pdfFile);
        mergeData(data, 'XTB');
      }
      if (dividendsPdfFile) {
        const data = await parseXtbDividendsPdf(dividendsPdfFile);
        mergeData(data, 'XTB');
      }
      if (trPdfFile) {
        const data = await parseTradeRepublicPdf(trPdfFile);
        mergeData(data, 'Trade Republic');
      }

      const total = parsedData.rows8A.length + parsedData.rows92A.length + parsedData.rows92B.length + parsedData.rowsG13.length;
      if (total === 0) {
        setError(t('app.error.no_rows'));
        setIsProcessing(false);
        return;
      }

      const enrichmentResult = enrichXmlWithGains(originalXmlText, parsedData, {
        table8A: Array.from(sources.table8A),
        table92A: Array.from(sources.table92A),
        table92B: Array.from(sources.table92B),
        tableG13: Array.from(sources.tableG13),
      });
      setResult(enrichmentResult);
    } catch (err: unknown) {
      console.error(err);
      if (err instanceof PdfParsingError) {
        setError(t(err.i18nKey, err.i18nParams));
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(message || t('app.error.generic'));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const originalName = xmlFile?.name.replace('.xml', '') || 'irs-declaration';
    const newFileName = `${originalName}-enriched.xml`;
    const blob = new Blob([result.enrichedXml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = newFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
  };

  return (
    <>
      <main className="glass-panel">
        <div className="uploaders-container">
          {/* Category 1: Base IRS File */}
          <section className="upload-category">
            <div className="category-header">
              <span className="category-number">1</span>
              <div className="category-text">
                <h2 className="category-title">{t('uploader.xml_lane')}</h2>
                <p className="category-description">{t('uploader.xml_description')}</p>
              </div>
            </div>
            <div className="category-content">
              <FileUploader
                label={t('uploader.xml_file')}
                accept=".xml"
                onFileSelect={setXmlFile}
                onRemove={() => setXmlFile(null)}
              />
            </div>
          </section>

          <div className="category-divider" />

          {/* Category 2: Broker Files */}
          <section className="upload-category">
            <div className="category-header">
              <span className="category-number">2</span>
              <div className="category-text">
                <h2 className="category-title">{t('uploader.brokers_lane')}</h2>
                <p className="category-description">{t('uploader.brokers_description')}</p>
              </div>
            </div>
            <div className="category-content">
              {/* XTB Broker */}
              <div className="broker-group">
                <div className="broker-header">
                  <span className="broker-badge broker-badge--xtb">XTB</span>
                  <span className="broker-label">{t('uploader.xtb_lane')}</span>
                  <div className="tooltip-container">
                    <div className="tooltip-trigger">
                      <AlertTriangle size={14} />
                    </div>
                    <div className="tooltip-content">
                      <span className="tooltip-title">{t('uploader.xtb_warning_title')}</span>
                      <ul className="tooltip-list">
                        <li>{t('uploader.xtb_warning_1')}</li>
                        <li>{t('uploader.xtb_warning_2')}</li>
                        <li>{t('uploader.xtb_warning_3')}</li>
                        <li>{t('uploader.xtb_warning_4')}</li>
                      </ul>
                    </div>
                  </div>
                  <span className="broker-optional">{t('uploader.optional')}</span>
                </div>
                <div className="broker-files">
                  <FileUploader
                    label={t('uploader.xtb_gains')}
                    accept=".pdf"
                    onFileSelect={setPdfFile}
                    onRemove={() => setPdfFile(null)}
                  />
                  <FileUploader
                    label={t('uploader.xtb_dividends')}
                    accept=".pdf"
                    onFileSelect={setDividendsPdfFile}
                    onRemove={() => setDividendsPdfFile(null)}
                  />
                </div>
              </div>

              {/* Trade Republic Broker */}
              <div className="broker-group">
                <div className="broker-header">
                  <span className="broker-badge broker-badge--tr">TR</span>
                  <span className="broker-label">{t('uploader.tr_lane')}</span>
                  <div className="tooltip-container">
                    <div className="tooltip-trigger">
                      <AlertTriangle size={14} />
                    </div>
                    <div className="tooltip-content">
                      <span className="tooltip-title">{t('uploader.tr_warning_title')}</span>
                      <ul className="tooltip-list">
                        <li>{t('uploader.tr_warning_1')}</li>
                        <li>{t('uploader.tr_warning_2')}</li>
                      </ul>
                    </div>
                  </div>
                  <span className="broker-optional">{t('uploader.optional')}</span>
                </div>
                <div className="broker-files">
                  <FileUploader
                    label={t('uploader.tr_report')}
                    accept=".pdf"
                    onFileSelect={setTrPdfFile}
                    onRemove={() => setTrPdfFile(null)}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="action-area">
          {!result ? (
            <button
              className="btn btn-primary"
              onClick={handleProcess}
              disabled={!xmlFile || (!pdfFile && !dividendsPdfFile && !trPdfFile) || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 size={24} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                  {t('app.process.processing')}
                </>
              ) : (
                t('app.process.button')
              )}
            </button>
          ) : (
            <div className="action-buttons">
              <button className="btn btn-primary" onClick={handleDownload}>
                <Download size={20} />
                {t('app.result.download')}
              </button>
              <button className="btn btn-secondary" onClick={handleReset}>
                {t('app.result.start_over')}
              </button>
            </div>
          )}

          {error && (
            <div className="status-msg status-error">
              <AlertCircle size={20} />
              {error}
            </div>
          )}
        </div>
      </main>

      {result && (
        <div className="results-section" ref={resultsRef}>
          <EnrichmentReport summary={result.summary} />
          <DiffViewer originalXml={result.originalXml} enrichedXml={result.enrichedXml} />
        </div>
      )}
    </>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('irs-helper-theme');
    if (stored) return stored === 'dark';
    return true; // Default to dark
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('irs-helper-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggleTheme = () => setIsDark(prev => !prev);

  return (
    <div className="app-container">
      <header className="header">
        <div className="header__main">
          <h1 className="title">{t('app.title')}</h1>
          <p className="subtitle">{t('app.subtitle')}</p>
        </div>
        <div className="header__actions">
          <Link to="/how-it-works" className="nav-button">
            <Info size={18} />
            {t('app.how_it_works')}
          </Link>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="language-selector">
            <div className="language-selector__icon">
              <Languages size={18} />
            </div>
            <select 
              value={i18n.language} 
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="language-selector__select"
            >
              <option value="en">{t('languages.en')}</option>
              <option value="pt">{t('languages.pt')}</option>
            </select>
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
      </Routes>
    </div>
  );
}

export function ErrorFallback() {
  const { t } = useTranslation();
  return (
    <div className="status-msg status-error">
      <AlertCircle size={20} />
      {t('app.error.fallback')}
    </div>
  );
}

export default App;
