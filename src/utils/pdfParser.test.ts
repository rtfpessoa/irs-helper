import { describe, it, expect, vi } from 'vitest';
import {
  parseXtbCapitalGainsPdf,
  parseXtbDividendsPdf,
  parseTradeRepublicPdf,
  parseTrading212Pdf,
  resolveCountryCode,
  PdfParsingError,
} from './pdfParser';
import * as pdfjsLib from 'pdfjs-dist';

vi.mock('pdfjs-dist', () => {
  return {
    getDocument: vi.fn(),
    GlobalWorkerOptions: {}
  };
});

// Helper to mock a PDF with given text items
function mockPdfDocument(items: { str: string }[]) {
  const getDocumentMock = vi.mocked(pdfjsLib.getDocument);

  getDocumentMock.mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getTextContent: vi.fn().mockResolvedValue({ items })
      })
    })
  } as unknown as ReturnType<typeof pdfjsLib.getDocument>);
}

describe('parseXtbCapitalGainsPdf', () => {
  it('should extract 9.2A, 9.2B, and G13 rows (no 8A)', async () => {
    mockPdfDocument([
      { str: 'Quadro 9.2 A - Alienação Mais-Valias' },
      { str: ' ' },
      { str: '951 372 G20 2025 6 16 105.84 2024 6 26 104.04 0.00 0.00 620' },
      { str: '991 G98 372 25.32 0.00 620' },
      { str: '13001 G51 A -43.94 620' },
    ]);

    const fakeFile = new File([''], 'xtb_gains.pdf');
    const data = await parseXtbCapitalGainsPdf(fakeFile);

    expect(data.rows92A.length).toBe(1);
    expect(data.rows92B.length).toBe(1);
    expect(data.rowsG13.length).toBe(1);
    expect(data.rows8A.length).toBe(0);
  });

  it('should normalize decimal values consistently in gains rows', async () => {
    mockPdfDocument([
      { str: 'Quadro 9.2 A - Alienação Mais-Valias' },
      { str: '951 372 G20 2025 6 16 105,84 2024 6 26 104,04 0,00 0,00 620' },
      { str: '991 G98 372 25,32 0,00 620' },
      { str: '13001 G51 A -43,94 620' },
    ]);

    const fakeFile = new File([''], 'xtb_gains_commas.pdf');
    const data = await parseXtbCapitalGainsPdf(fakeFile);

    expect(data.rows92A[0].valorRealizacao).toBe('105.84');
    expect(data.rows92B[0].rendimentoLiquido).toBe('25.32');
    expect(data.rowsG13[0].rendimentoLiquido).toBe('-43.94');
  });

  it('should throw PdfParsingError when a dividends PDF is uploaded in gains slot', async () => {
    mockPdfDocument([
      { str: 'Quadro 8 A - Dividendos e Juros' },
      { str: '801 E11 840 3.71 0.57' },
    ]);

    const fakeFile = new File([''], 'xtb_dividends.pdf');
    await expect(parseXtbCapitalGainsPdf(fakeFile)).rejects.toThrow(PdfParsingError);
    await expect(parseXtbCapitalGainsPdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.xtb_wrong_file_gains',
    });
  });

  it('should throw PdfParsingError when no gains rows are found', async () => {
    mockPdfDocument([
      { str: 'Quadro 9.2 A - Capital Gains' },
      { str: 'No data in this report' },
    ]);

    const fakeFile = new File([''], 'empty_gains.pdf');
    await expect(parseXtbCapitalGainsPdf(fakeFile)).rejects.toThrow(PdfParsingError);
    await expect(parseXtbCapitalGainsPdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.xtb_no_gains_rows',
    });
  });
});

describe('parseXtbDividendsPdf', () => {
  it('should extract 8A rows only', async () => {
    mockPdfDocument([
      { str: 'Quadro 8 A - Dividendos e Juros' },
      { str: '801 E11 840 3.71 0.57' },
    ]);

    const fakeFile = new File([''], 'xtb_dividends.pdf');
    const data = await parseXtbDividendsPdf(fakeFile);

    expect(data.rows8A.length).toBe(1);
    expect(data.rows92A.length).toBe(0);
    expect(data.rows92B.length).toBe(0);
    expect(data.rowsG13.length).toBe(0);
  });

  it('should throw PdfParsingError when a gains PDF is uploaded in dividends slot', async () => {
    mockPdfDocument([
      { str: 'Quadro 9.2 A - Alienação Mais-Valias Capital Gains' },
      { str: '951 372 G20 2025 6 16 105.84 2024 6 26 104.04 0.00 0.00 620' },
    ]);

    const fakeFile = new File([''], 'xtb_gains.pdf');
    await expect(parseXtbDividendsPdf(fakeFile)).rejects.toThrow(PdfParsingError);
    await expect(parseXtbDividendsPdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.xtb_wrong_file_dividends',
    });
  });

  it('should throw PdfParsingError when no dividend rows are found', async () => {
    mockPdfDocument([
      { str: 'Dividendos report - empty' },
    ]);

    const fakeFile = new File([''], 'empty_div.pdf');
    await expect(parseXtbDividendsPdf(fakeFile)).rejects.toThrow(PdfParsingError);
    await expect(parseXtbDividendsPdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.xtb_no_dividends_rows',
    });
  });
});

