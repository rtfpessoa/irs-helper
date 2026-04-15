import { describe, it, expect, vi } from 'vitest';
import {
  parseXtbCapitalGainsPdf,
  parseXtbDividendsPdf,
  parseTradeRepublicPdf,
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
