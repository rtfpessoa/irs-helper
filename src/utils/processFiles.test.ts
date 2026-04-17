import { describe, expect, it, vi } from 'vitest';
import { utils, write } from 'xlsx';
import { processBrokerFiles, processTaxFiles } from './processFiles';
import { resetEcbUsdEurRateCacheForTests } from './ecbFxRates';

const sampleCsv = `Data,Hora,Produto,ISIN,Bolsa de referência,Bolsa,Quantidade,Preços,,Valor local,,Valor EUR,Taxa de Câmbio,Taxa Autofx,Custos de transação e/ou taxas de terceiros,Total EUR,ID da Ordem,
31-05-2023,09:04,VANGUARD S&P 500 UCITS ETF USD DIS,IE00B3XXRP09,EAM,XAMS,-1,"74,4890",EUR,"74,49",EUR,"74,49",,"0,00",,"74,49",,7de27f2e-430f-4bd0-9110-af75f4c65a89
31-05-2023,09:04,VANGUARD S&P 500 UCITS ETF USD DIS,IE00B3XXRP09,EAM,XAMS,-1,"74,4890",EUR,"74,49",EUR,"74,49",,"0,00","-1,00","73,49",,7de27f2e-430f-4bd0-9110-af75f4c65a89
02-10-2020,09:47,VANGUARD S&P 500 UCITS ETF USD DIS,IE00B3XXRP09,EAM,XAMS,2,"54,0000",EUR,"-108,00",EUR,"-108,00",,"0,00",,"-108,00",,a5d2688d-38db-41cd-a9a0-681f778201d4
`;

vi.mock('./pdfParser', () => ({
  parseTradeRepublicPdf: vi.fn(),
  parseTrading212Pdf: vi.fn(),
  parseXtbCapitalGainsPdf: vi.fn(),
  parseXtbDividendsPdf: vi.fn(),
}));

const ETRADE_HEADERS = [
  'Record Type',
  'Symbol',
  'Plan Type',
  'Quantity',
  'Date Acquired',
  'Date Acquired (Wash Sale Toggle = On)',
  'Acquisition Cost',
  'Acquisition Cost Per Share',
  'Ordinary Income Recognized',
  'Ordinary Income Recognized Per Share',
  'Adjusted Cost Basis',
  'Adjusted Cost Basis Per Share',
  'Date Sold',
  'Total Proceeds',
  'Proceeds Per Share',
  'Deferred Loss',
  'Gain/Loss',
  'Gain/Loss (Wash Sale Toggle = On)',
  'Adjusted Gain/Loss',
  'Adjusted Gain (Loss) Per Share',
  'Capital Gains Status',
  'Wash Sale Adjusted Capital Gains Status',
  'Total Wash Sale Adjustment Amount',
  'Wash Sale Adjustment Amount Per Share',
  'Total Wash Sale Adjusted Cost Basis',
  'Wash Sale Adjusted Cost Basis Per Share',
  'Total Wash Sale Adjusted Gain/Loss',
  'Wash Sale Adjusted Gain/Loss Per Share',
] as const;

