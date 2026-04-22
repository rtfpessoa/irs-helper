import { describe, it, expect, vi } from 'vitest';
import { parseTrading212Pdf } from './trading212Parser';
import { resolveCountryCode } from '../brokerCountries';
import { BrokerParsingError } from '../parserErrors';
import { mockPdfDocument } from './testHelper';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
}));

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
    await expect(parseTrading212Pdf(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseTrading212Pdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.t212_wrong_file',
    });
  });

  it('should throw PdfParsingError when T212 report has no extractable data', async () => {
    mockPdfDocument([
      { str: 'Annual Statement - 2025  Trading 212  Interest on cash   €0.00  Share lending interest   €0.00' },
    ]);

    const fakeFile = new File([''], 't212_empty.pdf');
    await expect(parseTrading212Pdf(fakeFile)).rejects.toThrow(BrokerParsingError);
    await expect(parseTrading212Pdf(fakeFile)).rejects.toMatchObject({
      i18nKey: 'parser.error.t212_no_rows',
    });
  });

  it('should parse Portuguese-language T212 annual statement (Extrato Anual)', async () => {
    mockPdfDocument([
      {
        str: [
          'Extrato Anual - 2024  Trading 212 Markets  Juros sobre capital €127.11',
          '  VALOR LÍQUIDO  Portugal €3 35% €1.05 €1.95  Reino Unido €9.09 - - €9.09',
          '  França €3.28 25% €0.82 €2.46  Espanha €3.14 19% €0.60 €2.55',
          '  Estados Unidos €24.01 15% €3.61 €20.42  Dividendos por instrumento INSTRUMENT',
          '  Distribuição por país  VALOR LÍQUIDO',
          '  Irlanda €2.20 - - €2.20  Distribuição por instrumento ETF',
        ].join(' '),
      },
    ]);

    const fakeFile = new File([''], 't212_pt_statement.pdf');
    const data = await parseTrading212Pdf(fakeFile);

    // Interest: 127.11 as E21, Cyprus 196
    expect(data.rows8A[0]).toEqual({
      codigo: 'E21',
      codPais: '196',
      rendimentoBruto: '127.11',
      impostoPago: '0.00',
    });

    // Dividends: Portugal
    expect(data.rows8A[1]).toEqual({
      codigo: 'E11',
      codPais: '620',
      rendimentoBruto: '3',
      impostoPago: '1.05',
    });

    // Reino Unido (UK)
    expect(data.rows8A[2]).toEqual({
      codigo: 'E11',
      codPais: '826',
      rendimentoBruto: '9.09',
      impostoPago: '0.00',
    });

    // França (France)
    expect(data.rows8A[3]).toEqual({
      codigo: 'E11',
      codPais: '250',
      rendimentoBruto: '3.28',
      impostoPago: '0.82',
    });

    // Espanha (Spain)
    expect(data.rows8A[4]).toEqual({
      codigo: 'E11',
      codPais: '724',
      rendimentoBruto: '3.14',
      impostoPago: '0.60',
    });

    // Estados Unidos (USA)
    expect(data.rows8A[5]).toEqual({
      codigo: 'E11',
      codPais: '840',
      rendimentoBruto: '24.01',
      impostoPago: '3.61',
    });

    // Irlanda (Ireland) — from ETF distribution section
    expect(data.rows8A[6]).toEqual({
      codigo: 'E11',
      codPais: '372',
      rendimentoBruto: '2.20',
      impostoPago: '0.00',
    });

    expect(data.rows8A.length).toBe(7);
  });

  it('should detect Portuguese T212 statement via Extrato Anual marker', async () => {
    mockPdfDocument([
      { str: 'Extrato Anual - 2024  Trading 212 Markets  Juros sobre capital €50.00  VALOR LÍQUIDO  Portugal €10 - - €10  Dividendos por instrumento END' },
    ]);

    const fakeFile = new File([''], 't212_pt_detect.pdf');
    const data = await parseTrading212Pdf(fakeFile);
    expect(data.rows8A.some(r => r.codigo === 'E21')).toBe(true);
    expect(data.rows8A.some(r => r.codigo === 'E11')).toBe(true);
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

  it('should resolve Portuguese country names to IRS codes', () => {
    expect(resolveCountryCode('Reino Unido')).toBe('826');
    expect(resolveCountryCode('França')).toBe('250');
    expect(resolveCountryCode('Espanha')).toBe('724');
    expect(resolveCountryCode('Estados Unidos')).toBe('840');
    expect(resolveCountryCode('Irlanda')).toBe('372');
    expect(resolveCountryCode('Portugal')).toBe('620');
  });

  it('should return undefined for unknown country names', () => {
    expect(resolveCountryCode('Atlantis')).toBeUndefined();
    expect(resolveCountryCode('')).toBeUndefined();
  });
});
