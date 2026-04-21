import * as XLSX from 'xlsx';
import type { ParsedPdfData, TaxRowG18A, TaxRowG1q7 } from '../types';
import { BrokerParsingError } from './parserErrors';

const REQUIRED_FIELDS: Array<keyof BinanceRow> = ['UTC_Time', 'Operation', 'Coin', 'Change'];

const HEADER_ALIASES: Record<keyof BinanceRow, string[]> = {
  User_ID: ['user_id', 'user id', 'userid', 'uid'],
  UTC_Time: ['utc_time', 'utc time', 'utctime', 'time', 'date time', 'datetime'],
  Account: ['account', 'account type', 'accounttype', 'wallet'],
  Operation: ['operation', 'type'],
  Coin: ['coin', 'asset', 'currency'],
  Change: ['change', 'amount', 'quantity'],
  Remark: ['remark', 'remarks', 'note', 'notes', 'memo', 'comment'],
};

/** Default Binance EU entity country code (France = 250). */
const BINANCE_COUNTRY_CODE = '250';

interface BinanceRow {
  User_ID: string;
  UTC_Time: string;
  Account: string;
  Operation: string;
  Coin: string;
  Change: number;
  Remark: string;
}

interface CryptoLot {
  coin: string;
  amount: number;
  costEur: number;
  date: Date;
  feeEur: number;
}

interface HeaderMapping {
  headerRowIndex: number;
  columnIndexByField: Partial<Record<keyof BinanceRow, number>>;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^\ufeff/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function formatDateAsUtcString(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  const seconds = String(value.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function parseNumberish(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const text = String(value ?? '').trim();
  if (!text) {
    return 0;
  }

  const normalized = /^-?\d{1,3}(\.\d{3})+,\d+$/.test(text)
    ? text.replace(/\./g, '').replace(',', '.')
    : /^-?\d+,\d+$/.test(text)
      ? text.replace(',', '.')
      : text.replace(/,/g, '');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringifyCell(value: unknown): string {
  if (value instanceof Date) {
    return formatDateAsUtcString(value);
  }

  return String(value ?? '').trim();
}

function coerceTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return formatDateAsUtcString(value);
  }

  if (typeof value === 'number' && Number.isFinite(value) && typeof XLSX.SSF?.parse_date_code === 'function') {
    const parsedDate = XLSX.SSF.parse_date_code(value);
    if (parsedDate) {
      const utcDate = new Date(Date.UTC(parsedDate.y, parsedDate.m - 1, parsedDate.d, parsedDate.H, parsedDate.M, Math.floor(parsedDate.S)));
      return formatDateAsUtcString(utcDate);
    }
  }

  return stringifyCell(value);
}

function findHeaderMapping(rows: unknown[][]): HeaderMapping | null {
  let bestMapping: HeaderMapping | null = null;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 25); rowIndex++) {
    const row = rows[rowIndex] ?? [];
    const normalizedCells = row.map(normalizeHeader);
    const columnIndexByField: Partial<Record<keyof BinanceRow, number>> = {};

    for (const field of Object.keys(HEADER_ALIASES) as Array<keyof BinanceRow>) {
      const aliasSet = new Set(HEADER_ALIASES[field].map(normalizeHeader));
      const index = normalizedCells.findIndex(cell => aliasSet.has(cell));
      if (index !== -1) {
        columnIndexByField[field] = index;
      }
    }

    const hasRequiredFields = REQUIRED_FIELDS.every(field => columnIndexByField[field] !== undefined);
    if (!hasRequiredFields) {
      continue;
    }

    const matchCount = Object.keys(columnIndexByField).length;
    if (!bestMapping || matchCount > Object.keys(bestMapping.columnIndexByField).length) {
      bestMapping = { headerRowIndex: rowIndex, columnIndexByField };
    }
  }

  return bestMapping;
}

function getMappedCell(row: unknown[], mapping: Partial<Record<keyof BinanceRow, number>>, field: keyof BinanceRow): unknown {
  const index = mapping[field];
  return index === undefined ? '' : row[index];
}

function parseSheetRows(sheet: XLSX.WorkSheet): BinanceRow[] | null {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][];
  if (matrix.length === 0) {
    return null;
  }

  const headerMapping = findHeaderMapping(matrix);
  if (!headerMapping) {
    return null;
  }

  const rows: BinanceRow[] = [];

  for (let rowIndex = headerMapping.headerRowIndex + 1; rowIndex < matrix.length; rowIndex++) {
    const row = matrix[rowIndex] ?? [];
    const timestamp = coerceTimestamp(getMappedCell(row, headerMapping.columnIndexByField, 'UTC_Time'));
    const operation = stringifyCell(getMappedCell(row, headerMapping.columnIndexByField, 'Operation'));
    const coin = stringifyCell(getMappedCell(row, headerMapping.columnIndexByField, 'Coin')).toUpperCase();
    const changeRaw = getMappedCell(row, headerMapping.columnIndexByField, 'Change');
    const change = parseNumberish(changeRaw);

    const isBlankRow = !timestamp && !operation && !coin && !stringifyCell(changeRaw);
    if (isBlankRow) {
      continue;
    }

    if (!timestamp || !operation || !coin) {
      continue;
    }

    rows.push({
      User_ID: stringifyCell(getMappedCell(row, headerMapping.columnIndexByField, 'User_ID')),
      UTC_Time: timestamp,
      Account: stringifyCell(getMappedCell(row, headerMapping.columnIndexByField, 'Account')),
      Operation: operation,
      Coin: coin,
      Change: change,
      Remark: stringifyCell(getMappedCell(row, headerMapping.columnIndexByField, 'Remark')),
    });
  }

  return rows;
}

