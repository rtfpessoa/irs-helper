import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker for Vite
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

import type { TaxRow, TaxRow92B, TaxRow8A, TaxRowG13, ParsedPdfData } from '../types';

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 200;

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

function normalizeNumber(value: string): string {
  return value.replace(/,/g, '.');
}

function validatePdfSize(file: File): void {
  if (file.size > MAX_PDF_BYTES) {
    throw new PdfParsingError(
      `"${file.name}" exceeds the maximum supported file size.`,
      'parser.error.file_too_large',
      { fileName: file.name }
    );
  }
}

function itemToString(item: unknown): string {
  if (typeof item === 'object' && item !== null && 'str' in item) {
    const str = (item as { str?: unknown }).str;
    return typeof str === 'string' ? str : '';
  }
  return '';
}

async function extractPdfText(file: File): Promise<string[]> {
  validatePdfSize(file);

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new PdfParsingError(
      `"${file.name}" contains too many pages to be processed safely.`,
      'parser.error.too_many_pages',
      { fileName: file.name }
    );
  }

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map(itemToString).join(' '));
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

/** Known markers for Trading 212 Annual Statement */
const T212_REPORT_MARKERS = [
  /Trading\s*212/i,
  /Annual\s*Statement/i,
  /Trading\s*212\s*Markets/i,
];

// ---------------------------------------------------------------------------
// Country name → IRS 3-digit code mapping (shared utility)
// ---------------------------------------------------------------------------

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  'Germany': '276',
  'Australia': '036',
  'Austria': '040',
  'Belgium': '056',
  'Brazil': '076',
  'Canada': '124',
  'China': '156',
  'Cyprus': '196',
  'Denmark': '208',
  'Spain': '724',
  'United States': '840',
  'USA': '840',
  'US': '840',
  'Finland': '246',
  'France': '250',
  'Ireland': '372',
  'Italy': '380',
  'Japan': '392',
  'Luxembourg': '442',
  'Norway': '578',
  'Netherlands': '528',
  'Portugal': '620',
  'United Kingdom': '826',
  'UK': '826',
  'Sweden': '752',
  'Switzerland': '756',
};

export function resolveCountryCode(name: string): string | undefined {
  return COUNTRY_NAME_TO_CODE[name];
}

// ---------------------------------------------------------------------------
// Row extractors (pure functions, no file I/O)
// ---------------------------------------------------------------------------

function extractRows<T>(
  pageTexts: string[],
  sourceRegex: RegExp,
  buildRow: (match: RegExpExecArray) => T,
): T[] {
  const rows: T[] = [];

  for (const text of pageTexts) {
    const regex = new RegExp(sourceRegex.source, sourceRegex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      rows.push(buildRow(match));
    }
  }

  return rows;
}

function extractRows8A(pageTexts: string[]): TaxRow8A[] {
  return extractRows(pageTexts, REGEX_8A, match => ({
    codigo: match[1],
    codPais: match[2],
    rendimentoBruto: normalizeNumber(match[3]),
    impostoPago: normalizeNumber(match[4]),
  }));
}

function extractRows92A(pageTexts: string[]): TaxRow[] {
  return extractRows(pageTexts, REGEX_92A, match => ({
    codPais: match[1],
    codigo: match[2],
    anoRealizacao: match[3],
    mesRealizacao: match[4],
    diaRealizacao: match[5],
    valorRealizacao: normalizeNumber(match[6]),
    anoAquisicao: match[7],
    mesAquisicao: match[8],
    diaAquisicao: match[9],
    valorAquisicao: normalizeNumber(match[10]),
    despesasEncargos: normalizeNumber(match[11]),
    impostoPagoNoEstrangeiro: normalizeNumber(match[12]),
    codPaisContraparte: match[13],
  }));
}

