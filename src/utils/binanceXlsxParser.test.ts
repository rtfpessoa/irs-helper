import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import { parseBinanceTransactionsXlsx } from './binanceXlsxParser';
import { BrokerParsingError } from './parserErrors';

vi.mock('xlsx', () => ({
  read: vi.fn(),
  SSF: {
    parse_date_code: vi.fn(),
  },
  utils: {
    sheet_to_json: vi.fn(),
  },
}));

type MockRow = {
  User_ID: string;
  UTC_Time: string;
  Account: string;
  Operation: string;
  Coin: string;
  Change: number;
  Remark: string;
};

const DEFAULT_HEADERS = ['User_ID', 'UTC_Time', 'Account', 'Operation', 'Coin', 'Change', 'Remark'];

function toMatrix(rows: MockRow[], headers: string[] = DEFAULT_HEADERS, leadingRows: unknown[][] = []): unknown[][] {
  return [
    ...leadingRows,
    headers,
    ...rows.map(row => [
      row.User_ID,
      row.UTC_Time,
      row.Account,
      row.Operation,
      row.Coin,
      row.Change,
      row.Remark,
    ]),
  ];
}

function mockXlsxData(matrix: unknown[][]) {
  const mockSheets = { Sheet1: {} };
  vi.mocked(XLSX.read).mockReturnValue({
    SheetNames: ['Sheet1'],
    Sheets: mockSheets,
  } as unknown as XLSX.WorkBook);
  vi.mocked(XLSX.utils.sheet_to_json).mockReturnValue(matrix as unknown as Record<string, unknown>[]);
}

function makeFile(name = 'binance.xlsx'): File {
  return new File([''], name);
}

