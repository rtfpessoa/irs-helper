import { TrendingUp, Receipt, Landmark, CheckCircle2, Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EnrichmentSummary } from '../types';

interface EnrichmentReportProps {
  summary: EnrichmentSummary;
}

interface TableCardProps {
  title: string;
  subtitle: string;
  rowsAdded: number;
  totals: { label: string; value: string; currency?: boolean }[];
  sources: string[];
  icon: React.ReactNode;
  colorClass: string;
}

function TableCard({ title, subtitle, rowsAdded, totals, sources, icon, colorClass }: TableCardProps) {
  const { t } = useTranslation();
  if (rowsAdded === 0) return null; // Don't show inactive tables at all

  const getSourceTagClass = (source: string) => {
    const s = source.toLowerCase();
    if (s.includes('xtb')) return 'enrichment-card__source-tag--xtb';
    if (s.includes('trade republic')) return 'enrichment-card__source-tag--trade-republic';
    return '';
  };

  return (
    <div className={`enrichment-card ${colorClass}`}>
      <div className="enrichment-card__header">
        <span className="enrichment-card__icon">{icon}</span>
        <div>
          <h3 className="enrichment-card__title">{title}</h3>
          <p className="enrichment-card__subtitle">{subtitle}</p>
        </div>
        <span className="enrichment-card__badge">+{rowsAdded} {rowsAdded !== 1 ? t('report.rows_plural') : t('report.rows')}</span>
      </div>

      <div className="enrichment-card__sources">
        {sources.map(s => (
          <span key={s} className={`enrichment-card__source-tag ${getSourceTagClass(s)}`}>{s}</span>
        ))}
      </div>

      {totals.length > 0 && (
        <dl className="enrichment-card__totals">
          {totals.map(({ label, value, currency }) => (
            <div key={label} className="enrichment-card__total-row">
              <dt className="enrichment-card__total-label">{t(label)}</dt>
              <dd className="enrichment-card__total-value">
                {currency ? `€ ${Number(value).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function EnrichmentReport({ summary }: EnrichmentReportProps) {
  const { t } = useTranslation();
  const activeTablesCount = [summary.table8A, summary.table92A, summary.table92B, summary.tableG13].filter(t => t.rowsAdded > 0).length;

  const annexGCards = [
    {
      title: t('report.quadro_g13.title'),
      subtitle: t('report.quadro_g13.subtitle'),
      rowsAdded: summary.tableG13.rowsAdded,
      totals: summary.tableG13.totals,
      sources: summary.tableG13.sources,
      icon: <Activity size={20} />,
      colorClass: 'enrichment-card--blue',
    },
  ];

  const annexJCards = [
    {
      title: t('report.quadro_8a.title'),
      subtitle: t('report.quadro_8a.subtitle'),
      rowsAdded: summary.table8A.rowsAdded,
      totals: summary.table8A.totals,
      sources: summary.table8A.sources,
      icon: <Receipt size={20} />,
      colorClass: 'enrichment-card--blue',
    },
    {
      title: t('report.quadro_92a.title'),
      subtitle: t('report.quadro_92a.subtitle'),
      rowsAdded: summary.table92A.rowsAdded,
      totals: summary.table92A.totals,
      sources: summary.table92A.sources,
      icon: <TrendingUp size={20} />,
      colorClass: 'enrichment-card--green',
    },
    {
      title: t('report.quadro_92b.title'),
      subtitle: t('report.quadro_92b.subtitle'),
      rowsAdded: summary.table92B.rowsAdded,
      totals: summary.table92B.totals,
      sources: summary.table92B.sources,
      icon: <Landmark size={20} />,
      colorClass: 'enrichment-card--purple',
    },
  ];
  
  const hasAnnexG = summary.tableG13.rowsAdded > 0;
  const hasAnnexJ = [summary.table8A, summary.table92A, summary.table92B].some(t => t.rowsAdded > 0);

  return (
    <div className="enrichment-report">
      <div className="enrichment-report__header">
        <CheckCircle2 size={22} className="enrichment-report__check" />
        <div>
          <h2 className="enrichment-report__title">{t('app.result.title')}</h2>
          <p className="enrichment-report__subtitle">
            {t('app.result.subtitle', { count: summary.totalRowsAdded, activeTables: activeTablesCount })}
          </p>
        </div>
      </div>

      {hasAnnexG && (
        <div className="enrichment-report__annex-group">
          <header className="enrichment-report__annex-title">
            {t('report.annex_g')} <span>{t('report.capital_gains')}</span>
          </header>
          <div className="enrichment-report__grid">
            {annexGCards.map(card => (
              <TableCard key={card.title} {...card} />
            ))}
          </div>
        </div>
      )}

      {hasAnnexJ && (
        <div className="enrichment-report__annex-group">
          <header className="enrichment-report__annex-title">
            {t('report.annex_j')} <span>{t('report.foreign_income')}</span>
          </header>
          <div className="enrichment-report__grid">
            {annexJCards.map(card => (
              <TableCard key={card.title} {...card} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

