import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker for Vite
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

import type { TaxRow, TaxRow92B, TaxRow8A, TaxRowG13, ParsedPdfData } from '../types';

// ---------------------------------------------------------------------------
// Custom error for parsing failures
// ---------------------------------------------------------------------------

export class PdfParsingError extends Error {
  /** i18n key for the UI to use */
  public readonly i18nKey: string;
  /** Interpolation params for i18n */
  public readonly i18nParams: Record<string, string>;

  constructor(message: string, i18nKey: string, i18nParams: Record<string, string> = {}) {
    super(message);
    this.name = 'PdfParsingError';
    this.i18nKey = i18nKey;
    this.i18nParams = i18nParams;
  }
}

// ---------------------------------------------------------------------------
// Internal: extract full text from a PDF file
// ---------------------------------------------------------------------------

async function extractPdfText(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item: any) => item.str).join(' '));
  }
  return pageTexts;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

// Pattern for 8 A (Dividends and Interests)
// XTB format:  801 E11 840 3.71 0.57
// TR format:   801   E21 (28%)   276   110,8900   0,0000
const REGEX_8A = /(?:^|\s)\d{3}\s+(E\d{2})\s*(?:\(\d+%?\))?\s+(\d{3})\s+([\d.,-]+)\s+([\d.,-]+)(?=\s|$)/g;

// Table 9.2 A — capital gains (share/ETF sells & acquisitions)
// Example: 951 372 G20 2025 6 16 105.84 2024 6 26 104.04 0.00 0.00 620
const REGEX_92A = /(?:^|\s)\d{3}\s+(\d{3})\s+(G\d{2})\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+([\d.,-]+)\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+([\d.,-]+)\s+([\d.,-]+)\s+([\d.,-]+)\s+(\d{3})(?=\s|$)/g;

// Pattern for 9.2 B — other investment income
// Example: 991 G98 372 25.32 0.00 620
const REGEX_92B = /(?:^|\s)\d{3}\s+(G\d{2})\s+(\d{3})\s+([\d.,-]+)\s+([\d.,-]+)\s+(\d{3})(?=\s|$)/g;

// Pattern for Anexo G Quadro 13 (CFDs / Derivative instruments)
// Example: 13001   G51   A   -43.94   620
const REGEX_G13 = /(?:^|\s)\d{5}\s+(G\d{2})\s+([AB])\s+(-?[\d.,-]+)\s+(\d{3})(?=\s|$)/g;

// ---------------------------------------------------------------------------
// Content fingerprints — used to identify which PDF type was uploaded
// ---------------------------------------------------------------------------

/** Known markers that appear in XTB Capital Gains PDFs */
const XTB_GAINS_MARKERS = [
  /Quadro\s*9\.?2\s*A/i,
  /9\.2\s*A\s*-?\s*(?:Aliena|Venda)/i,
  /AnexoJ.*Quadro\s*0?9/i,
  /Mais[- ]?[Vv]alias/i,
  /Capital\s*Gains/i,
];

/** Known markers that appear in XTB Dividends PDFs */
const XTB_DIVIDENDS_MARKERS = [
  /Quadro\s*8\s*A/i,
  /8\s*A\s*-?\s*Divid/i,
  /Dividendos/i,
  /Dividend/i,
  /AnexoJ.*Quadro\s*0?8/i,
];

/** Known markers for TR Tax Report */
const TR_REPORT_MARKERS = [
  /Trade\s*Republic/i,
  /Steuerübersicht/i,
  /Tax\s*Report/i,
  /Relatório\s*(?:de\s*)?Impost/i,
];

// ---------------------------------------------------------------------------
// Row extractors (pure functions, no file I/O)
// ---------------------------------------------------------------------------

function extractRows8A(pageTexts: string[]): TaxRow8A[] {
  const rows: TaxRow8A[] = [];
  for (const text of pageTexts) {
    const regex = new RegExp(REGEX_8A.source, REGEX_8A.flags);
    let m;
    while ((m = regex.exec(text)) !== null) {
      rows.push({
        codigo: m[1],
        codPais: m[2],
        rendimentoBruto: m[3].replace(/,/g, '.'),
        impostoPago: m[4].replace(/,/g, '.'),
      });
    }
  }
  return rows;
}

function extractRows92A(pageTexts: string[]): TaxRow[] {
  const rows: TaxRow[] = [];
  for (const text of pageTexts) {
    const regex = new RegExp(REGEX_92A.source, REGEX_92A.flags);
    let m;
    while ((m = regex.exec(text)) !== null) {
      rows.push({
        codPais: m[1],
        codigo: m[2],
        anoRealizacao: m[3],
        mesRealizacao: m[4],
        diaRealizacao: m[5],
        valorRealizacao: m[6].replace(',', '.'),
        anoAquisicao: m[7],
        mesAquisicao: m[8],
        diaAquisicao: m[9],
        valorAquisicao: m[10].replace(',', '.'),
        despesasEncargos: m[11].replace(',', '.'),
        impostoPagoNoEstrangeiro: m[12].replace(',', '.'),
        codPaisContraparte: m[13],
      });
    }
  }
  return rows;
}