function extractRows92B(pageTexts: string[]): TaxRow92B[] {
  return extractRows(pageTexts, REGEX_92B, match => ({
    codigo: match[1],
    codPais: match[2],
    rendimentoLiquido: normalizeNumber(match[3]),
    impostoPagoNoEstrangeiro: normalizeNumber(match[4]),
    codPaisContraparte: match[5],
  }));
}

function extractRowsG13(pageTexts: string[]): TaxRowG13[] {
  return extractRows(pageTexts, REGEX_G13, match => ({
    codigoOperacao: match[1],
    titular: match[2],
    rendimentoLiquido: normalizeNumber(match[3]),
    paisContraparte: match[4],
  }));
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
// Trading 212 — custom extraction (non-IRS-formatted PDF)
// ---------------------------------------------------------------------------

/** Strip thousand-separator commas (T212 uses English number format). */
function normalizeT212Number(value: string): string {
  return value.replace(/,/g, '');
}

/** Extract a €-prefixed amount from the Overview section. */
function extractOverviewAmount(fullText: string, label: RegExp): number {
  const match = fullText.match(new RegExp(label.source + '\\s+€([\\d,]+(?:\\.\\d+)?)', label.flags));
  if (!match) return 0;
  return parseFloat(normalizeT212Number(match[1])) || 0;
}

/**
 * Parse a Trading 212 Annual Statement PDF.
 * Extracts:
 *   - Interest on cash + Share lending interest → Quadro 8A (E21, Cyprus 196)
 *   - Dividends by country → Quadro 8A (E11, per country)
 * Throws a PdfParsingError if the file doesn't look like a T212 report.
 */
export async function parseTrading212Pdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  // Validate this looks like a Trading 212 document
  const looksLikeT212 = matchesAnyMarker(fullText, T212_REPORT_MARKERS);

  if (!looksLikeT212) {
    throw new PdfParsingError(
      `"${file.name}" does not appear to be a Trading 212 Annual Statement. Please upload the correct file.`,
      'parser.error.t212_wrong_file',
      { fileName: file.name }
    );
  }

  const rows8A: TaxRow8A[] = [];

  // --- Interest on cash + Share lending interest (E21, Cyprus 196) ---
  const interestOnCash = extractOverviewAmount(fullText, /Interest\s+on\s+cash/i);
  const shareLendingInterest = extractOverviewAmount(fullText, /Share\s+lending\s+interest/i);
  const totalInterest = interestOnCash + shareLendingInterest;

  if (totalInterest > 0) {
    rows8A.push({
      codigo: 'E21',
      codPais: '196',
      rendimentoBruto: totalInterest.toFixed(2),
      impostoPago: '0.00',
    });
  }

  // --- Dividends by country (E11, per country) ---
  const divSectionMatch = fullText.match(
    /NET\s+AMOUNT\s+\(EUR\)\s+(.*?)Dividends\s+by\s+instrument/s
  );

  if (divSectionMatch) {
    const divText = divSectionMatch[1];
    // Each row: <Country Name>  <Gross>  <Rate%|->  <WHT|->  <Net>
    const divRowRegex = /((?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+)*)\s+([\d,.]+)\s+(?:[\d.]+%|-)\s+([\d,.]+|-)\s+[\d,.]+/g;
    let match: RegExpExecArray | null;

    while ((match = divRowRegex.exec(divText)) !== null) {
      const countryName = match[1];
      const grossAmount = normalizeT212Number(match[2]);
      const wht = match[3] === '-' ? '0.00' : normalizeT212Number(match[3]);
      const countryCode = resolveCountryCode(countryName);

      if (countryCode) {
        rows8A.push({
          codigo: 'E11',
          codPais: countryCode,
          rendimentoBruto: grossAmount,
          impostoPago: wht,
        });
      }
    }
  }

  if (rows8A.length === 0) {
    throw new PdfParsingError(
      `No dividend/interest data found in "${file.name}". Please verify this is a Trading 212 Annual Statement.`,
      'parser.error.t212_no_rows',
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