describe('parseTradeRepublicPdf', () => {
  it('should extract 8A rows from a TR report', async () => {
    mockPdfDocument([
      { str: 'Trade Republic Tax Report 2025' },
      { str: ' ' },
      { str: '801' },
      { str: ' ' },
      { str: 'E21 (28%)' },
      { str: ' ' },
      { str: '276' },
      { str: ' ' },
      { str: '110,8900' },
      { str: ' ' },
      { str: '0,0000' },
    ]);

    const fakeFile = new File([''], 'tr_report.pdf');
    const data = await parseTradeRepublicPdf(fakeFile);

    expect(data.rows8A.length).toBe(1);
    expect(data.rows8A[0].codigo).toBe('E21');
    expect(data.rows92A.length).toBe(0);
    expect(data.rows92B.length).toBe(0);
    expect(data.rowsG13.length).toBe(0);
  });

  it('should throw PdfParsingError when file is not a TR report', async () => {
    mockPdfDocument([
      { str: 'Some random document with no broker markers' },
    ]);

    const fakeFile = new File([''], 'not_tr.pdf');
    await expect(parseTradeRepublicPdf(fakeFile)).rejects.toThrow(PdfParsingError);
    await expect(parseTradeRepublicPdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.tr_wrong_file',
    });
  });

  it('should throw PdfParsingError when TR report has no 8A data', async () => {
    mockPdfDocument([
      { str: 'Trade Republic Tax Report 2025 - no data' },
    ]);

    const fakeFile = new File([''], 'tr_empty.pdf');
    await expect(parseTradeRepublicPdf(fakeFile)).rejects.toThrow(PdfParsingError);
    await expect(parseTradeRepublicPdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.tr_no_rows',
    });
  });
});

describe('parseTrading212Pdf', () => {
  it('should extract interest (E21) and dividends (E11) from T212 annual statement', async () => {
    mockPdfDocument([
      { str: 'Annual Statement - 2025  Overview  Trading 212 Invest  Interest on cash   €133.37  Share lending interest   €0.02  Dividends by country  ISSUING COUNTRY GROSS AMOUNT (EUR)   WHT RATE   WHT (EUR)   NET AMOUNT (EUR)  Germany   0.29   26%   0.08   0.21  Denmark   25.33   27%   6.84   18.49  United Kingdom   2.89   -   -   2.89  Dividends by instrument  INSTRUMENT' },
    ]);

    const fakeFile = new File([''], 't212_statement.pdf');
    const data = await parseTrading212Pdf(fakeFile);

    // Interest: 133.37 + 0.02 = 133.39 as E21, country 196 (Cyprus)
    expect(data.rows8A[0]).toEqual({
      codigo: 'E21',
      codPais: '196',
      rendimentoBruto: '133.39',
      impostoPago: '0.00',
    });

    // Dividends: 3 countries as E11
    expect(data.rows8A[1]).toEqual({
      codigo: 'E11',
      codPais: '276',
      rendimentoBruto: '0.29',
      impostoPago: '0.08',
    });

    expect(data.rows8A[2]).toEqual({
      codigo: 'E11',
      codPais: '208',
      rendimentoBruto: '25.33',
      impostoPago: '6.84',
    });

    expect(data.rows8A[3]).toEqual({
      codigo: 'E11',
      codPais: '826',
      rendimentoBruto: '2.89',
      impostoPago: '0.00',
    });

    expect(data.rows8A.length).toBe(4);
    expect(data.rows92A.length).toBe(0);
    expect(data.rows92B.length).toBe(0);
    expect(data.rowsG13.length).toBe(0);
  });

  it('should extract only interest when no dividends section exists', async () => {
    mockPdfDocument([
      { str: 'Annual Statement - 2025  Trading 212 Invest  Interest on cash   €50.00  Share lending interest   €0.00' },
    ]);

    const fakeFile = new File([''], 't212_interest_only.pdf');
    const data = await parseTrading212Pdf(fakeFile);

    expect(data.rows8A.length).toBe(1);
    expect(data.rows8A[0]).toEqual({
      codigo: 'E21',
      codPais: '196',
      rendimentoBruto: '50.00',
      impostoPago: '0.00',
    });
  });

  it('should handle thousand separators in T212 numbers', async () => {
    mockPdfDocument([
      { str: 'Annual Statement - 2025  Trading 212  Interest on cash   €1,234.56  Share lending interest   €0.00' },
    ]);

    const fakeFile = new File([''], 't212_large_interest.pdf');
    const data = await parseTrading212Pdf(fakeFile);

    expect(data.rows8A[0].rendimentoBruto).toBe('1234.56');
  });

  it('should throw PdfParsingError when file is not a T212 report', async () => {
    mockPdfDocument([
      { str: 'Some random document with no broker markers' },
    ]);

    const fakeFile = new File([''], 'not_t212.pdf');
    await expect(parseTrading212Pdf(fakeFile)).rejects.toThrow(PdfParsingError);
    await expect(parseTrading212Pdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.t212_wrong_file',
    });
  });

  it('should throw PdfParsingError when T212 report has no extractable data', async () => {
    mockPdfDocument([
      { str: 'Annual Statement - 2025  Trading 212  Interest on cash   €0.00  Share lending interest   €0.00' },
    ]);

    const fakeFile = new File([''], 't212_empty.pdf');
    await expect(parseTrading212Pdf(fakeFile)).rejects.toThrow(PdfParsingError);
    await expect(parseTrading212Pdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.t212_no_rows',
    });
  });
});

describe('resolveCountryCode', () => {
  it('should resolve known country names to IRS codes', () => {
    expect(resolveCountryCode('Germany')).toBe('276');
    expect(resolveCountryCode('Denmark')).toBe('208');
    expect(resolveCountryCode('United Kingdom')).toBe('826');
    expect(resolveCountryCode('United States')).toBe('840');
    expect(resolveCountryCode('Spain')).toBe('724');
    expect(resolveCountryCode('Netherlands')).toBe('528');
    expect(resolveCountryCode('Cyprus')).toBe('196');
  });

  it('should return undefined for unknown country names', () => {
    expect(resolveCountryCode('Atlantis')).toBeUndefined();
    expect(resolveCountryCode('')).toBeUndefined();
  });
});
