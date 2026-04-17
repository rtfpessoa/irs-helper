import { useTranslation } from 'react-i18next';
import { Activity, Landmark, Receipt, TrendingUp } from 'lucide-react';
import type { ParsedPdfData, TaxRow, TaxRow8A, TaxRow92B, TaxRowG13 } from '../types';

interface IrsTablesViewerProps {
  parsedData: ParsedPdfData;
  sources: {
    table8A: string[];
    table92A: string[];
    table92B: string[];
    tableG13: string[];
  };
}

interface TableConfig<T> {
  titleKey: string;
  subtitleKey: string;
  icon: React.ReactNode;
  colorClass: string;
  rows: T[];
  sources: string[];
  columns: { header: string; accessor: (row: T, index: number) => string }[];
  totals: { label: string; value: string }[];
}

function getSourceTagClass(source: string) {
  const s = source.toLowerCase();
  if (s.includes('xtb')) return 'enrichment-card__source-tag--xtb';
  if (s.includes('trade republic')) return 'enrichment-card__source-tag--trade-republic';
  if (s.includes('trading 212')) return 'enrichment-card__source-tag--t212';
  if (s.includes('degiro')) return 'enrichment-card__source-tag--degiro';
  if (s.includes('e*trade') || s.includes('etrade')) return 'enrichment-card__source-tag--etrade';
  return '';
}

function sumBy<T>(rows: T[], accessor: (row: T) => string): number {
  return rows.reduce((sum, row) => sum + (parseFloat(accessor(row)) || 0), 0);
}