function parseBinanceDate(dateStr: string): Date {
  let normalized = dateStr.trim();
  // Handle 2-digit year format: "YY-MM-DD HH:MM:SS" → "20YY-MM-DD HH:MM:SS"
  if (/^\d{2}-\d{2}-\d{2}/.test(normalized)) {
    const yearPrefix = parseInt(normalized.slice(0, 2), 10) > 50 ? '19' : '20';
    normalized = yearPrefix + normalized;
  }
  return new Date(normalized.replace(' ', 'T') + 'Z');
}

function daysBetween(d1: Date, d2: Date): number {
  const msPerDay = 86400000;
  return Math.floor((d2.getTime() - d1.getTime()) / msPerDay);
}

function formatMoney(value: number): string {
  return Math.abs(value).toFixed(2);
}

interface RowGroup {
  date: Date;
  rows: BinanceRow[];
}

/** Groups rows whose timestamps are within `maxGapMs` of each other (chained). */
function groupByProximity(rows: BinanceRow[], maxGapMs: number = 2000): RowGroup[] {
  if (rows.length === 0) return [];

  const withDates = rows.map(row => ({
    row,
    date: parseBinanceDate(row.UTC_Time),
  })).sort((a, b) => a.date.getTime() - b.date.getTime());

  const groups: RowGroup[] = [];
  let current: RowGroup = { date: withDates[0].date, rows: [withDates[0].row] };

  for (let i = 1; i < withDates.length; i++) {
    if (withDates[i].date.getTime() - withDates[i - 1].date.getTime() <= maxGapMs) {
      current.rows.push(withDates[i].row);
    } else {
      groups.push(current);
      current = { date: withDates[i].date, rows: [withDates[i].row] };
    }
  }

  groups.push(current);
  return groups;
}

