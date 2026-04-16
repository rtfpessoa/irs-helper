import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, Download, Info, Loader2 } from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import { EnrichmentReport } from './EnrichmentReport';
import { FileUploader } from './FileUploader';
import { NO_ROWS_FOUND_ERROR, downloadXmlFile, processTaxFiles } from '../utils/processFiles';
import { PdfParsingError } from '../utils/pdfParser';
import type { EnrichmentResult } from '../types';

interface BrokerUploader {
  labelKey: string;
  file: File | null;
  setFile: (file: File | null) => void;
}

interface BrokerSection {
  badge: string;
  badgeClass: string;
  laneKey: string;
  warningTitleKey: string;
  warningKeys: string[];
  uploaders: BrokerUploader[];
}

/**
 * Home page for the IRS enrichment workflow: upload files, process data, and review outputs.
 */
export function HomePage() {
  const { t } = useTranslation();
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [xtbCapitalGainsPdf, setXtbCapitalGainsPdf] = useState<File | null>(null);
  const [xtbDividendsPdf, setXtbDividendsPdf] = useState<File | null>(null);
  const [tradeRepublicPdf, setTradeRepublicPdf] = useState<File | null>(null);
  const [trading212Pdf, setTrading212Pdf] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result]);

  const hasBrokerFile = xtbCapitalGainsPdf || xtbDividendsPdf || tradeRepublicPdf || trading212Pdf;

  const brokerSections: BrokerSection[] = useMemo(
    () => [
      {
        badge: 'XTB',
        badgeClass: 'broker-badge--xtb',
        laneKey: 'uploader.xtb_lane',
        warningTitleKey: 'uploader.xtb_warning_title',
        warningKeys: [
          'uploader.xtb_warning_1',
          'uploader.xtb_warning_2',
          'uploader.xtb_warning_3',
          'uploader.xtb_warning_4',
        ],
        uploaders: [
          {
            labelKey: 'uploader.xtb_gains',
            file: xtbCapitalGainsPdf,
            setFile: setXtbCapitalGainsPdf,
          },
          {
            labelKey: 'uploader.xtb_dividends',
            file: xtbDividendsPdf,
            setFile: setXtbDividendsPdf,
          },
        ],
      },
      {
        badge: 'TR',
        badgeClass: 'broker-badge--tr',
        laneKey: 'uploader.tr_lane',
        warningTitleKey: 'uploader.tr_warning_title',
        warningKeys: ['uploader.tr_warning_1', 'uploader.tr_warning_2'],
        uploaders: [
          {
            labelKey: 'uploader.tr_report',
            file: tradeRepublicPdf,
            setFile: setTradeRepublicPdf,
          },
        ],
      },
      {
        badge: 'T212',
        badgeClass: 'broker-badge--t212',
        laneKey: 'uploader.t212_lane',
        warningTitleKey: 'uploader.t212_warning_title',
        warningKeys: ['uploader.t212_warning_1'],
        uploaders: [
          {
            labelKey: 'uploader.t212_report',
            file: trading212Pdf,
            setFile: setTrading212Pdf,
          },
        ],
      },
    ],
    [xtbCapitalGainsPdf, xtbDividendsPdf, tradeRepublicPdf, trading212Pdf],
  );

  const handleProcess = async () => {
    if (!xmlFile || !hasBrokerFile) {
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      const enrichmentResult = await processTaxFiles({
        xmlFile,
        xtbCapitalGainsPdf,
        xtbDividendsPdf,
        tradeRepublicPdf,
        trading212Pdf,
      });

      setResult(enrichmentResult);
    } catch (err: unknown) {
      console.error(err);

      if (err instanceof PdfParsingError) {
        setError(t(err.i18nKey, err.i18nParams));
      } else if (err instanceof Error && err.message === NO_ROWS_FOUND_ERROR) {
        setError(t('app.error.no_rows'));
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(message || t('app.error.generic'));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result) {
      return;
    }

    const originalName = xmlFile?.name.replace('.xml', '') || 'irs-declaration';
    const enrichedName = `${originalName}-enriched.xml`;
    downloadXmlFile(result.enrichedXml, enrichedName);
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
  };

  return (
    <>
      <main className="glass-panel">
        <div className="main-panel-actions">
          <Link to="/how-it-works" className="nav-button">
            <Info size={18} />
            {t('app.how_it_works')}
          </Link>
        </div>

        <div className="uploaders-container">
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

          <section className="upload-category">
            <div className="category-header">
              <span className="category-number">2</span>
              <div className="category-text">
                <h2 className="category-title">{t('uploader.brokers_lane')}</h2>
                <p className="category-description">{t('uploader.brokers_description')}</p>
              </div>
            </div>
            <div className="category-content">
              {brokerSections.map(section => (
                <div className="broker-group" key={section.laneKey}>
                  <div className="broker-header">
                    <span className={`broker-badge ${section.badgeClass}`}>{section.badge}</span>
                    <span className="broker-label">{t(section.laneKey)}</span>
                    <div className="tooltip-container">
                      <div className="tooltip-trigger">
                        <AlertTriangle size={14} />
                      </div>
                      <div className="tooltip-content">
                        <span className="tooltip-title">{t(section.warningTitleKey)}</span>
                        <ul className="tooltip-list">
                          {section.warningKeys.map(warningKey => (
                            <li key={warningKey}>{t(warningKey)}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <span className="broker-optional">{t('uploader.optional')}</span>
                  </div>

                  <div className="broker-files">
                    {section.uploaders.map(uploader => (
                      <FileUploader
                        key={uploader.labelKey}
                        label={t(uploader.labelKey)}
                        accept=".pdf"
                        onFileSelect={file => uploader.setFile(file)}
                        onRemove={() => uploader.setFile(null)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="action-area">
          {!result ? (
            <button
              className="btn btn-primary"
              onClick={handleProcess}
              disabled={!xmlFile || !hasBrokerFile || isProcessing}
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
