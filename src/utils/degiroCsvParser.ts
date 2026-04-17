import type { ParsedPdfData, TaxRow } from '../types';
import { resolveCountryCodeFromIsin } from './brokerCountries';
import { BrokerParsingError } from './parserErrors';

const EXPECTED_HEADERS = [
  'Data',
  'Hora',
  'Produto',
  'ISIN',
  'Bolsa de referência',
  'Bolsa',
  'Quantidade',
  'Preços',
  '',
  'Valor local',
  '',
  'Valor EUR',
  'Taxa de Câmbio',
  'Taxa Autofx',
  'Custos de transação e/ou taxas de terceiros',
  'Total EUR',
  'ID da Ordem',
  '',
] as const;

interface CsvTradeRow {
  date: string;
  time: string;
  product: string;
  isin: string;
  quantity: number;
  price: number;
  valueEur: number;
  feeEur: number;
  orderId: string;
  sourceIndex: number;
}

interface TradeEvent {
  date: string;
  time: string;
  isin: string;
  quantity: number;
  price: number;
  valueEur: number;
  feeEur: number;
  sourceIndex: number;
}

interface OpenLot {
  acquisitionDate: string;
  remainingQuantity: number;
  unitGrossEur: number;
  unitFeeEur: number;
}

interface ParseDegiroTransactionsCsvOptions {
  targetRealizationYear?: string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      currentRow.push(currentField);
      currentField = '';
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      continue;
    }

    if (char !== '\r') {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter(row => row.some(value => value.trim() !== ''));
}