describe('parseBinanceTransactionsXlsx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly classifies a sell within 365 days into rowsG18A', async () => {
    mockXlsxData(toMatrix([
      // Buy BTC on 2025-01-15
      { User_ID: '1', UTC_Time: '2025-01-15 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'BTC', Change: 0.01, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-01-15 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'EUR', Change: -500, Remark: '' },
      // Sell BTC on 2025-06-01 (137 days later — < 365 days)
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Sell', Coin: 'BTC', Change: -0.01, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Sell', Coin: 'EUR', Change: 600, Remark: '' },
    ]));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    expect(data.rowsG18A).toHaveLength(1);
    expect(data.rowsG1q7).toHaveLength(0);

    const row = data.rowsG18A[0];
    expect(row.anoRealizacao).toBe('2025');
    expect(row.mesRealizacao).toBe('6');
    expect(row.diaRealizacao).toBe('1');
    expect(row.valorRealizacao).toBe('600.00');
    expect(row.anoAquisicao).toBe('2025');
    expect(row.valorAquisicao).toBe('500.00');
    expect(row.codPaisEntGestora).toBe('250');
    expect(row.codPaisContraparte).toBe('250');
    expect(row.titular).toBe('A');
  });

  it('correctly classifies a sell after 365 days into rowsG1q7', async () => {
    mockXlsxData(toMatrix([
      // Buy ETH on 2023-01-01
      { User_ID: '1', UTC_Time: '2023-01-01 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'ETH', Change: 1, Remark: '' },
      { User_ID: '1', UTC_Time: '2023-01-01 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'EUR', Change: -1500, Remark: '' },
      // Sell ETH on 2025-01-01 (730 days later — >= 365 days)
      { User_ID: '1', UTC_Time: '2025-01-01 10:00:00', Account: 'Spot', Operation: 'Sell', Coin: 'ETH', Change: -1, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-01-01 10:00:00', Account: 'Spot', Operation: 'Sell', Coin: 'EUR', Change: 2000, Remark: '' },
    ]));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    expect(data.rowsG1q7).toHaveLength(1);
    expect(data.rowsG18A).toHaveLength(0);

    const row = data.rowsG1q7[0];
    expect(row.valorRealizacao).toBe('2000.00');
    expect(row.valorAquisicao).toBe('1500.00');
    expect(row.anoRealizacao).toBe('2025');
    expect(row.anoAquisicao).toBe('2023');
  });

  it('applies FIFO ordering across two buy lots', async () => {
    mockXlsxData(toMatrix([
      // First buy: 0.1 BTC for 4000 EUR
      { User_ID: '1', UTC_Time: '2025-01-01 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'BTC', Change: 0.1, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-01-01 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'EUR', Change: -4000, Remark: '' },
      // Second buy: 0.1 BTC for 5000 EUR
      { User_ID: '1', UTC_Time: '2025-02-01 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'BTC', Change: 0.1, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-02-01 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'EUR', Change: -5000, Remark: '' },
      // Sell all 0.2 BTC for 10000 EUR
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Sell', Coin: 'BTC', Change: -0.2, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Sell', Coin: 'EUR', Change: 10000, Remark: '' },
    ]));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    // Two rows: one per FIFO lot
    expect(data.rowsG18A).toHaveLength(2);
    // First lot: acquisition cost = 4000, sale value = 5000 (half of total)
    expect(data.rowsG18A[0].valorAquisicao).toBe('4000.00');
    expect(data.rowsG18A[0].valorRealizacao).toBe('5000.00');
    // Second lot: acquisition cost = 5000, sale value = 5000
    expect(data.rowsG18A[1].valorAquisicao).toBe('5000.00');
    expect(data.rowsG18A[1].valorRealizacao).toBe('5000.00');
  });

  it('includes EUR fee in despesasEncargos for buy/sell trades', async () => {
    mockXlsxData(toMatrix([
      { User_ID: '1', UTC_Time: '2025-01-01 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'BTC', Change: 0.1, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-01-01 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'EUR', Change: -4000, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-01-01 10:00:00', Account: 'Spot', Operation: 'Fee', Coin: 'EUR', Change: -4, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Sell', Coin: 'BTC', Change: -0.1, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Sell', Coin: 'EUR', Change: 5000, Remark: '' },
    ]));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    expect(data.rowsG18A).toHaveLength(1);
    expect(data.rowsG18A[0].despesasEncargos).toBe('4.00');
  });

  it('throws BrokerParsingError with binance_wrong_file key when columns are missing', async () => {
    vi.mocked(XLSX.read).mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    } as unknown as XLSX.WorkBook);
    vi.mocked(XLSX.utils.sheet_to_json).mockReturnValue([
      ['Date', 'Amount', 'Currency'],
      ['2025-01-01', 100, 'BTC'],
    ] as unknown as Record<string, unknown>[]);

    await expect(parseBinanceTransactionsXlsx(makeFile())).rejects.toThrow(BrokerParsingError);
    await expect(parseBinanceTransactionsXlsx(makeFile())).rejects.toMatchObject({
      i18nKey: 'parser.error.binance_wrong_file',
    });
  });

  it('returns binance_no_sells warning when only buy transactions are present', async () => {
    mockXlsxData(toMatrix([
      // Only buys, no sells
      { User_ID: '1', UTC_Time: '2025-01-01 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'BTC', Change: 0.1, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-01-01 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'EUR', Change: -4000, Remark: '' },
    ]));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    expect(data.rowsG18A).toHaveLength(0);
    expect(data.rowsG1q7).toHaveLength(0);
    expect(data.warnings).toContain('parser.error.binance_no_sells');
  });

  it('returns binance_no_sells warning for staking-only file with no sells', async () => {
    mockXlsxData(toMatrix([
      // Only staking rewards, no sells
      { User_ID: '1', UTC_Time: '2025-01-01 10:00:00', Account: 'Spot', Operation: 'Staking Rewards', Coin: 'ETH', Change: 0.05, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-02-01 10:00:00', Account: 'Spot', Operation: 'Staking Rewards', Coin: 'ETH', Change: 0.05, Remark: '' },
    ]));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    expect(data.rowsG18A).toHaveLength(0);
    expect(data.rowsG1q7).toHaveLength(0);
    expect(data.warnings).toContain('parser.error.binance_no_sells');
  });

  it('returns empty rows8A, rows92A, rows92B, rowsG9, rowsG13 for Binance files', async () => {
    mockXlsxData(toMatrix([
      { User_ID: '1', UTC_Time: '2025-01-01 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'BTC', Change: 0.1, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-01-01 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'EUR', Change: -4000, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Sell', Coin: 'BTC', Change: -0.1, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Sell', Coin: 'EUR', Change: 5000, Remark: '' },
    ]));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    expect(data.rows8A).toEqual([]);
    expect(data.rows92A).toEqual([]);
    expect(data.rows92B).toEqual([]);
    expect(data.rowsG9).toEqual([]);
    expect(data.rowsG13).toEqual([]);
  });

  it('accepts header rows with spaces and leading metadata rows', async () => {
    mockXlsxData(toMatrix(
      [
        { User_ID: '1', UTC_Time: '2025-01-15 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'BTC', Change: 0.01, Remark: '' },
        { User_ID: '1', UTC_Time: '2025-01-15 10:00:00', Account: 'Spot', Operation: 'Buy', Coin: 'EUR', Change: -500, Remark: '' },
        { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Sell', Coin: 'BTC', Change: -0.01, Remark: '' },
        { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Sell', Coin: 'EUR', Change: 600, Remark: '' },
      ],
      ['User ID', 'UTC Time', 'Account', 'Operation', 'Coin', 'Change', 'Remark'],
      [['Transaction History'], [], ['Generated at', '2026-04-12 17:49:00']],
    ));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    expect(data.rowsG18A).toHaveLength(1);
    expect(data.rowsG18A[0].valorRealizacao).toBe('600.00');
  });

  it('handles Binance Convert as buy/sell operation', async () => {
    mockXlsxData(toMatrix([
      // Buy BTC with EUR via Binance Convert
      { User_ID: '1', UTC_Time: '2025-01-15 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'BTC', Change: 0.01, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-01-15 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'EUR', Change: -500, Remark: '' },
      // Sell BTC for EUR via Binance Convert
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'BTC', Change: -0.01, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'EUR', Change: 600, Remark: '' },
    ]));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    expect(data.rowsG18A).toHaveLength(1);
    expect(data.rowsG18A[0].valorRealizacao).toBe('600.00');
    expect(data.rowsG18A[0].valorAquisicao).toBe('500.00');
  });

  it('handles 2-digit year timestamps (YY-MM-DD format)', async () => {
    mockXlsxData(toMatrix([
      { User_ID: '1', UTC_Time: '25-01-15 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'BTC', Change: 0.01, Remark: '' },
      { User_ID: '1', UTC_Time: '25-01-15 10:00:01', Account: 'Spot', Operation: 'Binance Convert', Coin: 'EUR', Change: -500, Remark: '' },
      { User_ID: '1', UTC_Time: '25-06-01 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'BTC', Change: -0.01, Remark: '' },
      { User_ID: '1', UTC_Time: '25-06-01 10:00:01', Account: 'Spot', Operation: 'Binance Convert', Coin: 'EUR', Change: 600, Remark: '' },
    ]));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    expect(data.rowsG18A).toHaveLength(1);
    expect(data.rowsG18A[0].anoRealizacao).toBe('2025');
    expect(data.rowsG18A[0].anoAquisicao).toBe('2025');
  });

  it('groups rows within 2 seconds of each other (proximity grouping)', async () => {
    mockXlsxData(toMatrix([
      // Buy: crypto at :43, EUR at :44 (1 second apart)
      { User_ID: '1', UTC_Time: '2025-01-15 23:30:43', Account: 'Spot', Operation: 'Binance Convert', Coin: 'BTC', Change: 0.01, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-01-15 23:30:44', Account: 'Spot', Operation: 'Binance Convert', Coin: 'EUR', Change: -500, Remark: '' },
      // Sell: crypto at :00, EUR at :01 (1 second apart)
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'BTC', Change: -0.01, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:01', Account: 'Spot', Operation: 'Binance Convert', Coin: 'EUR', Change: 600, Remark: '' },
    ]));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    expect(data.rowsG18A).toHaveLength(1);
    expect(data.rowsG18A[0].valorRealizacao).toBe('600.00');
    expect(data.rowsG18A[0].valorAquisicao).toBe('500.00');
  });

  it('treats crypto-to-crypto swaps as lot substitutions without creating IRS rows', async () => {
    mockXlsxData(toMatrix([
      // Buy ETH with EUR
      { User_ID: '1', UTC_Time: '2025-01-15 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'ETH', Change: 1, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-01-15 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'EUR', Change: -2000, Remark: '' },
      // Swap ETH for BTC (no EUR involved — not taxable)
      { User_ID: '1', UTC_Time: '2025-03-01 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'ETH', Change: -1, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-03-01 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'BTC', Change: 0.5, Remark: '' },
      // Sell BTC for EUR — should inherit ETH's cost basis
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'BTC', Change: -0.5, Remark: '' },
      { User_ID: '1', UTC_Time: '2025-06-01 10:00:00', Account: 'Spot', Operation: 'Binance Convert', Coin: 'EUR', Change: 3000, Remark: '' },
    ]));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    // Only the final BTC→EUR sale should produce an IRS row (not the ETH→BTC swap)
    expect(data.rowsG18A).toHaveLength(1);
    expect(data.rowsG18A[0].valorRealizacao).toBe('3000.00');
    // The BTC lot inherited ETH's acquisition cost of 2000
    expect(data.rowsG18A[0].valorAquisicao).toBe('2000.00');
    // Acquisition date should be the original ETH buy date (lot substitution preserves it)
    expect(data.rowsG18A[0].anoAquisicao).toBe('2025');
    expect(data.rowsG18A[0].mesAquisicao).toBe('1');
  });

  it('returns binance_no_sells warning when file has buys via Binance Convert but no sells', async () => {
    mockXlsxData(toMatrix([
      { User_ID: '1', UTC_Time: '25-04-07 23:30:43', Account: 'Spot', Operation: 'Binance Convert', Coin: 'BTC', Change: 0.004, Remark: '' },
      { User_ID: '1', UTC_Time: '25-04-07 23:30:44', Account: 'Spot', Operation: 'Binance Convert', Coin: 'EUR', Change: -299, Remark: '' },
    ]));

    const data = await parseBinanceTransactionsXlsx(makeFile());

    expect(data.rowsG18A).toHaveLength(0);
    expect(data.warnings).toContain('parser.error.binance_no_sells');
  });
});
