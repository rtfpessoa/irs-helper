/** Broker labels used in enrichment summaries. */
export type BrokerName = 'XTB' | 'Trade Republic' | 'Trading 212';

/** Common fields shared by IRS table rows that include country information. */
export interface BaseTaxRow {
  codPais: string;
}

/** Anexo J - Quadro 9.2 A row (capital gains sells/acquisitions). */
export interface TaxRow extends BaseTaxRow {
  codigo: string;
  anoRealizacao: string;
  mesRealizacao: string;
  diaRealizacao: string;
  valorRealizacao: string;
  anoAquisicao: string;
  mesAquisicao: string;
  diaAquisicao: string;
  valorAquisicao: string;
  despesasEncargos: string;
  impostoPagoNoEstrangeiro: string;
  codPaisContraparte: string;
}

/** Anexo J - Quadro 9.2 B row (other investment income). */
export interface TaxRow92B extends BaseTaxRow {
  codigo: string;
  rendimentoLiquido: string;
  impostoPagoNoEstrangeiro: string;
  codPaisContraparte: string;
}

/** Anexo J - Quadro 8 A row (dividends and interest). */
export interface TaxRow8A extends BaseTaxRow {
  codigo: string;
  rendimentoBruto: string;
  impostoPago: string;
}

/** Anexo G - Quadro 13 row (CFDs/derivatives). */
export interface TaxRowG13 {
  codigoOperacao: string;
  titular: string;
  rendimentoLiquido: string;
  paisContraparte: string;
}

/** Parsed broker data normalized to IRS table rows. */
export interface ParsedPdfData {
  rows8A: TaxRow8A[];
  rows92A: TaxRow[];
  rows92B: TaxRow92B[];
  rowsG13: TaxRowG13[];
}

export interface TableSummary {
  /** Number of rows injected */
  rowsAdded: number;
  /** Map of label → formatted numeric total */
  totals: { label: string; value: string; currency?: boolean }[];
  /** Names of sources (brokers) that contributed rows */
  sources: string[];
}

export interface EnrichmentSummary {
  table8A: TableSummary;
  table92A: TableSummary;
  table92B: TableSummary;
  tableG13: TableSummary;
  /** Total rows across all tables */
  totalRowsAdded: number;
}

export interface EnrichmentResult {
  enrichedXml: string;
  originalXml: string;
  summary: EnrichmentSummary;
}