function extractRows92B(pageTexts: string[]): TaxRow92B[] {
  const rows: TaxRow92B[] = [];
  for (const text of pageTexts) {
    const regex = new RegExp(REGEX_92B.source, REGEX_92B.flags);
    let m;
    while ((m = regex.exec(text)) !== null) {
      rows.push({
        codigo: m[1],
        codPais: m[2],
        rendimentoLiquido: m[3].replace(',', '.'),
        impostoPagoNoEstrangeiro: m[4].replace(',', '.'),
        codPaisContraparte: m[5],
      });
    }
  }
  return rows;
}

function extractRowsG13(pageTexts: string[]): TaxRowG13[] {
  const rows: TaxRowG13[] = [];
  for (const text of pageTexts) {
    const regex = new RegExp(REGEX_G13.source, REGEX_G13.flags);
    let m;
    while ((m = regex.exec(text)) !== null) {
      rows.push({
        codigoOperacao: m[1],
        titular: m[2],
        rendimentoLiquido: m[3].replace(/,/g, '.'),
        paisContraparte: m[4],
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Helper: check if any marker matches the full text
// ---------------------------------------------------------------------------

function matchesAnyMarker(fullText: string, markers: RegExp[]): boolean {
  return markers.some(marker => marker.test(fullText));
}

// ===========================================================================
// Public API — Broker-specific parsers
// ===========================================================================

/**
 * Parse an XTB Capital Gains PDF.
 * Expected tables: Quadro 9.2 A, 9.2 B, and Quadro G13.
 * Throws a PdfParsingError if the file looks like a Dividends PDF instead.
 */
export async function parseXtbCapitalGainsPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  // Validate this isn't a Dividends PDF
  const looksLikeDividends = matchesAnyMarker(fullText, XTB_DIVIDENDS_MARKERS);
  const looksLikeGains = matchesAnyMarker(fullText, XTB_GAINS_MARKERS);

  if (looksLikeDividends && !looksLikeGains) {
    throw new PdfParsingError(
      'The uploaded file appears to be an XTB Dividends PDF, but it was placed in the Capital Gains slot.',
      'parser.error.xtb_wrong_file_gains',
      { fileName: file.name }
    );
  }

  const rows92A = extractRows92A(pageTexts);
  const rows92B = extractRows92B(pageTexts);
  const rowsG13 = extractRowsG13(pageTexts);

  const totalRows = rows92A.length + rows92B.length + rowsG13.length;
  if (totalRows === 0) {
    throw new PdfParsingError(
      `No capital gains rows found in "${file.name}". Please verify this is an XTB Capital Gains report.`,
      'parser.error.xtb_no_gains_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A: [],
    rows92A,
    rows92B,
    rowsG13,
  };
}

/**
 * Parse an XTB Dividends PDF.
 * Expected tables: Quadro 8 A (Dividends & Interests).
 * Throws a PdfParsingError if the file looks like a Capital Gains PDF instead.
 */
export async function parseXtbDividendsPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  // Validate this isn't a Capital Gains PDF
  const looksLikeGains = matchesAnyMarker(fullText, XTB_GAINS_MARKERS);
  const looksLikeDividends = matchesAnyMarker(fullText, XTB_DIVIDENDS_MARKERS);

  if (looksLikeGains && !looksLikeDividends) {
    throw new PdfParsingError(
      'The uploaded file appears to be an XTB Capital Gains PDF, but it was placed in the Dividends slot.',
      'parser.error.xtb_wrong_file_dividends',
      { fileName: file.name }
    );
  }

  const rows8A = extractRows8A(pageTexts);

  if (rows8A.length === 0) {
    throw new PdfParsingError(
      `No dividend rows found in "${file.name}". Please verify this is an XTB Dividends report.`,
      'parser.error.xtb_no_dividends_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A,
    rows92A: [],
    rows92B: [],
    rowsG13: [],
  };
}

/**
 * Parse a Trade Republic Tax Report PDF.
 * Expected tables: Quadro 8 A (Dividends & Interests).
 * Throws a PdfParsingError if the file doesn't look like a TR report.
 */
export async function parseTradeRepublicPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  // Validate this looks like a Trade Republic document
  const looksLikeTR = matchesAnyMarker(fullText, TR_REPORT_MARKERS);

  if (!looksLikeTR) {
    throw new PdfParsingError(
      `"${file.name}" does not appear to be a Trade Republic Tax Report. Please upload the correct file.`,
      'parser.error.tr_wrong_file',
      { fileName: file.name }
    );
  }

  const rows8A = extractRows8A(pageTexts);

  if (rows8A.length === 0) {
    throw new PdfParsingError(
      `No dividend/interest rows found in "${file.name}". Please verify this is a Trade Republic Tax Report with Quadro 8A data.`,
      'parser.error.tr_no_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A,
    rows92A: [],
    rows92B: [],
    rowsG13: [],
  };
}

// ---------------------------------------------------------------------------
// Legacy generic parser (kept for backward compatibility in tests)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use broker-specific parsers instead:
 *   - parseXtbCapitalGainsPdf
 *   - parseXtbDividendsPdf
 *   - parseTradeRepublicPdf
 */
export async function extractTableRowsFromPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);

  return {
    rows8A: extractRows8A(pageTexts),
    rows92A: extractRows92A(pageTexts),
    rows92B: extractRows92B(pageTexts),
    rowsG13: extractRowsG13(pageTexts),
  };
}