function normalizeDecimal(value: string): number {
  const normalized = value.trim().replace(/\./g, '').replace(/,/g, '.');
  if (normalized === '') {
    return 0;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function formatDatePart(value: string): string {
  return String(Number.parseInt(value, 10));
}

function buildTimestamp(date: string, time: string): number {
  const [day, month, year] = date.split('-').map(part => Number.parseInt(part, 10));
  const [hour, minute] = time.split(':').map(part => Number.parseInt(part, 10));
  return Date.UTC(year, month - 1, day, hour, minute);
}

function validateHeaders(headers: string[], fileName: string): void {
  if (headers.length !== EXPECTED_HEADERS.length) {
    throw new BrokerParsingError(
      `"${fileName}" does not appear to be a supported DEGIRO transactions CSV export.`,
      'parser.error.degiro_wrong_file',
      { fileName }
    );
  }

  const matches = headers.every((header, index) => header.trim() === EXPECTED_HEADERS[index]);
  if (!matches) {
    throw new BrokerParsingError(
      `"${fileName}" does not appear to be a supported DEGIRO transactions CSV export.`,
      'parser.error.degiro_wrong_file',
      { fileName }
    );
  }
}

function parseTradeRows(fileName: string, rows: string[][]): CsvTradeRow[] {
  return rows.map((row, index) => {
    const quantity = normalizeDecimal(row[6] ?? '');
    const price = normalizeDecimal(row[7] ?? '');
    const valueEur = normalizeDecimal(row[11] ?? '');
    const feeEur = normalizeDecimal(row[14] ?? '');
    const orderId = (row[17] || row[16] || '').trim();

    if (
      !row[0] ||
      !row[1] ||
      !row[3] ||
      quantity === 0 ||
      !orderId ||
      !Number.isFinite(quantity) ||
      !Number.isFinite(price) ||
      !Number.isFinite(valueEur) ||
      !Number.isFinite(feeEur)
    ) {
      throw new BrokerParsingError(
        `Unsupported DEGIRO transaction row found in "${fileName}".`,
        'parser.error.degiro_unsupported_row',
        { fileName }
      );
    }

    return {
      date: row[0].trim(),
      time: row[1].trim(),
      product: (row[2] ?? '').trim(),
      isin: row[3].trim(),
      quantity,
      price,
      valueEur,
      feeEur,
      orderId,
      sourceIndex: index,
    };
  });
}

function consolidateTradeEvents(fileName: string, rows: CsvTradeRow[]): TradeEvent[] {
  const grouped = new Map<string, CsvTradeRow[]>();

  for (const row of rows) {
    const key = `${row.orderId}::${row.date}::${row.time}::${row.isin}::${row.quantity}::${row.price}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  return [...grouped.values()].map(group => {
    const [first] = group;
    const conflictingRow = group.find(row =>
      row.product !== first.product ||
      Math.abs(row.valueEur - first.valueEur) > 0.000001
    );

    if (conflictingRow) {
      throw new BrokerParsingError(
        `Conflicting DEGIRO transaction rows found in "${fileName}".`,
        'parser.error.degiro_unsupported_row',
        { fileName }
      );
    }

    return {
      date: first.date,
      time: first.time,
      isin: first.isin,
      quantity: first.quantity,
      price: first.price,
      valueEur: Math.abs(first.valueEur),
      feeEur: group.reduce((total, row) => total + Math.abs(row.feeEur), 0),
      sourceIndex: Math.min(...group.map(row => row.sourceIndex)),
    };
  }).sort((left, right) => {
    const timeDiff = buildTimestamp(left.date, left.time) - buildTimestamp(right.date, right.time);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return left.sourceIndex - right.sourceIndex;
  });
}

function buildTaxRow(
  countryCode: string,
  sellEvent: TradeEvent,
  acquisitionDate: string,
  matchedQuantity: number,
  sellQuantity: number,
  lot: OpenLot,
): TaxRow {
  const [sellDay, sellMonth, sellYear] = sellEvent.date.split('-');
  const [buyDay, buyMonth, buyYear] = acquisitionDate.split('-');

  const proportionalSellValue = (sellEvent.valueEur / sellQuantity) * matchedQuantity;
  const proportionalSellFee = (sellEvent.feeEur / sellQuantity) * matchedQuantity;
  const acquisitionValue = lot.unitGrossEur * matchedQuantity;
  const acquisitionFee = lot.unitFeeEur * matchedQuantity;

  return {
    codPais: countryCode,
    codigo: 'G20',
    anoRealizacao: sellYear,
    mesRealizacao: formatDatePart(sellMonth),
    diaRealizacao: formatDatePart(sellDay),
    valorRealizacao: formatMoney(proportionalSellValue),
    anoAquisicao: buyYear,
    mesAquisicao: formatDatePart(buyMonth),
    diaAquisicao: formatDatePart(buyDay),
    valorAquisicao: formatMoney(acquisitionValue),
    despesasEncargos: formatMoney(acquisitionFee + proportionalSellFee),
    impostoPagoNoEstrangeiro: '0.00',
    codPaisContraparte: '620',
  };
}

function getEventYear(event: TradeEvent): string {
  return event.date.split('-')[2];
}

function getAvailableQuantity(lots: OpenLot[]): number {
  return lots.reduce((total, lot) => total + lot.remainingQuantity, 0);
}

function consumeSellEventLots(
  countryCode: string,
  event: TradeEvent,
  lots: OpenLot[],
  rows92A: TaxRow[],
  emitRows: boolean,
): void {
  let remainingSellQuantity = Math.abs(event.quantity);

  while (remainingSellQuantity > 0.000001) {
    const openLot = lots[0];
    if (!openLot) {
      break;
    }

    const matchedQuantity = Math.min(remainingSellQuantity, openLot.remainingQuantity);
    if (emitRows) {
      rows92A.push(buildTaxRow(countryCode, event, openLot.acquisitionDate, matchedQuantity, Math.abs(event.quantity), openLot));
    }

    openLot.remainingQuantity -= matchedQuantity;
    remainingSellQuantity -= matchedQuantity;

    if (openLot.remainingQuantity <= 0.000001) {
      lots.shift();
    }
  }
}

export async function parseDegiroTransactionsCsv(
  file: File,
  options: ParseDegiroTransactionsCsvOptions = {},
): Promise<ParsedPdfData> {
  const rows = parseCsv(await file.text());
  const [headers, ...dataRows] = rows;

  if (!headers || dataRows.length === 0) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a supported DEGIRO transactions CSV export.`,
      'parser.error.degiro_wrong_file',
      { fileName: file.name }
    );
  }

  validateHeaders(headers, file.name);

  const tradeRows = parseTradeRows(file.name, dataRows);
  const events = consolidateTradeEvents(file.name, tradeRows);
  const rows92A: TaxRow[] = [];
  const openLots = new Map<string, OpenLot[]>();
  const targetRealizationYear = options.targetRealizationYear;

  for (const event of events) {
    const countryCode = resolveCountryCodeFromIsin(event.isin);
    if (!countryCode) {
      throw new BrokerParsingError(
        `Unsupported ISIN country found in "${file.name}".`,
        'parser.error.degiro_unsupported_country',
        { fileName: file.name, isin: event.isin }
      );
    }

    const lots = openLots.get(event.isin) ?? [];
    if (event.quantity > 0) {
      lots.push({
        acquisitionDate: event.date,
        remainingQuantity: event.quantity,
        unitGrossEur: event.valueEur / event.quantity,
        unitFeeEur: event.feeEur / event.quantity,
      });
      openLots.set(event.isin, lots);
      continue;
    }

    const shouldEmitRows = !targetRealizationYear || getEventYear(event) === targetRealizationYear;
    const availableQuantity = getAvailableQuantity(lots);
    const sellQuantity = Math.abs(event.quantity);

    if (availableQuantity + 0.000001 < sellQuantity) {
      if (shouldEmitRows) {
        throw new BrokerParsingError(
          `The DEGIRO CSV "${file.name}" is missing buy history required to match a sell transaction.`,
          'parser.error.degiro_incomplete_history',
          { fileName: file.name }
        );
      }
      openLots.set(event.isin, lots);
      continue;
    }

    consumeSellEventLots(countryCode, event, lots, rows92A, shouldEmitRows);
    openLots.set(event.isin, lots);
  }

  if (rows92A.length === 0) {
    throw new BrokerParsingError(
      `No capital gains rows found in "${file.name}". Please verify this is a DEGIRO transactions CSV with sell trades.`,
      'parser.error.degiro_no_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A: [],
    rows92A,
    rows92B: [],
    rowsG13: [],
  };
}
