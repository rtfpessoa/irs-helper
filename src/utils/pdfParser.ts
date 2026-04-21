import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker for Vite
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

import type { TaxRow, TaxRow92B, TaxRow8A, TaxRowG9, TaxRowG13, ParsedPdfData } from '../types';
import { resolveCountryCode, resolveCountryCodeFromIsin } from './brokerCountries';
import { BrokerParsingError } from './parserErrors';

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 200;

// ---------------------------------------------------------------------------
// Custom error for parsing failures
// ---------------------------------------------------------------------------

export { BrokerParsingError as PdfParsingError };

// ---------------------------------------------------------------------------
// Internal: extract full text from a PDF file
// ---------------------------------------------------------------------------

function normalizeNumber(value: string): string {
  return value.replace(/,/g, '.');
}

function validatePdfSize(file: File): void {
  if (file.size > MAX_PDF_BYTES) {
    throw new BrokerParsingError(
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
    throw new BrokerParsingError(
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
const REGEX_92A = /(?:^|\s)\d{3,}\s+(\d{3})\s+(G\d{2})\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+([\d.,-]+)\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+([\d.,-]+)\s+([\d.,-]+)\s+([\d.,-]+)\s+(\d{3})(?=\s|$)/g;

// Pattern for 9.2 B — other investment income
// Example: 991 G98 372 25.32 0.00 620
const REGEX_92B = /(?:^|\s)\d{3,}\s+(G\d{2})\s+(\d{3})\s+([\d.,-]+)\s+([\d.,-]+)\s+(\d{3})(?=\s|$)/g;

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

/** Known markers for ActivoBank statements */
const ACTIVOBANK_MARKERS = [
  /ActivoBank/i,
  /activobank\.pt/i,
  /Aliena[çc][ãa]o\s*[Oo]nerosa\s*de\s*Valores\s*Mobili[áa]rios/i,
];

// ---------------------------------------------------------------------------
// Country name → IRS 3-digit code mapping (shared utility)
// ---------------------------------------------------------------------------

export { resolveCountryCode };

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
    throw new BrokerParsingError(
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
    throw new BrokerParsingError(
      `No capital gains rows found in "${file.name}". Please verify this is an XTB Capital Gains report.`,
      'parser.error.xtb_no_gains_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A: [],
    rows92A,
    rows92B,
    rowsG9: [],
    rowsG13,
    rowsG18A: [],
    rowsG1q7: [],
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
    throw new BrokerParsingError(
      'The uploaded file appears to be an XTB Capital Gains PDF, but it was placed in the Dividends slot.',
      'parser.error.xtb_wrong_file_dividends',
      { fileName: file.name }
    );
  }

  const rows8A = extractRows8A(pageTexts);

  if (rows8A.length === 0) {
    throw new BrokerParsingError(
      `No dividend rows found in "${file.name}". Please verify this is an XTB Dividends report.`,
      'parser.error.xtb_no_dividends_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A,
    rows92A: [],
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
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
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a Trade Republic Tax Report. Please upload the correct file.`,
      'parser.error.tr_wrong_file',
      { fileName: file.name }
    );
  }

  const rows8A = extractRows8A(pageTexts);

  if (rows8A.length === 0) {
    throw new BrokerParsingError(
      `No dividend/interest rows found in "${file.name}". Please verify this is a Trade Republic Tax Report with Quadro 8A data.`,
      'parser.error.tr_no_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A,
    rows92A: [],
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
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
    throw new BrokerParsingError(
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
    throw new BrokerParsingError(
      `No dividend/interest data found in "${file.name}". Please verify this is a Trading 212 Annual Statement.`,
      'parser.error.t212_no_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A,
    rows92A: [],
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
  };
}

// ---------------------------------------------------------------------------
// ActivoBank — Alienação Onerosa de Valores Mobiliários
// ---------------------------------------------------------------------------

/** ActivoBank NIF (tax identification number). */
const ACTIVOBANK_NIF = '500734305';

/**
 * Regex for ActivoBank stock transaction rows.
 * Matches lines like:
 *   NIO INC - ADR 136 18 2024/03/28 81,49 2021/05/03 662,48 10,69
 *   TESLA INC 840 1 2024/10/04 224,11 2023/07/20 245,31 0,27
 *
 * Groups:
 *   1: Designação (stock name)
 *   2: Código País (country code, 3 digits)
 *   3: Quantidade (shares count)
 *   4: Data Realização (sale date YYYY/MM/DD)
 *   5: Valor Realização (sale value, comma decimal)
 *   6: Data Aquisição (purchase date YYYY/MM/DD)
 *   7: Valor Aquisição (purchase value, comma decimal)
 *   8: Encargos (charges, comma decimal)
 */
const REGEX_ACTIVOBANK = /(.+?)\s+(\d{3})\s+(\d+)\s+(\d{4}\/\d{2}\/\d{2})\s+([\d.,]+)\s+(\d{4}\/\d{2}\/\d{2})\s+([\d.,]+)\s+([\d.,]+)/g;

function parseActivoBankDate(dateStr: string): { year: string; month: string; day: string } {
  const [year, month, day] = dateStr.split('/');
  return {
    year,
    month: String(parseInt(month, 10)),
    day: String(parseInt(day, 10)),
  };
}

/**
 * Parse an ActivoBank "Alienação Onerosa de Valores Mobiliários" PDF.
 * Expected output: Anexo G Quadro 9 rows (shares sold through a PT entity).
 * Throws a PdfParsingError if the file doesn't look like an ActivoBank statement.
 */
export async function parseActivoBankPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  const looksLikeActivoBank = matchesAnyMarker(fullText, ACTIVOBANK_MARKERS);

  if (!looksLikeActivoBank) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be an ActivoBank statement. Please upload the correct file.`,
      'parser.error.activobank_wrong_file',
      { fileName: file.name }
    );
  }

  const rowsG9: TaxRowG9[] = [];

  for (const text of pageTexts) {
    const regex = new RegExp(REGEX_ACTIVOBANK.source, REGEX_ACTIVOBANK.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const countryCode = match[2];
      const saleDate = parseActivoBankDate(match[4]);
      const purchaseDate = parseActivoBankDate(match[6]);

      rowsG9.push({
        titular: 'A',
        nif: ACTIVOBANK_NIF,
        codEncargos: 'G01',
        anoRealizacao: saleDate.year,
        mesRealizacao: saleDate.month,
        diaRealizacao: saleDate.day,
        valorRealizacao: normalizeNumber(match[5]),
        anoAquisicao: purchaseDate.year,
        mesAquisicao: purchaseDate.month,
        diaAquisicao: purchaseDate.day,
        valorAquisicao: normalizeNumber(match[7]),
        despesasEncargos: normalizeNumber(match[8]),
        paisContraparte: countryCode,
      });
    }
  }

  if (rowsG9.length === 0) {
    throw new BrokerParsingError(
      `No stock transaction rows found in "${file.name}". Please verify this is an ActivoBank capital gains statement.`,
      'parser.error.activobank_no_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A: [],
    rows92A: [],
    rows92B: [],
    rowsG9,
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
  };
}

// ---------------------------------------------------------------------------
// Freedom24 — Trade report for a tax return
// ---------------------------------------------------------------------------

/** Known markers for Freedom24 trade reports */
const FREEDOM24_MARKERS = [
  /Freedom24/i,
  /Trade\s+report\s+for\s+a\s+tax\s+return/i,
];

/** ISIN 2-letter country prefix → IRS 3-digit country code */
const ISIN_PREFIX_TO_COUNTRY_CODE: Record<string, string> = {
  AT: '040',
  AU: '036',
  BE: '056',
  BR: '076',
  CA: '124',
  CH: '756',
  CN: '156',
  CY: '196',
  DE: '276',
  DK: '208',
  ES: '724',
  FI: '246',
  FR: '250',
  GB: '826',
  IE: '372',
  IT: '380',
  JP: '392',
  LU: '442',
  NL: '528',
  NO: '578',
  PL: '616',
  PT: '620',
  SE: '752',
  US: '840',
  KY: '136',
  VG: '092',
  BM: '060',
  MH: '584',
  JE: '832',
  IL: '376',
};

/**
 * Maps the 2-letter ISIN country prefix to an IRS 3-digit country code.
 * Falls back to '840' (United States) when the prefix is unknown.
 * Note: ADRs of foreign companies (e.g., ASML with ISIN USN...) will be
 * mapped to US (840) due to their US-prefixed ISIN — verify manually.
 */
export function isinToCountryCode(isin: string): string {
  const prefix = isin.substring(0, 2).toUpperCase();
  return ISIN_PREFIX_TO_COUNTRY_CODE[prefix] ?? '840';
}

/**
 * Regex for Freedom24 dividend / coupon rows.
 * Groups:
 *   1: Account ID
 *   2: Date (YYYY-MM-DD)
 *   3: Ticker
 *   4: ISIN (12 chars)
 *   5: Optional tax fields string (0–2 entries like "-0.19000000USD " or "0.31000000DKK ")
 *   6: Currency (3 uppercase letters)
 *   7: Gross Amount in original currency
 *   8: Exchange Rate (EUR per 1 original currency unit)
 *   9: Amount in EUR (gross)
 */
const REGEX_FREEDOM24_DIVIDEND =
  /\b(\d{7,})\s+(\d{4}-\d{2}-\d{2})\s+(\S+)\s+([A-Z]{2}[A-Z0-9]{10})\s+(?:dividend|coupon)\s+((?:-?[\d.]+[A-Z]{2,3}\s+){0,2})([A-Z]{3})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g;

/**
 * Regex for Freedom24 stock trade rows (instrument type = "Stocks").
 * Groups:
 *   1: Account ID (with optional 'D' prefix)
 *   2: Ticker
 *   3: ISIN
 *   4: Direction (Buy | Sell)
 *   5: Quantity
 *   6: Currency (3 letters)
 *   7: Amount (quantity × price, in original currency)
 *   8: Exchange Rate
 *   9: Fee amount (numeric part)
 *  10: Settlement date (YYYY-MM-DD)
 */
const REGEX_FREEDOM24_STOCK_TRADE =
  /([D]?\d{7,})\s+\d+\s+(\S+)\s+([A-Z]{2}[A-Z0-9]{10})\s+Stocks\s+\S+\s+(Buy|Sell)\s+([\d.]+)\s+[\d.]+\s+([A-Z]{3})\s+([\d.]+)\s+-?[\d.]+\s+([\d.]+)\s+-?[\d.]+\s+([\d.]+)[A-Z]{3}\s+(\d{4}-\d{2}-\d{2})/g;

/** Internal representation of a single Freedom24 stock trade row. */
interface Freedom24TradeRecord {
  ticker: string;
  isin: string;
  direction: 'Buy' | 'Sell';
  quantity: number;
  currency: string;
  amount: number;
  exchangeRate: number;
  feeAmount: number;
  settlementDate: string;
}

/**
 * Parses the optional tax fields string from a Freedom24 dividend row.
 * Returns the total withheld tax in the original currency (absolute value).
 * Input examples: "-0.19000000USD " | "0.31000000USD " | "4.27000000DKK " | ""
 */
function parseFreedom24TaxFields(taxFieldsStr: string): number {
  let total = 0;
  const parts = taxFieldsStr.trim().split(/\s+/).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^-?([\d.]+)[A-Z]{2,3}$/);
    if (m) {
      total += parseFloat(m[1]);
    }
  }
  return total;
}

/**
 * Matches Freedom24 stock sell trades to their corresponding buys (FIFO)
 * and produces Quadro 9.2A rows. Sells without a matching buy in the
 * current document (opened in a prior period) are silently skipped.
 */
function buildFreedom24Rows92A(trades: Freedom24TradeRecord[]): TaxRow[] {
  // Sort ascending by settlement date for FIFO ordering
  const sorted = [...trades].sort((a, b) => a.settlementDate.localeCompare(b.settlementDate));

  const buyPool: Record<string, Array<{ trade: Freedom24TradeRecord; remainingQty: number }>> = {};
  const rows: TaxRow[] = [];

  for (const trade of sorted) {
    if (trade.direction === 'Buy') {
      if (!buyPool[trade.ticker]) buyPool[trade.ticker] = [];
      buyPool[trade.ticker].push({ trade, remainingQty: trade.quantity });
    } else {
      const pool = buyPool[trade.ticker] ?? [];
      let remainingSellQty = trade.quantity;

      while (remainingSellQty > 0 && pool.length > 0) {
        const buyEntry = pool[0];
        if (buyEntry.remainingQty <= 0) {
          pool.shift();
          continue;
        }

        const matchedQty = Math.min(buyEntry.remainingQty, remainingSellQty);
        const sellProportion = matchedQty / trade.quantity;
        const buyProportion = matchedQty / buyEntry.trade.quantity;

        const valorRealizacao = trade.amount * sellProportion * trade.exchangeRate;
        const valorAquisicao = buyEntry.trade.amount * buyProportion * buyEntry.trade.exchangeRate;
        const despesasEncargos =
          trade.feeAmount * sellProportion * trade.exchangeRate +
          buyEntry.trade.feeAmount * buyProportion * buyEntry.trade.exchangeRate;

        const saleDateParts = trade.settlementDate.split('-');
        const buyDateParts = buyEntry.trade.settlementDate.split('-');
        const countryCode = isinToCountryCode(trade.isin);

        rows.push({
          codPais: countryCode,
          codigo: 'G20',
          anoRealizacao: saleDateParts[0],
          mesRealizacao: String(parseInt(saleDateParts[1], 10)),
          diaRealizacao: String(parseInt(saleDateParts[2], 10)),
          valorRealizacao: valorRealizacao.toFixed(2),
          anoAquisicao: buyDateParts[0],
          mesAquisicao: String(parseInt(buyDateParts[1], 10)),
          diaAquisicao: String(parseInt(buyDateParts[2], 10)),
          valorAquisicao: valorAquisicao.toFixed(2),
          despesasEncargos: despesasEncargos.toFixed(2),
          impostoPagoNoEstrangeiro: '0.00',
          codPaisContraparte: countryCode,
        });

        buyEntry.remainingQty -= matchedQty;
        remainingSellQty -= matchedQty;

        if (buyEntry.remainingQty <= 0) {
          pool.shift();
        }
      }
      // Remaining qty with no matching buy = opened in a prior period; skip.
    }
  }

  return rows;
}

/**
 * Parse a Freedom24 "Trade report for a tax return" PDF.
 * Extracts:
 *   - Dividends / coupons → Quadro 8A (E11, country from ISIN prefix)
 *   - Stock sell trades matched to buys within the same document → Quadro 9.2A (G20)
 *
 * Known limitations:
 *   - Equity swaps and other derivative instrument closes are not imported.
 *   - Sell trades whose opening buy belongs to a previous period are skipped.
 *   - ADR ISINs with a US prefix (e.g. ASML USN...) are mapped to country 840
 *     (United States) — verify the country field manually for such instruments.
 *
 * Throws a PdfParsingError if the file doesn't look like a Freedom24 report.
 */
export async function parseFreedom24Pdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  const looksLikeF24 = matchesAnyMarker(fullText, FREEDOM24_MARKERS);
  if (!looksLikeF24) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a Freedom24 Trade Report. Please upload the correct file.`,
      'parser.error.freedom24_wrong_file',
      { fileName: file.name },
    );
  }

  // --- Dividends / coupons → rows8A ---
  const rows8A: TaxRow8A[] = [];
  for (const text of pageTexts) {
    const regex = new RegExp(REGEX_FREEDOM24_DIVIDEND.source, REGEX_FREEDOM24_DIVIDEND.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const isin = match[4];
      const taxFieldsStr = match[5];
      const exchangeRate = parseFloat(match[8]);
      const amountInEur = match[9];

      const totalTaxInOriginalCurrency = parseFreedom24TaxFields(taxFieldsStr);
      const impostoPago = (totalTaxInOriginalCurrency * exchangeRate).toFixed(2);
      const countryCode = isinToCountryCode(isin);

      rows8A.push({
        codigo: 'E11',
        codPais: countryCode,
        rendimentoBruto: normalizeNumber(amountInEur),
        impostoPago,
      });
    }
  }

  // --- Stock trades → rows92A (FIFO matching) ---
  const trades: Freedom24TradeRecord[] = [];
  for (const text of pageTexts) {
    const regex = new RegExp(REGEX_FREEDOM24_STOCK_TRADE.source, REGEX_FREEDOM24_STOCK_TRADE.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      trades.push({
        ticker: match[2],
        isin: match[3],
        direction: match[4] as 'Buy' | 'Sell',
        quantity: parseFloat(match[5]),
        currency: match[6],
        amount: parseFloat(match[7]),
        exchangeRate: parseFloat(match[8]),
        feeAmount: parseFloat(match[9]),
        settlementDate: match[10],
      });
    }
  }

  const rows92A = buildFreedom24Rows92A(trades);

  const totalRows = rows8A.length + rows92A.length;
  if (totalRows === 0) {
    throw new BrokerParsingError(
      `No dividend or trade data found in "${file.name}". Please verify this is a Freedom24 Trade Report.`,
      'parser.error.freedom24_no_rows',
      { fileName: file.name },
    );
  }

  return {
    rows8A,
    rows92A,
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
  };
}

// ---------------------------------------------------------------------------
// IBKR — Activity Statement
// ---------------------------------------------------------------------------

/** Known markers that ALL must appear in an IBKR Activity Statement PDF. */
const IBKR_MARKERS = [
  'Activity Statement',
  'Mark-to-Market Performance Summary',
  'Realized & Unrealized Performance Summary',
];

/**
 * Two-letter WHT country codes used in IBKR Withholding Tax descriptions.
 * Maps to IRS 3-digit country codes.
 */
const WHT_COUNTRY_CODE: Record<string, string> = {
  US: '840',
  IT: '380',
  FR: '250',
  DE: '276',
  BR: '076',
  JP: '392',
  SE: '752',
  PL: '616',
  GB: '826',
  CA: '124',
  CH: '756',
};

/** Strip IBKR comma thousands-separators before parseFloat. */
function parseIbkrNumber(s: string): number {
  return parseFloat(s.replace(/,/g, ''));
}

/**
 * Extracts a sub-string of `text` starting at the first occurrence of `start`
 * and ending before the first occurrence of any string in `ends` (after `start`).
 * Search is case-insensitive and leading/trailing whitespace in markers is ignored.
 * Returns '' when `start` is not found.
 */
function extractIbkrSection(text: string, start: string, ends: string[]): string {
  const lowerText = text.toLowerCase();
  const needle = start.trim().toLowerCase();
  const startIdx = lowerText.indexOf(needle);
  if (startIdx === -1) return '';

  let endIdx = text.length;
  for (const end of ends) {
    const endNeedle = end.trim().toLowerCase();
    const idx = lowerText.indexOf(endNeedle, startIdx + needle.length);
    if (idx !== -1 && idx < endIdx) endIdx = idx;
  }

  return text.slice(startIdx, endIdx);
}

/**
 * Extracts a sub-string of `text` starting at the first match of `startPattern`
 * and ending before the first occurrence of any string in `ends` (after the match).
 * Returns '' when `startPattern` does not match.
 */
function findIbkrSectionByRegex(text: string, startPattern: RegExp, ends: string[]): string {
  const startMatch = startPattern.exec(text);
  if (!startMatch) return '';
  const startIdx = startMatch.index;

  const lowerText = text.toLowerCase();
  let endIdx = text.length;
  for (const end of ends) {
    const endNeedle = end.trim().toLowerCase();
    const idx = lowerText.indexOf(endNeedle, startIdx + startMatch[0].length);
    if (idx !== -1 && idx < endIdx) endIdx = idx;
  }

  return text.slice(startIdx, endIdx);
}

/** Internal: one buy lot for FIFO matching in IBKR stock trades. */
interface IbkrBuyLot {
  date: string;
  remainingQty: number;
}

/** Internal: one sell trade record from an IBKR statement. */
interface IbkrSellTrade {
  symbol: string;
  date: string;
  qty: number;
  proceeds: number;
  commFee: number;
  basis: number;
}

/** Internal: one dividend entry from an IBKR statement. */
interface IbkrDividend {
  date: string;
  ticker: string;
  isin: string;
  amount: number;
}

/** Internal: one withholding-tax entry from an IBKR statement. */
interface IbkrWhtEntry {
  date: string;
  ticker: string;
  isin: string;
  countryCode: string;
  amount: number;
}

/**
 * FIFO matching for IBKR stock sell trades.
 * Builds `TaxRow` entries using the Basis/Proceeds already provided by IBKR per sell row.
 * Only the acquisition DATE is resolved through FIFO (values are proportioned to matched qty).
 * Sells whose opening buy is not present in this document are silently skipped.
 */
function buildIbkrRows92A(
  buyPool: Record<string, IbkrBuyLot[]>,
  sellTrades: IbkrSellTrade[],
  instrumentMap: Map<string, string>,
): TaxRow[] {
  const rows: TaxRow[] = [];

  for (const sell of sellTrades) {
    const pool = buyPool[sell.symbol] ?? [];
    let remainingSellQty = sell.qty;

    while (remainingSellQty > 0 && pool.length > 0) {
      const buyEntry = pool[0];
      if (buyEntry.remainingQty <= 0) {
        pool.shift();
        continue;
      }

      const matchedQty = Math.min(buyEntry.remainingQty, remainingSellQty);
      const proportion = matchedQty / sell.qty;

      const valorRealizacao = Math.abs(sell.proceeds) * proportion;
      const valorAquisicao = Math.abs(sell.basis) * proportion;
      const despesasEncargos = Math.abs(sell.commFee) * proportion;

      const sellParts = sell.date.split('-');
      const buyParts = buyEntry.date.split('-');
      const isin = instrumentMap.get(sell.symbol) ?? '';
      const countryCode = isinToCountryCode(isin);

      rows.push({
        codPais: countryCode,
        codigo: 'G20',
        anoRealizacao: sellParts[0],
        mesRealizacao: String(parseInt(sellParts[1], 10)),
        diaRealizacao: String(parseInt(sellParts[2], 10)),
        valorRealizacao: valorRealizacao.toFixed(2),
        anoAquisicao: buyParts[0],
        mesAquisicao: String(parseInt(buyParts[1], 10)),
        diaAquisicao: String(parseInt(buyParts[2], 10)),
        valorAquisicao: valorAquisicao.toFixed(2),
        despesasEncargos: despesasEncargos.toFixed(2),
        impostoPagoNoEstrangeiro: '0.00',
        codPaisContraparte: countryCode,
      });

      buyEntry.remainingQty -= matchedQty;
      remainingSellQty -= matchedQty;
      if (buyEntry.remainingQty <= 0) pool.shift();
    }
    // Remaining qty with no matching buy = prior period; skip silently.
  }

  return rows;
}

/**
 * Parse an IBKR Activity Statement PDF.
 * Extracts:
 *   - Stock sell trades (FIFO matched) → Quadro 9.2A (G20)
 *   - Dividends with WHT → Quadro 8A (E11, country from WHT or ISIN prefix)
 *   - Credit/SYEP interest → Quadro 8A (E21, Ireland 372)
 *   - Options realized P/L → Quadro G13 (G51, US 840)
 *   - CFD realized P/L → Quadro G13 (G51, Ireland 372)
 *
 * Known limitations:
 *   - Non-EUR trade amounts are reported in their original currency; manual EUR conversion required.
 *   - ADR dividends with no WHT fall back to the ISIN prefix country (typically US/840).
 *   - Sells whose opening buy is from a prior period are skipped.
 *
 * Throws a PdfParsingError if the file doesn't look like an IBKR Activity Statement.
 */
export async function parseIbkrPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  // --- Validate fingerprint ---
  const allMarkersPresent = IBKR_MARKERS.every(m => fullText.includes(m));
  if (!allMarkersPresent) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be an IBKR Activity Statement.`,
      'parser.error.ibkr_wrongFile',
      { fileName: file.name },
    );
  }

  console.log('[IBKR] fullText length:', fullText.length);
  console.log('[IBKR] fullText sample (chars 0-500):', fullText.substring(0, 500));

  // ---------------------------------------------------------------------------
  // Step A: Build instrument map  (ticker → ISIN)
  // In the "Financial Instrument Information" section each row is:
  //   Symbol  Description  Conid  SecurityID  Underlying  ListingExch  Mult  Type  Code
  // After pdf.js joins items with spaces the ISIN appears mid-row.
  // We scan backward from each ISIN to find the ticker (first token of its row).
  // ---------------------------------------------------------------------------
  const fiiSection = extractIbkrSection(fullText, 'Financial Instrument Information', ['Trades', 'Dividends', 'Open Positions', 'Net Asset Value']);
  // Strip the FII column header row so the first data token is a ticker symbol.
  const fiiHeaderEnd = /\bCode\s+/i.exec(fiiSection);
  const fiiData = fiiHeaderEnd ? fiiSection.slice(fiiHeaderEnd.index + fiiHeaderEnd[0].length) : fiiSection;

  const instrumentMap = new Map<string, string>();
  const isinPattern = /([A-Z]{2}[A-Z0-9]{9}\d)/g;
  let fiiMatch: RegExpExecArray | null;
  while ((fiiMatch = isinPattern.exec(fiiData)) !== null) {
    const isin = fiiMatch[1];
    const chunk = fiiData.substring(Math.max(0, fiiMatch.index - 300), fiiMatch.index).trim();
    // Split by row-terminating TYPE keywords to isolate the current row's start
    const afterLastType = chunk.split(/\b(?:COMMON|ADR|ETF|REIT|FUND|PREFERRED|BOND|NOTE|RIGHT|WARRANT)\b/i).pop() ?? chunk;
    const tickerMatch = afterLastType.trim().match(/^([A-Z0-9][A-Z0-9.]{0,10})\b/);
    if (tickerMatch && !/^\d+$/.test(tickerMatch[1])) {
      if (!instrumentMap.has(tickerMatch[1])) {
        instrumentMap.set(tickerMatch[1], isin);
      }
    }
  }

  console.log('[IBKR] fiiSection length:', fiiSection.length, 'sample:', fiiSection.substring(0, 200));
  console.log('[IBKR] instrumentMap size:', instrumentMap.size);

  // ---------------------------------------------------------------------------
  // Step B: Extract stock trades → rows92A (FIFO buy/sell matching)
  // Scope to the Stocks subsection of Trades to avoid option/CFD symbols.
  // ---------------------------------------------------------------------------
  const tradesSection = findIbkrSectionByRegex(
    fullText,
    /Trades\s+Symbol\s+Date\/Time/i,
    ['Corporate Actions']
  );
  const stocksText = extractIbkrSection(tradesSection, 'Stocks', ['Equity and Index Options', 'CFDs', 'Forex']);
  console.log('[IBKR] tradesSection length:', tradesSection.length);
  console.log('[IBKR] stocksSection length:', stocksText.length);

  // Trade row format: SYMBOL  DATE, TIME  QTY  T.PRICE  C.PRICE  PROCEEDS  COMM/FEE  BASIS  REALIZED_PL  MTM_PL  CODE
  const tradeRowRegex = /\b([A-Z0-9][A-Z0-9.]{0,15})\s+(\d{4}-\d{2}-\d{2}),\s*\d{2}:\d{2}:\d{2}\s+([-\d,.]+)\s+[\d,.]+\s+[\d,.]+\s+([-\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)\s+[-\d,.]+\s+[-\d,.]+\s+(\S+)/g;

  const buyPool: Record<string, IbkrBuyLot[]> = {};
  const sellTrades: IbkrSellTrade[] = [];

  let tradeMatch: RegExpExecArray | null;
  while ((tradeMatch = tradeRowRegex.exec(stocksText)) !== null) {
    const symbol = tradeMatch[1];
    const date = tradeMatch[2];
    const qty = parseIbkrNumber(tradeMatch[3]);
    const proceeds = parseIbkrNumber(tradeMatch[4]);
    const commFee = parseIbkrNumber(tradeMatch[5]);
    const basis = parseIbkrNumber(tradeMatch[6]);

    if (qty > 0) {
      if (!buyPool[symbol]) buyPool[symbol] = [];
      buyPool[symbol].push({ date, remainingQty: qty });
    } else if (qty < 0) {
      sellTrades.push({ symbol, date, qty: Math.abs(qty), proceeds, commFee, basis });
    }
  }

  // Sort buys per symbol ascending by date for correct FIFO order
  for (const symbol of Object.keys(buyPool)) {
    buyPool[symbol].sort((a, b) => a.date.localeCompare(b.date));
  }

  console.log('[IBKR] buyPool symbols:', Object.keys(buyPool).length);
  console.log('[IBKR] sellTrades count:', sellTrades.length);

  const rows92A = buildIbkrRows92A(buyPool, sellTrades, instrumentMap);
  console.log('[IBKR] rows92A count:', rows92A.length);

  // ---------------------------------------------------------------------------
  // Step C: Extract dividends + WHT → rows8A (E11)
  // ---------------------------------------------------------------------------
  const dividendsText = findIbkrSectionByRegex(
    fullText,
    /Dividends\s+Date\s+Description/i,
    ['Change in Dividend Accruals', 'Deposits']
  );
  const whtText = findIbkrSectionByRegex(
    fullText,
    /Withholding\s+Tax\s+Date\s+Description/i,
    ['Fees', 'Interest']
  );
  console.log('[IBKR] dividendsSection length:', dividendsText.length);
  console.log('[IBKR] whtSection length:', whtText.length);

  // Dividend row: DATE  TICKER(ISIN)  ...description...  AMOUNT
  // Amount is the last number before the next date or "Total Dividends"
  const dividendRegex = /(\d{4}-\d{2}-\d{2})\s+([A-Z][A-Z0-9.]*)\(([A-Z]{2}[A-Z0-9]{9}\d)\)\s+[\s\S]+?\s+([\d,.]+)(?=\s+(?:\d{4}-\d{2}-\d{2}|Total\s))/g;
  const dividends: IbkrDividend[] = [];

  let divMatch: RegExpExecArray | null;
  while ((divMatch = dividendRegex.exec(dividendsText)) !== null) {
    dividends.push({
      date: divMatch[1],
      ticker: divMatch[2],
      isin: divMatch[3],
      amount: parseIbkrNumber(divMatch[4]),
    });
  }

  // WHT row: DATE  TICKER(ISIN)  ...description... - XX Tax  AMOUNT (negative)
  const whtRegex = /(\d{4}-\d{2}-\d{2})\s+([A-Z][A-Z0-9.]*)\(([A-Z]{2}[A-Z0-9]{9}\d)\)\s+[\s\S]+?-\s*([A-Z]{2})\s+Tax\s+([-\d,.]+)/g;
  const whtEntries: IbkrWhtEntry[] = [];

  let whtMatch: RegExpExecArray | null;
  while ((whtMatch = whtRegex.exec(whtText)) !== null) {
    whtEntries.push({
      date: whtMatch[1],
      ticker: whtMatch[2],
      isin: whtMatch[3],
      countryCode: WHT_COUNTRY_CODE[whtMatch[4]] ?? isinToCountryCode(whtMatch[3]),
      amount: Math.abs(parseIbkrNumber(whtMatch[5])),
    });
  }

  console.log('[IBKR] dividends count:', dividends.length);
  console.log('[IBKR] whtEntries count:', whtEntries.length);

  // Aggregate dividends: group by (ticker, countryCode)
  const divAggMap = new Map<string, { rendimentoBruto: number; impostoPago: number; codPais: string }>();
  for (const div of dividends) {
    const whtEntry = whtEntries.find(w => w.ticker === div.ticker && w.date === div.date);
    const countryCode = whtEntry ? whtEntry.countryCode : isinToCountryCode(div.isin);
    const key = `${div.ticker}:${countryCode}`;
    const existing = divAggMap.get(key);
    if (existing) {
      existing.rendimentoBruto += div.amount;
      existing.impostoPago += whtEntry?.amount ?? 0;
    } else {
      divAggMap.set(key, {
        rendimentoBruto: div.amount,
        impostoPago: whtEntry?.amount ?? 0,
        codPais: countryCode,
      });
    }
  }

  const rows8A: TaxRow8A[] = [];
  for (const [, entry] of divAggMap) {
    rows8A.push({
      codigo: 'E11',
      codPais: entry.codPais,
      rendimentoBruto: entry.rendimentoBruto.toFixed(2),
      impostoPago: entry.impostoPago.toFixed(2),
    });
  }

  // ---------------------------------------------------------------------------
  // Step D: Extract credit interest → rows8A (E21, Ireland 372)
  // ---------------------------------------------------------------------------
  const interestText = findIbkrSectionByRegex(
    fullText,
    /Interest\s+Date\s+Description/i,
    ['Dividends', 'Deposits']
  );
  console.log('[IBKR] interestSection length:', interestText.length);

  const creditInterestRegex = /(?:Credit Interest|IBKR Managed Securities \(SYEP\) Interest)\s+for\s+\S+\s+([\d,.]+)/g;
  let totalInterest = 0;
  let interestLineMatch: RegExpExecArray | null;
  while ((interestLineMatch = creditInterestRegex.exec(interestText)) !== null) {
    totalInterest += parseIbkrNumber(interestLineMatch[1]);
  }

  // WHT on credit interest (appears in the Withholding Tax section)
  const interestWhtRegex = /Withholding\s+@\s+\d+%\s+on\s+Credit\s+Interest\s+for\s+\S+\s+([-\d,.]+)/g;
  let totalInterestWht = 0;
  let interestWhtLineMatch: RegExpExecArray | null;
  while ((interestWhtLineMatch = interestWhtRegex.exec(whtText)) !== null) {
    totalInterestWht += Math.abs(parseIbkrNumber(interestWhtLineMatch[1]));
  }

  if (totalInterest > 0) {
    rows8A.push({
      codigo: 'E21',
      codPais: '372',
      rendimentoBruto: totalInterest.toFixed(2),
      impostoPago: totalInterestWht.toFixed(2),
    });
  }

  // ---------------------------------------------------------------------------
  // Step E: Extract options realized P/L → rowsG13 (G51, US 840)
  // ---------------------------------------------------------------------------
  const optionsText = extractIbkrSection(tradesSection, 'Equity and Index Options', ['CFDs', 'Forex']);
  console.log('[IBKR] optionsSection length:', optionsText.length);

  // For options/CFDs: extract Realized P/L field from each trade row (field 8 after date/time)
  // Row after date+time: QTY  T.PRICE  C.PRICE  PROCEEDS  COMM/FEE  BASIS  REALIZED_PL  MTM_PL  CODE
  const derivativeRealizedPLRegex = /(\d{4}-\d{2}-\d{2}),\s*\d{2}:\d{2}:\d{2}\s+[-\d,.]+\s+[\d,.]+\s+[\d,.]+\s+[-\d,.]+\s+[-\d,.]+\s+[-\d,.]+\s+([-\d,.]+)\s+[-\d,.]+\s+(\S+)/g;

  let totalOptionsRealizedPL = 0;
  let optMatch: RegExpExecArray | null;
  while ((optMatch = derivativeRealizedPLRegex.exec(optionsText)) !== null) {
    const realizedPL = parseIbkrNumber(optMatch[2]);
    if (realizedPL !== 0) {
      totalOptionsRealizedPL += realizedPL;
    }
  }

  // ---------------------------------------------------------------------------
  // Step F: Extract CFD realized P/L → rowsG13 (G51, Ireland 372)
  // ---------------------------------------------------------------------------
  const cfdsText = extractIbkrSection(tradesSection, 'CFDs', ['Forex', 'Bonds', 'Warrants']);
  console.log('[IBKR] cfdsSection length:', cfdsText.length);

  let totalCfdRealizedPL = 0;
  const cfdRealizedPLRegex = new RegExp(derivativeRealizedPLRegex.source, derivativeRealizedPLRegex.flags);
  let cfdMatch: RegExpExecArray | null;
  while ((cfdMatch = cfdRealizedPLRegex.exec(cfdsText)) !== null) {
    const realizedPL = parseIbkrNumber(cfdMatch[2]);
    if (realizedPL !== 0) {
      totalCfdRealizedPL += realizedPL;
    }
  }

  const rowsG13: TaxRowG13[] = [];
  if (totalOptionsRealizedPL !== 0) {
    rowsG13.push({
      codigoOperacao: 'G51',
      titular: 'A',
      rendimentoLiquido: totalOptionsRealizedPL.toFixed(2),
      paisContraparte: '840',
    });
  }
  if (totalCfdRealizedPL !== 0) {
    rowsG13.push({
      codigoOperacao: 'G51',
      titular: 'A',
      rendimentoLiquido: totalCfdRealizedPL.toFixed(2),
      paisContraparte: '372',
    });
  }

  console.log('[IBKR] rows8A count:', rows8A.length);
  console.log('[IBKR] rowsG13 count:', rowsG13.length);

  // --- Validate at least something was extracted ---
  const totalRows = rows8A.length + rows92A.length + rowsG13.length;
  if (totalRows === 0) {
    throw new BrokerParsingError(
      `No trades, dividends, or interest data found in "${file.name}". Please verify this is an IBKR Activity Statement.`,
      'parser.error.ibkr_noData',
      { fileName: file.name },
    );
  }

  return {
    rows8A,
    rows92A,
    rows92B: [],
    rowsG9: [],
    rowsG13,
    rowsG18A: [],
    rowsG1q7: [],
  };
}

// ---------------------------------------------------------------------------
// Revolut — Consolidated Statement (Extrato consolidado)
// ---------------------------------------------------------------------------

const REVOLUT_MARKERS = [
  /Revolut\s+Securities\s+Europe\s+UAB/i,
  /Extrato\s+consolidado/i,
];

const REVOLUT_FUND_KEYWORDS = ['ETF', 'UCITS', 'FUND', 'SICAV'];

function classifyRevolutProduct(name: string): string {
  const upper = name.toUpperCase();
  if (REVOLUT_FUND_KEYWORDS.some(kw => upper.includes(kw))) return 'G20';
  return 'G01';
}

/** €1,000.11 → 1000.11 | -€26.15 → -26.15 */
function parseRevolutEurAmount(s: string): number {
  const cleaned = s.replace(/[€\s]/g, '').replace(/,/g, '');
  return parseFloat(cleaned) || 0;
}

/** DD/MM/YYYY → { year, month, day } for IRS fields */
function parseRevolutDate(dateStr: string): { year: string; month: string; day: string } {
  const parts = dateStr.split('/');
  return {
    year: parts[2],
    month: String(parseInt(parts[1], 10)),
    day: String(parseInt(parts[0], 10)),
  };
}

/**
 * Extract the text slice of a named section from `startPattern` to the first
 * occurrence of any pattern in `endPatterns` that follows the start.
 * Returns '' if `startPattern` doesn't match.
 */
function extractRevolutSection(
  text: string,
  startPattern: RegExp,
  endPatterns: RegExp[],
): string {
  const startMatch = startPattern.exec(text);
  if (!startMatch) return '';
  const afterStart = text.slice(startMatch.index + startMatch[0].length);
  let endIdx = afterStart.length;
  for (const endPat of endPatterns) {
    const endMatch = new RegExp(endPat.source, endPat.flags).exec(afterStart);
    if (endMatch && endMatch.index < endIdx) {
      endIdx = endMatch.index;
    }
  }
  return afterStart.slice(0, endIdx);
}

/** All Revolut section start patterns — used as end delimiters for sibling sections. */
const REVOLUT_ALL_SECTION_STARTS: RegExp[] = [
  /Vendas\s+EUR/i,
  /Outros\s+Rendimentos\s+EUR/i,
  /Vendas\s+USD/i,
  /Outros\s+Rendimentos\s+USD/i,
  /Operações\s+de\s+cript[oa]/i,
  /Operações\s+dos\s+Fundos\s+Monetários/i,
];

/**
 * EUR sales row:
 *   [product name...] ISIN 2-letter-country DD/MM/YYYY(buy) DD/MM/YYYY(sell)
 *   €base €proceeds €commissions
 */
const REVOLUT_EUR_SALE_ROW =
  /([A-Z]{2}[A-Z0-9]{10})\s+([A-Z]{2})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+€\s*([\d,]+\.?\d*)\s+€\s*([\d,]+\.?\d*)\s+€\s*([\d,]+\.?\d*)/g;

/**
 * EUR dividend row:
 *   [product name...] ISIN 2-letter-country €gross €wht
 */
const REVOLUT_EUR_DIV_ROW =
  /([A-Z]{2}[A-Z0-9]{10})\s+([A-Z]{2})\s+€\s*([\d,]+\.?\d*)\s+€\s*([\d,]+\.?\d*)/g;

/**
 * USD sales row — EUR sub-lines already embedded:
 *   [product name...] ISIN country DD/MM/YYYY DD/MM/YYYY
 *   $base €base_eur Taxa:rate  $proceeds €proceeds_eur Taxa:rate  $comm €comm_eur Taxa:rate
 */
const REVOLUT_USD_SALE_ROW =
  /([A-Z]{2}[A-Z0-9]{10})\s+([A-Z]{2})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+\$[\d,]+\.?\d*\s+€\s*([\d,]+\.?\d*)\s+Taxa:\s+[\d.]+\s+\$[\d,]+\.?\d*\s+€\s*([\d,]+\.?\d*)\s+Taxa:\s+[\d.]+\s+\$[\d,]+\.?\d*\s+€\s*([\d,]+\.?\d*)\s+Taxa:\s+[\d.]+/g;

/**
 * USD dividend row — EUR sub-lines:
 *   [product name...] ISIN country $gross €gross_eur Taxa:rate  $wht €wht_eur Taxa:rate
 */
const REVOLUT_USD_DIV_ROW =
  /([A-Z]{2}[A-Z0-9]{10})\s+([A-Z]{2})\s+\$[\d,]+\.?\d*\s+€\s*([\d,]+\.?\d*)\s+Taxa:\s+[\d.]+\s+\$[\d,]+\.?\d*\s+€\s*([\d,]+\.?\d*)\s+Taxa:\s+[\d.]+/g;

/**
 * Parse stock/ETF sale rows from a Revolut section.
 * Groups 1–7: ISIN, country, buyDate, sellDate, base(€), proceeds(€), commissions(€).
 * Product name is inferred from text between the previous row end and the current ISIN.
 */
function parseRevolutSaleRows(sectionText: string, regex: RegExp): TaxRow[] {
  const rows: TaxRow[] = [];
  const re = new RegExp(regex.source, regex.flags);
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(sectionText)) !== null) {
    const textBefore = sectionText.slice(lastEnd, match.index);
    const productNameMatch = textBefore.match(/([A-Za-zÀ-ÿ0-9&\-.' ]+)$/);
    const productName = productNameMatch ? productNameMatch[1].trim() : '';

    const isin = match[1];
    const country2 = match[2];
    const buyDate = parseRevolutDate(match[3]);
    const sellDate = parseRevolutDate(match[4]);
    const base = parseRevolutEurAmount(match[5]);
    const proceeds = parseRevolutEurAmount(match[6]);
    const commissions = parseRevolutEurAmount(match[7]);

    const countryCode3 = resolveCountryCodeFromIsin(country2) ?? '840';
    const typeCode = classifyRevolutProduct(productName + ' ' + isin);

    rows.push({
      codPais: countryCode3,
      codigo: typeCode,
      anoRealizacao: sellDate.year,
      mesRealizacao: sellDate.month,
      diaRealizacao: sellDate.day,
      valorRealizacao: proceeds.toFixed(2),
      anoAquisicao: buyDate.year,
      mesAquisicao: buyDate.month,
      diaAquisicao: buyDate.day,
      valorAquisicao: base.toFixed(2),
      despesasEncargos: commissions.toFixed(2),
      impostoPagoNoEstrangeiro: '0.00',
      codPaisContraparte: countryCode3,
    });

    lastEnd = match.index + match[0].length;
  }

  return rows;
}

/**
 * Parse dividend rows from a Revolut section.
 * Groups 1–4: ISIN, country, gross(€), wht(€).
 */
function parseRevolutDivRows(sectionText: string, regex: RegExp): TaxRow8A[] {
  const rows: TaxRow8A[] = [];
  const re = new RegExp(regex.source, regex.flags);
  let match: RegExpExecArray | null;

  while ((match = re.exec(sectionText)) !== null) {
    const country2 = match[2];
    const gross = parseRevolutEurAmount(match[3]);
    const wht = parseRevolutEurAmount(match[4]);
    const countryCode3 = resolveCountryCodeFromIsin(country2) ?? '840';

    rows.push({
      codigo: 'E11',
      codPais: countryCode3,
      rendimentoBruto: gross.toFixed(2),
      impostoPago: wht.toFixed(2),
    });
  }

  return rows;
}

/**
 * Parse a Revolut "Extrato consolidado" (Consolidated Statement) PDF.
 *
 * Extracts:
 *   - MMF interest (page 1 summary) → Quadro 8A (E31, Ireland 372)
 *   - EUR dividends → Quadro 8A (E11, country from País column)
 *   - USD dividends → Quadro 8A (E11, using EUR sub-line amounts)
 *   - EUR stock/ETF sales → Quadro 9.2A (G01/G20, country from País column)
 *   - USD stock/ETF sales → Quadro 9.2A (G01/G20, using EUR sub-line amounts)
 *   - Crypto transactions → skipped; a warning is added
 *
 * Known limitations:
 *   - Crypto transactions are reported in USD only; declare crypto gains manually
 *     using ECB exchange rates for each transaction date.
 *   - ADR stocks (e.g. ASML) use the trading country (US) — verify the country
 *     code matches the issuer's country.
 *   - Money market fund service fees are not deductible; only gross interest is reported.
 *
 * Throws a BrokerParsingError if the file doesn't look like a Revolut Consolidated Statement.
 */
export async function parseRevolutConsolidatedPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  if (!matchesAnyMarker(fullText, REVOLUT_MARKERS)) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a Revolut Consolidated Statement. Please upload the correct file.`,
      'parser.error.revolut_wrong_file',
      { fileName: file.name },
    );
  }

  const rows8A: TaxRow8A[] = [];
  const rows92A: TaxRow[] = [];
  const warnings: string[] = [];

  // --- MMF Interest (page 1 summary) ---
  const mmfMatch = fullText.match(/Juros\s+totais\s+auferidos\s+€\s*([\d,]+\.?\d*)/i);
  if (mmfMatch) {
    const gross = parseRevolutEurAmount(mmfMatch[1]);
    if (gross > 0) {
      rows8A.push({
        codigo: 'E31',
        codPais: '372',
        rendimentoBruto: gross.toFixed(2),
        impostoPago: '0.00',
      });
    }
  }

  // --- EUR Sales ---
  const eurSalesSection = extractRevolutSection(
    fullText,
    /Vendas\s+EUR/i,
    REVOLUT_ALL_SECTION_STARTS,
  );
  rows92A.push(...parseRevolutSaleRows(eurSalesSection, REVOLUT_EUR_SALE_ROW));

  // --- EUR Dividends ---
  const eurDivSection = extractRevolutSection(
    fullText,
    /Outros\s+Rendimentos\s+EUR/i,
    REVOLUT_ALL_SECTION_STARTS,
  );
  rows8A.push(...parseRevolutDivRows(eurDivSection, REVOLUT_EUR_DIV_ROW));

  // --- USD Sales ---
  const usdSalesSection = extractRevolutSection(
    fullText,
    /Vendas\s+USD/i,
    REVOLUT_ALL_SECTION_STARTS,
  );
  rows92A.push(...parseRevolutSaleRows(usdSalesSection, REVOLUT_USD_SALE_ROW));

  // --- USD Dividends ---
  const usdDivSection = extractRevolutSection(
    fullText,
    /Outros\s+Rendimentos\s+USD/i,
    REVOLUT_ALL_SECTION_STARTS,
  );
  rows8A.push(...parseRevolutDivRows(usdDivSection, REVOLUT_USD_DIV_ROW));

  // --- Crypto: USD-only amounts — skip and warn ---
  if (/Operações\s+de\s+cript[oa]/i.test(fullText)) {
    warnings.push('parser.warning.revolut_crypto_usd_only');
  }

  return {
    rows8A,
    rows92A,
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
    warnings,
  };
}