function formatCurrency(value: number): string {
  return `${value.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function DataTable<T>({ config }: { config: TableConfig<T> }) {
  const { t } = useTranslation();

  if (config.rows.length === 0) return null;

  return (
    <div className={`irs-table-card ${config.colorClass}`}>
      <div className="irs-table-card__header">
        <span className="enrichment-card__icon">{config.icon}</span>
        <div>
          <h3 className="enrichment-card__title">{t(config.titleKey)}</h3>
          <p className="enrichment-card__subtitle">{t(config.subtitleKey)}</p>
        </div>
        <span className="enrichment-card__badge">
          {config.rows.length} {config.rows.length !== 1 ? t('report.rows_plural') : t('report.rows')}
        </span>
      </div>

      <div className="enrichment-card__sources">
        {config.sources.map(s => (
          <span key={s} className={`enrichment-card__source-tag ${getSourceTagClass(s)}`}>{s}</span>
        ))}
      </div>

      <div className="irs-table-card__table-wrapper">
        <table className="irs-table">
          <thead>
            <tr>
              {config.columns.map(col => (
                <th key={col.header}>{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.rows.map((row, i) => (
              <tr key={i}>
                {config.columns.map(col => (
                  <td key={col.header}>{col.accessor(row, i)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {config.totals.length > 0 && (
        <dl className="enrichment-card__totals irs-table-card__totals">
          <dt className="enrichment-card__total-label irs-table-card__totals-title">{t('tables.control_sum')}</dt>
          {config.totals.map(({ label, value }) => (
            <div key={label} className="enrichment-card__total-row">
              <dt className="enrichment-card__total-label">{t(label)}</dt>
              <dd className="enrichment-card__total-value">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function IrsTablesViewer({ parsedData, sources }: IrsTablesViewerProps) {
  const { t } = useTranslation();

  const table8A: TableConfig<TaxRow8A> = {
    titleKey: 'report.quadro_8a.title',
    subtitleKey: 'report.quadro_8a.subtitle',
    icon: <Receipt size={20} />,
    colorClass: 'enrichment-card--blue',
    rows: parsedData.rows8A,
    sources: sources.table8A,
    columns: [
      { header: 'Nº Linha', accessor: (_, i) => String(801 + i) },
      { header: 'Código Rendimento', accessor: row => row.codigo },
      { header: 'País da Fonte', accessor: row => row.codPais },
      { header: 'Rendimento Bruto', accessor: row => row.rendimentoBruto },
      { header: 'Imposto Pago no Estrangeiro', accessor: row => row.impostoPago },
    ],
    totals: [
      { label: 'report.totals.gross_income', value: formatCurrency(sumBy(parsedData.rows8A, r => r.rendimentoBruto)) },
      { label: 'report.totals.tax_paid_abroad', value: formatCurrency(sumBy(parsedData.rows8A, r => r.impostoPago)) },
    ],
  };

  const table92A: TableConfig<TaxRow> = {
    titleKey: 'report.quadro_92a.title',
    subtitleKey: 'report.quadro_92a.subtitle',
    icon: <TrendingUp size={20} />,
    colorClass: 'enrichment-card--green',
    rows: parsedData.rows92A,
    sources: sources.table92A,
    columns: [
      { header: 'Nº Linha', accessor: (_, i) => String(951 + i) },
      { header: 'País da Fonte', accessor: row => row.codPais },
      { header: 'Código', accessor: row => row.codigo },
      { header: 'Realização Ano', accessor: row => row.anoRealizacao },
      { header: 'Realização Mês', accessor: row => row.mesRealizacao },
      { header: 'Realização Dia', accessor: row => row.diaRealizacao },
      { header: 'Realização Valor', accessor: row => row.valorRealizacao },
      { header: 'Aquisição Ano', accessor: row => row.anoAquisicao },
      { header: 'Aquisição Mês', accessor: row => row.mesAquisicao },
      { header: 'Aquisição Dia', accessor: row => row.diaAquisicao },
      { header: 'Aquisição Valor', accessor: row => row.valorAquisicao },
      { header: 'Despesas e Encargos', accessor: row => row.despesasEncargos },
      { header: 'Imposto pago no Estrangeiro', accessor: row => row.impostoPagoNoEstrangeiro },
      { header: 'País da Contraparte', accessor: row => row.codPaisContraparte },
    ],
    totals: [
      { label: 'report.totals.realisation_value', value: formatCurrency(sumBy(parsedData.rows92A, r => r.valorRealizacao)) },
      { label: 'report.totals.acquisition_value', value: formatCurrency(sumBy(parsedData.rows92A, r => r.valorAquisicao)) },
      { label: 'report.totals.expenses_charges', value: formatCurrency(sumBy(parsedData.rows92A, r => r.despesasEncargos)) },
      { label: 'report.totals.tax_paid_abroad', value: formatCurrency(sumBy(parsedData.rows92A, r => r.impostoPagoNoEstrangeiro)) },
    ],
  };

  const table92B: TableConfig<TaxRow92B> = {
    titleKey: 'report.quadro_92b.title',
    subtitleKey: 'report.quadro_92b.subtitle',
    icon: <Landmark size={20} />,
    colorClass: 'enrichment-card--purple',
    rows: parsedData.rows92B,
    sources: sources.table92B,
    columns: [
      { header: 'Nº Linha', accessor: (_, i) => String(991 + i) },
      { header: 'Código Rendimento', accessor: row => row.codigo },
      { header: 'País da Fonte', accessor: row => row.codPais },
      { header: 'Rendimento Líquido', accessor: row => row.rendimentoLiquido },
      { header: 'Imposto Pago no Estrangeiro', accessor: row => row.impostoPagoNoEstrangeiro },
      { header: 'País da Contraparte', accessor: row => row.codPaisContraparte },
    ],
    totals: [
      { label: 'report.totals.net_income', value: formatCurrency(sumBy(parsedData.rows92B, r => r.rendimentoLiquido)) },
      { label: 'report.totals.tax_paid_abroad', value: formatCurrency(sumBy(parsedData.rows92B, r => r.impostoPagoNoEstrangeiro)) },
    ],
  };

  const tableG13: TableConfig<TaxRowG13> = {
    titleKey: 'report.quadro_g13.title',
    subtitleKey: 'report.quadro_g13.subtitle',
    icon: <Activity size={20} />,
    colorClass: 'enrichment-card--blue',
    rows: parsedData.rowsG13,
    sources: sources.tableG13,
    columns: [
      { header: 'Código da operação', accessor: row => row.codigoOperacao },
      { header: 'Titular', accessor: row => row.titular },
      { header: 'Rendimento líquido', accessor: row => row.rendimentoLiquido },
      { header: 'País da contraparte', accessor: row => row.paisContraparte },
    ],
    totals: [
      { label: 'report.totals.net_income', value: formatCurrency(sumBy(parsedData.rowsG13, r => r.rendimentoLiquido)) },
    ],
  };

  const hasAnnexG = parsedData.rowsG13.length > 0;
  const hasAnnexJ = parsedData.rows8A.length > 0 || parsedData.rows92A.length > 0 || parsedData.rows92B.length > 0;

  const totalRows = parsedData.rows8A.length + parsedData.rows92A.length + parsedData.rows92B.length + parsedData.rowsG13.length;
  const activeTables = [parsedData.rows8A, parsedData.rows92A, parsedData.rows92B, parsedData.rowsG13].filter(r => r.length > 0).length;

  return (
    <div className="enrichment-report">
      <div className="enrichment-report__header">
        <div>
          <h2 className="enrichment-report__title">{t('tables.title')}</h2>
          <p className="enrichment-report__subtitle">
            {t('tables.subtitle', { count: totalRows, activeTables })}
          </p>
        </div>
      </div>

      {hasAnnexG && (
        <div className="enrichment-report__annex-group">
          <header className="enrichment-report__annex-title">
            {t('report.annex_g')} <span>{t('report.capital_gains')}</span>
          </header>
          <DataTable config={tableG13} />
        </div>
      )}

      {hasAnnexJ && (
        <div className="enrichment-report__annex-group">
          <header className="enrichment-report__annex-title">
            {t('report.annex_j')} <span>{t('report.foreign_income')}</span>
          </header>
          <DataTable config={table8A} />
          <DataTable config={table92A} />
          <DataTable config={table92B} />
        </div>
      )}
    </div>
  );
}
