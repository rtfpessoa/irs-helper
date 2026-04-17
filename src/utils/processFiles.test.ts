import { describe, expect, it, vi } from 'vitest';
import { processBrokerFiles, processTaxFiles } from './processFiles';

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

describe('processBrokerFiles', () => {
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
