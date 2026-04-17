import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, Coins, Download, Eye, Info, Loader2, Upload, X } from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import { EnrichmentReport } from './EnrichmentReport';
import { FileUploader } from './FileUploader';
import { IrsTablesViewer } from './IrsTablesViewer';
import { NO_ROWS_FOUND_ERROR, downloadXmlFile, processBrokerFiles, processTaxFiles } from '../utils/processFiles';
import type { BrokerFilesResult } from '../utils/processFiles';
import { BrokerParsingError } from '../utils/parserErrors';
import type { EnrichmentResult } from '../types';

type WorkflowMode = 'enrich' | 'tables';

interface BrokerUploader {
  labelKey: string;
  accept: string;
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
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('enrich');
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [xtbCapitalGainsPdf, setXtbCapitalGainsPdf] = useState<File | null>(null);
  const [xtbDividendsPdf, setXtbDividendsPdf] = useState<File | null>(null);
  const [tradeRepublicPdf, setTradeRepublicPdf] = useState<File | null>(null);
  const [trading212Pdf, setTrading212Pdf] = useState<File | null>(null);
  const [activoBankPdf, setActivoBankPdf] = useState<File | null>(null);
  const [degiroTransactionsCsv, setDegiroTransactionsCsv] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const [tablesResult, setTablesResult] = useState<BrokerFilesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDonationPrompt, setShowDonationPrompt] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const tablesRef = useRef<HTMLDivElement>(null);
  const donationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result]);

  useEffect(() => {
    if (tablesResult && tablesRef.current) {
      tablesRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [tablesResult]);

  // Scroll-based donation trigger for tables-only mode
  const handleTablesVisible = useCallback(() => {
    if (donationTimerRef.current) return;
    donationTimerRef.current = setTimeout(() => {
      setShowDonationPrompt(true);
    }, 10_000);
  }, []);

  useEffect(() => {
    if (!tablesResult || !tablesRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          handleTablesVisible();
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(tablesRef.current);

    return () => {
      observer.disconnect();
      if (donationTimerRef.current) {
        clearTimeout(donationTimerRef.current);
        donationTimerRef.current = null;
      }
    };
  }, [tablesResult, handleTablesVisible]);

  useEffect(() => {
    if (!showDonationPrompt) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowDonationPrompt(false);
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [showDonationPrompt]);

  const hasBrokerFile = xtbCapitalGainsPdf || xtbDividendsPdf || tradeRepublicPdf || trading212Pdf || activoBankPdf || degiroTransactionsCsv;

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
            accept: '.pdf',
            file: xtbCapitalGainsPdf,
            setFile: setXtbCapitalGainsPdf,
          },
          {
            labelKey: 'uploader.xtb_dividends',
            accept: '.pdf',
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
            accept: '.pdf',
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
            accept: '.pdf',
            file: trading212Pdf,
            setFile: setTrading212Pdf,
          },
        ],
      },
      {
        badge: 'AB',
        badgeClass: 'broker-badge--activobank',
        laneKey: 'uploader.activobank_lane',
        warningTitleKey: 'uploader.activobank_warning_title',
        warningKeys: ['uploader.activobank_warning_1'],
        uploaders: [
          {
            labelKey: 'uploader.activobank_report',
            accept: '.pdf',
            file: activoBankPdf,
            setFile: setActivoBankPdf,
          },
        ],
      },
      {
        badge: 'DEG',
        badgeClass: 'broker-badge--degiro',
        laneKey: 'uploader.degiro_lane',
        warningTitleKey: 'uploader.degiro_warning_title',
        warningKeys: ['uploader.degiro_warning_1', 'uploader.degiro_warning_2', 'uploader.degiro_warning_3'],
        uploaders: [
          {
            labelKey: 'uploader.degiro_report',
            accept: '.csv',
            file: degiroTransactionsCsv,
            setFile: setDegiroTransactionsCsv,
          },
        ],
      },
    ],
    [xtbCapitalGainsPdf, xtbDividendsPdf, tradeRepublicPdf, trading212Pdf, activoBankPdf, degiroTransactionsCsv],
  );

  const canProcess = workflowMode === 'enrich'
    ? !!xmlFile && !!hasBrokerFile
    : !!hasBrokerFile;

  const handleProcess = async () => {
    if (!canProcess) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setTablesResult(null);

    try {
      if (workflowMode === 'enrich') {
        const enrichmentResult = await processTaxFiles({
          xmlFile: xmlFile!,
          xtbCapitalGainsPdf,
          xtbDividendsPdf,
          tradeRepublicPdf,
          trading212Pdf,
          activoBankPdf,
          degiroTransactionsCsv,
        });
        setResult(enrichmentResult);
      } else {
        const brokerResult = await processBrokerFiles({
          xtbCapitalGainsPdf,
          xtbDividendsPdf,
          tradeRepublicPdf,
          trading212Pdf,
          activoBankPdf,
          degiroTransactionsCsv,
        });
        setTablesResult(brokerResult);
      }
    } catch (err: unknown) {
      console.error(err);

      if (err instanceof BrokerParsingError) {
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
    setShowDonationPrompt(true);
  };

  const handleReset = () => {
    setResult(null);
    setTablesResult(null);
    setError(null);
    if (donationTimerRef.current) {
      clearTimeout(donationTimerRef.current);
      donationTimerRef.current = null;
    }
  };

  const hasResult = result || tablesResult;

  return (
    <>
      <main className="glass-panel">
        <div className="main-panel-actions">
          <Link to="/how-it-works" className="nav-button">
            <Info size={18} />
            {t('app.how_it_works')}
          </Link>
          <a
            href="https://donate.stripe.com/00w5kEaSE3D40KEaZw8IU00"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-button bmc-button"
          >
            <Coins size={16} aria-hidden="true" />
            {t('app.bmc.button')}
          </a>
        </div>

        <div className="uploaders-container">
          <section className="upload-category">
            <div className="category-header">
              <span className="category-number">1</span>
              <div className="category-text">
                <h2 className="category-title">{t('uploader.step1_lane')}</h2>
                <p className="category-description">{t('uploader.step1_description')}</p>
              </div>
            </div>
            <div className="category-content">
              <div className="workflow-toggle">
                <button
                  className={`workflow-toggle__option ${workflowMode === 'enrich' ? 'workflow-toggle__option--active' : ''}`}
                  onClick={() => setWorkflowMode('enrich')}
                  type="button"
                >
                  <Upload size={16} />
                  {t('uploader.mode_enrich')}
                </button>
                <button
                  className={`workflow-toggle__option ${workflowMode === 'tables' ? 'workflow-toggle__option--active' : ''}`}
                  onClick={() => setWorkflowMode('tables')}
                  type="button"
                >
                  <Eye size={16} />
                  {t('uploader.mode_tables')}
                </button>
              </div>
              {workflowMode === 'enrich' && (
                <FileUploader
                  label={t('uploader.xml_file')}
                  accept=".xml"
                  onFileSelect={setXmlFile}
                  onRemove={() => setXmlFile(null)}
                />
              )}
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
                        accept={uploader.accept}
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
          {!hasResult ? (
            <button
              className="btn btn-primary"
              onClick={handleProcess}
              disabled={!canProcess || isProcessing}
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
              {result && (
                <button className="btn btn-primary" onClick={handleDownload}>
                  <Download size={20} />
                  {t('app.result.download')}
                </button>
              )}
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

          {hasResult && (
            <div className="status-msg status-warning">
              <AlertTriangle size={30} style={{ color: 'var(--warning-color)', flexShrink: 0 }} />
              {t('app.result.disclaimer')}
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

      {tablesResult && (
        <div className="results-section" ref={tablesRef}>
          <IrsTablesViewer parsedData={tablesResult.parsedData} sources={tablesResult.sources} />
        </div>
      )}

      {showDonationPrompt && (
        <div
          className="donation-modal-backdrop"
          onClick={() => setShowDonationPrompt(false)}
          role="presentation"
        >
          <div
            className="donation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="donation-modal-title"
            onClick={event => event.stopPropagation()}
          >
            <button
              className="donation-modal__close"
              onClick={() => setShowDonationPrompt(false)}
              aria-label={t('app.bmc.popup.close')}
            >
              <X size={18} />
            </button>

            <div className="donation-modal__header">
              <h2 id="donation-modal-title" className="donation-modal__title">
                {t('app.bmc.popup.title')}
              </h2>
              <p className="donation-modal__subtitle">{t('app.bmc.popup.subtitle')}</p>
            </div>

            <div className="donation-modal__actions">
              <button className="btn btn-secondary donation-modal__action" onClick={() => setShowDonationPrompt(false)}>
                {t('app.bmc.popup.close')}
              </button>
              <a
                href="https://donate.stripe.com/00w5kEaSE3D40KEaZw8IU00"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary donation-modal__action"
              >
                {t('app.bmc.popup.open_link')}
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