export async function parseBinanceTransactionsXlsx(file: File): Promise<ParsedPdfData> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  let rows: BinanceRow[] | null = null;
  let foundCompatibleSheet = false;

  for (const sheetName of workbook.SheetNames) {
    const sheetRows = parseSheetRows(workbook.Sheets[sheetName]);
    if (!sheetRows) {
      continue;
    }

    foundCompatibleSheet = true;
    if (sheetRows.length > 0) {
      rows = sheetRows;
      break;
    }
  }

  if (!foundCompatibleSheet) {
    throw new BrokerParsingError(
      'Not a supported Binance transaction history export',
      'parser.error.binance_wrong_file',
      { fileName: file.name },
    );
  }

  if (!rows || rows.length === 0) {
    throw new BrokerParsingError(
      'No data found in Binance file',
      'parser.error.binance_no_rows',
      { fileName: file.name },
    );
  }

  // Group rows by proximity to match Buy/Sell with EUR counterpart and fees
  const groups = groupByProximity(rows);

  // FIFO lot ledger per coin
  const lots: Map<string, CryptoLot[]> = new Map();

  const rowsG18A: TaxRowG18A[] = [];
  const rowsG1q7: TaxRowG1q7[] = [];

  for (const { date, rows: group } of groups) {

    // Find EUR row(s) in this group
    const eurRows = group.filter(r => r.Coin === 'EUR');
    const eurAmount = eurRows.reduce((sum, r) => sum + Math.abs(r.Change), 0);

    // Find fee rows in this group
    const feeRows = group.filter(r => r.Operation === 'Fee');
    const feeEur = feeRows
      .filter(r => r.Coin === 'EUR')
      .reduce((sum, r) => sum + Math.abs(r.Change), 0);

    // Find crypto rows (non-EUR, non-Fee)
    const cryptoRows = group.filter(r => r.Coin !== 'EUR' && r.Operation !== 'Fee');
    const buyOps = new Set(['Buy', 'Transaction Related', 'Binance Convert']);
    const sellOps = new Set(['Sell', 'Transaction Related', 'Binance Convert', 'Small Assets Exchange']);
    const rewardOps = new Set([
      'Distribution', 'Staking Rewards', 'Simple Earn Flexible Interest',
      'Simple Earn Locked Rewards', 'Savings Interest', 'Launchpool Interest',
      'Cash Voucher', 'Referral Commission',
    ]);

    // Detect crypto-to-crypto swap: no EUR in the group, but both positive and negative crypto
    const hasEur = eurAmount > 0;
    const positiveCrypto = cryptoRows.filter(r => r.Change > 0);
    const negativeCrypto = cryptoRows.filter(r => r.Change < 0);
    const isCryptoToSwap = !hasEur && positiveCrypto.length > 0 && negativeCrypto.length > 0;

    if (isCryptoToSwap) {
      // Crypto-to-crypto swap — lot substitution (not a taxable event)
      // Consume lots from sold crypto, create lots for received crypto with the same cost basis
      for (const soldRow of negativeCrypto) {
        const soldCoin = soldRow.Coin;
        const soldAmount = Math.abs(soldRow.Change);
        const coinLots = lots.get(soldCoin) ?? [];
        let remaining = soldAmount;
        let totalCostBasis = 0;
        let totalFee = 0;
        let earliestDate = date;

        while (remaining > 0 && coinLots.length > 0) {
          const lot = coinLots[0];
          const consumed = Math.min(remaining, lot.amount);
          const fraction = consumed / lot.amount;
          totalCostBasis += lot.costEur * fraction;
          totalFee += lot.feeEur * fraction;
          if (lot.date < earliestDate) earliestDate = lot.date;

          remaining -= consumed;
          if (consumed >= lot.amount) {
            coinLots.shift();
          } else {
            lot.amount -= consumed;
            lot.costEur -= lot.costEur * fraction;
            lot.feeEur -= lot.feeEur * fraction;
          }
        }

        // Create lots for received crypto with inherited cost basis
        for (const receivedRow of positiveCrypto) {
          const receivedCoin = receivedRow.Coin;
          if (!lots.has(receivedCoin)) lots.set(receivedCoin, []);
          lots.get(receivedCoin)!.push({
            coin: receivedCoin,
            amount: receivedRow.Change,
            costEur: totalCostBasis,
            date: earliestDate,
            feeEur: totalFee,
          });
        }
      }
      continue;
    }

    for (const cryptoRow of cryptoRows) {
      const coin = cryptoRow.Coin;
      const amount = cryptoRow.Change;
      const operation = cryptoRow.Operation;

      // BUY operations (positive Change on crypto with EUR spent)
      if (buyOps.has(operation) && amount > 0 && hasEur) {
        // When multiple cryptos are bought in the same group, split EUR proportionally
        const totalPositiveCrypto = positiveCrypto.length;
        const eurPerCrypto = totalPositiveCrypto > 1 ? eurAmount / totalPositiveCrypto : eurAmount;
        const feePerCrypto = totalPositiveCrypto > 1 ? feeEur / totalPositiveCrypto : feeEur;

        if (!lots.has(coin)) lots.set(coin, []);
        lots.get(coin)!.push({
          coin,
          amount,
          costEur: eurPerCrypto,
          date,
          feeEur: feePerCrypto,
        });
      }

      // Staking rewards, distributions, earn interest — create lots at zero cost
      // (they become taxable events only when sold)
      if (rewardOps.has(operation) && amount > 0) {
        if (!lots.has(coin)) lots.set(coin, []);
        lots.get(coin)!.push({
          coin,
          amount,
          costEur: 0,
          date,
          feeEur: 0,
        });
      }

      // SELL operations (negative Change on crypto with EUR received)
      if (sellOps.has(operation) && amount < 0 && hasEur) {
        const sellAmount = Math.abs(amount);
        const coinLots = lots.get(coin) ?? [];
        let remaining = sellAmount;

        while (remaining > 0 && coinLots.length > 0) {
          const lot = coinLots[0];
          const consumed = Math.min(remaining, lot.amount);
          const fraction = consumed / lot.amount;
          const acquisitionCost = lot.costEur * fraction;
          const fee = lot.feeEur * fraction;
          const saleValue = eurAmount * (consumed / sellAmount);

          const holdingDays = daysBetween(lot.date, date);

          const rowData = {
            titular: 'A',
            codPaisEntGestora: BINANCE_COUNTRY_CODE,
            anoRealizacao: String(date.getUTCFullYear()),
            mesRealizacao: String(date.getUTCMonth() + 1),
            diaRealizacao: String(date.getUTCDate()),
            valorRealizacao: formatMoney(saleValue),
            anoAquisicao: String(lot.date.getUTCFullYear()),
            mesAquisicao: String(lot.date.getUTCMonth() + 1),
            diaAquisicao: String(lot.date.getUTCDate()),
            valorAquisicao: formatMoney(acquisitionCost),
            despesasEncargos: formatMoney(fee),
            codPaisContraparte: BINANCE_COUNTRY_CODE,
          };

          if (holdingDays >= 365) {
            rowsG1q7.push(rowData);
          } else {
            rowsG18A.push(rowData);
          }

          remaining -= consumed;
          if (consumed >= lot.amount) {
            coinLots.shift();
          } else {
            lot.amount -= consumed;
            lot.costEur -= acquisitionCost;
            lot.feeEur -= fee;
          }
        }
      }
    }
  }

  const warnings: string[] = [];

  if (rowsG18A.length === 0 && rowsG1q7.length === 0) {
    const totalLots = [...lots.values()].reduce((sum, coinLots) => sum + coinLots.length, 0);
    warnings.push(
      totalLots > 0 ? 'parser.error.binance_no_sells' : 'parser.error.binance_no_rows',
    );
  }

  return {
    rows8A: [],
    rows92A: [],
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A,
    rowsG1q7,
    warnings,
  };
}
