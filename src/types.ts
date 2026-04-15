export interface TaxRow {
  codPais: string;
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

export interface TaxRow92B {
  codigo: string;
  codPais: string;
  rendimentoLiquido: string;
  impostoPagoNoEstrangeiro: string;
  codPaisContraparte: string;
}

export interface TaxRow8A {
  codigo: string;
  codPais: string;
  rendimentoBruto: string;
  impostoPago: string;
}

export interface TaxRowG13 {
  codigoOperacao: string;
  titular: string;
  rendimentoLiquido: string;
  paisContraparte: string;
}

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