function buildEtradeWorkbook(rows: Record<string, string | number>[]): File {
  const worksheet = utils.aoa_to_sheet([
    [...ETRADE_HEADERS],
    ...rows.map(row => ETRADE_HEADERS.map(header => row[header] ?? '')),
  ]);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, 'G&L_Collapsed');
  const buffer = write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new File([buffer], 'etrade.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const etradeEcbCsv = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2024-11-05,1.0900
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2024-12-05,1.0800
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-03-03,1.0465
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-03-05,1.0694
`;

describe('processBrokerFiles', () => {
  it('includes E*TRADE rows in the broker aggregation flow', async () => {
    resetEcbUsdEurRateCacheForTests();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(etradeEcbCsv, { status: 200 })));

    const etradeGainLossXlsx = buildEtradeWorkbook([
      {
        'Record Type': 'Sell',
        Symbol: 'DDOG',
        'Plan Type': 'RS',
        Quantity: 1,
        'Date Acquired': '03/03/2025',
        'Date Acquired (Wash Sale Toggle = On)': '03/03/2025',
        'Adjusted Cost Basis': 1000,
        'Date Sold': '03/05/2025',
        'Total Proceeds': 1200,
        'Adjusted Gain/Loss': 200,
      },
    ]);
    const result = await processBrokerFiles({ etradeGainLossXlsx });

    expect(result.parsedData.rows92A).toHaveLength(1);
    expect(result.sources.table92A).toEqual(['E*TRADE']);
  });

  it('includes DEGIRO rows in the broker aggregation flow', async () => {
    const degiroTransactionsCsv = new File([sampleCsv], 'degiro.csv', { type: 'text/csv' });
    const result = await processBrokerFiles({ degiroTransactionsCsv });

    expect(result.parsedData.rows92A).toHaveLength(1);
    expect(result.sources.table92A).toEqual(['DEGIRO']);
  });

  it('keeps DEGIRO rows from all years when no target year is supplied', async () => {
    const multiYearCsv = `Data,Hora,Produto,ISIN,Bolsa de referência,Bolsa,Quantidade,Preços,,Valor local,,Valor EUR,Taxa de Câmbio,Taxa Autofx,Custos de transação e/ou taxas de terceiros,Total EUR,ID da Ordem,
15-12-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"50,0000",EUR,"-50,00",EUR,"-50,00",,"0,00","-0,50","-50,50",,buy-1
15-01-2024,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"75,0000",EUR,"75,00",EUR,"75,00",,"0,00","-1,00","74,00",,sell-1
15-02-2024,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"60,0000",EUR,"-60,00",EUR,"-60,00",,"0,00","-0,50","-60,50",,buy-2
15-03-2025,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"90,0000",EUR,"90,00",EUR,"90,00",,"0,00","-1,00","89,00",,sell-2
`;
    const degiroTransactionsCsv = new File([multiYearCsv], 'degiro.csv', { type: 'text/csv' });
    const result = await processBrokerFiles({ degiroTransactionsCsv });

    expect(result.parsedData.rows92A).toHaveLength(2);
    expect(result.parsedData.rows92A.map(row => row.anoRealizacao)).toEqual(['2024', '2025']);
  });
});

describe('processTaxFiles', () => {
  it('infers the target transaction year from the XML model version for E*TRADE enrichment', async () => {
    resetEcbUsdEurRateCacheForTests();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(etradeEcbCsv, { status: 200 })));

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2026 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2026">
  <AnexoJ>
    <Quadro08/>
    <Quadro09>
      <AnexoJq092AT01/>
      <AnexoJq092AT01SomaC01>0.00</AnexoJq092AT01SomaC01>
      <AnexoJq092AT01SomaC02>0.00</AnexoJq092AT01SomaC02>
      <AnexoJq092AT01SomaC03>0.00</AnexoJq092AT01SomaC03>
      <AnexoJq092AT01SomaC04>0.00</AnexoJq092AT01SomaC04>
    </Quadro09>
  </AnexoJ>
</Modelo3IRSv2026>`;
    const etradeGainLossXlsx = buildEtradeWorkbook([
      {
        'Record Type': 'Sell',
        Symbol: 'DDOG',
        'Plan Type': 'RS',
        Quantity: 1,
        'Date Acquired': '11/05/2024',
        'Date Acquired (Wash Sale Toggle = On)': '11/05/2024',
        'Adjusted Cost Basis': 109,
        'Date Sold': '12/05/2024',
        'Total Proceeds': 120,
        'Adjusted Gain/Loss': 11,
      },
      {
        'Record Type': 'Sell',
        Symbol: 'DDOG',
        'Plan Type': 'RS',
        Quantity: 1,
        'Date Acquired': '03/03/2025',
        'Date Acquired (Wash Sale Toggle = On)': '03/03/2025',
        'Adjusted Cost Basis': 1000,
        'Date Sold': '03/05/2025',
        'Total Proceeds': 1200,
        'Adjusted Gain/Loss': 200,
      },
    ]);

    const result = await processTaxFiles({
      xmlFile: new File([xml], 'irs.xml', { type: 'application/xml' }),
      etradeGainLossXlsx,
    });

    expect(result.summary.table92A.rowsAdded).toBe(1);
    expect(result.summary.table92A.sources).toEqual(['E*TRADE']);
    expect(result.enrichedXml).toContain('<AnoRealizacao>2025</AnoRealizacao>');
    expect(result.enrichedXml).not.toContain('<AnoRealizacao>2024</AnoRealizacao>');
  });

  it('infers the target transaction year from the XML model version for DEGIRO enrichment', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2026 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2026">
  <AnexoJ>
    <Quadro08/>
    <Quadro09>
      <AnexoJq092AT01/>
      <AnexoJq092AT01SomaC01>0.00</AnexoJq092AT01SomaC01>
      <AnexoJq092AT01SomaC02>0.00</AnexoJq092AT01SomaC02>
      <AnexoJq092AT01SomaC03>0.00</AnexoJq092AT01SomaC03>
      <AnexoJq092AT01SomaC04>0.00</AnexoJq092AT01SomaC04>
    </Quadro09>
  </AnexoJ>
</Modelo3IRSv2026>`;
    const multiYearCsv = `Data,Hora,Produto,ISIN,Bolsa de referência,Bolsa,Quantidade,Preços,,Valor local,,Valor EUR,Taxa de Câmbio,Taxa Autofx,Custos de transação e/ou taxas de terceiros,Total EUR,ID da Ordem,
15-12-2022,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"50,0000",EUR,"-50,00",EUR,"-50,00",,"0,00","-0,50","-50,50",,buy-1
15-01-2024,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"75,0000",EUR,"75,00",EUR,"75,00",,"0,00","-1,00","74,00",,sell-1
15-02-2024,10:00,ETF,IE00B3XXRP09,EAM,XAMS,1,"60,0000",EUR,"-60,00",EUR,"-60,00",,"0,00","-0,50","-60,50",,buy-2
15-03-2025,10:00,ETF,IE00B3XXRP09,EAM,XAMS,-1,"90,0000",EUR,"90,00",EUR,"90,00",,"0,00","-1,00","89,00",,sell-2
`;

    const result = await processTaxFiles({
      xmlFile: new File([xml], 'irs.xml', { type: 'application/xml' }),
      degiroTransactionsCsv: new File([multiYearCsv], 'degiro.csv', { type: 'text/csv' }),
    });

    expect(result.summary.table92A.rowsAdded).toBe(1);
    expect(result.summary.table92A.sources).toEqual(['DEGIRO']);
    expect(result.enrichedXml).toContain('<AnoRealizacao>2025</AnoRealizacao>');
    expect(result.enrichedXml).not.toContain('<AnoRealizacao>2024</AnoRealizacao>');
  });
});
