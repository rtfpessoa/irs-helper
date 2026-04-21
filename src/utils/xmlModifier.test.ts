import { describe, it, expect } from 'vitest';
import { enrichXmlWithGains } from './xmlModifier';
import type { ParsedPdfData, TaxRow } from '../types';

const makeParsedData = (overrides: Partial<ParsedPdfData>): ParsedPdfData => ({
  rows8A: [],
  rows92A: [],
  rows92B: [],
  rowsG9: [],
  rowsG13: [],
  rowsG18A: [],
  rowsG1q7: [],
  warnings: [],
  ...overrides,
});

const makeRow = (valorRealizacao: string, valorAquisicao: string): TaxRow => ({
  codPais: '372',
  codigo: 'G20',
  anoRealizacao: '2025',
  mesRealizacao: '6',
  diaRealizacao: '16',
  valorRealizacao,
  anoAquisicao: '2024',
  mesAquisicao: '6',
  diaAquisicao: '26',
  valorAquisicao,
  despesasEncargos: '0.00',
  impostoPagoNoEstrangeiro: '0.00',
  codPaisContraparte: '620',
});

// ---- XML fixtures ----

const xmlWithExistingRow = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2026 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2026">
  <AnexoJ>
    <Quadro09>
      <AnexoJq092AT01>
        <AnexoJq092AT01-Linha numero="1">
          <NLinha>951</NLinha>
          <ValorRealizacao>10.00</ValorRealizacao>
          <ValorAquisicao>5.00</ValorAquisicao>
          <DespesasEncargos>0.00</DespesasEncargos>
          <ImpostoPagoNoEstrangeiro>0.00</ImpostoPagoNoEstrangeiro>
        </AnexoJq092AT01-Linha>
      </AnexoJq092AT01>
      <AnexoJq092AT01SomaC01>10.00</AnexoJq092AT01SomaC01>
      <AnexoJq092AT01SomaC02>5.00</AnexoJq092AT01SomaC02>
      <AnexoJq092AT01SomaC03>0.00</AnexoJq092AT01SomaC03>
      <AnexoJq092AT01SomaC04>0.00</AnexoJq092AT01SomaC04>
    </Quadro09>
  </AnexoJ>
</Modelo3IRSv2026>`;

const xmlWithEmptyContainer = `<?xml version="1.0" encoding="UTF-8"?>
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

const xmlWithCleanQuadro09 = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2026 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2026">
  <AnexoJ>
    <Quadro08/>
    <Quadro09/>
    <Quadro10/>
  </AnexoJ>
</Modelo3IRSv2026>`;

// ---- Tests ----

describe('xmlModifier – enrichXmlWithGains', () => {
  it('appends a row and updates sums when there is an existing row', () => {
    const { enrichedXml: result } = enrichXmlWithGains(xmlWithExistingRow, makeParsedData({ rows92A: [makeRow('100.00', '50.00')] }));

    expect(result).toContain('<NLinha>952</NLinha>');
    expect(result).toContain('<ValorRealizacao>100.00</ValorRealizacao>');
    expect(result).toContain('<AnexoJq092AT01SomaC01>110.00</AnexoJq092AT01SomaC01>');
    expect(result).toContain('<AnexoJq092AT01SomaC02>55.00</AnexoJq092AT01SomaC02>');
    expect(result).not.toContain('xmlns=""');
  });

  it('handles an empty self-closing container without producing xmlns attributes', () => {
    const { enrichedXml: result } = enrichXmlWithGains(xmlWithEmptyContainer, makeParsedData({ rows92A: [makeRow('200.00', '150.00')] }));

    expect(result).toContain('<NLinha>951</NLinha>');
    expect(result).toContain('<ValorRealizacao>200.00</ValorRealizacao>');
    expect(result).toContain('<AnexoJq092AT01SomaC01>200.00</AnexoJq092AT01SomaC01>');
    expect(result).toContain('<AnexoJq092AT01SomaC02>150.00</AnexoJq092AT01SomaC02>');
    expect(result).not.toContain('xmlns=""');
  });

  it('returns the original xml unchanged when no rows provided', () => {
    const result = enrichXmlWithGains(xmlWithExistingRow, makeParsedData({}));
    expect(result.enrichedXml).toBe(xmlWithExistingRow);
  });

  it('correctly sums multiple new rows', () => {
    const rows = [makeRow('100.00', '80.00'), makeRow('50.00', '40.00')];
    const { enrichedXml: result } = enrichXmlWithGains(xmlWithEmptyContainer, makeParsedData({ rows92A: rows }));

    expect(result).toContain('<NLinha>951</NLinha>');
    expect(result).toContain('<NLinha>952</NLinha>');
    expect(result).toContain('<AnexoJq092AT01SomaC01>150.00</AnexoJq092AT01SomaC01>');
    expect(result).toContain('<AnexoJq092AT01SomaC02>120.00</AnexoJq092AT01SomaC02>');
  });

  it('handles completely clean AnexoJ with self-closing <Quadro09/>', () => {
    const { enrichedXml: result } = enrichXmlWithGains(xmlWithCleanQuadro09, makeParsedData({ rows92A: [makeRow('20.00', '10.00')] }));

    expect(result).toContain('<Quadro09>');
    expect(result).toContain('</Quadro09>');
    expect(result).toContain('<NLinha>951</NLinha>');
    expect(result).toContain('<ValorRealizacao>20.00</ValorRealizacao>');
    expect(result).toContain('<AnexoJq092AT01SomaC01>20.00</AnexoJq092AT01SomaC01>');
  });

  it('injects 9.2 B rows and sum nodes correctly', () => {
    const { enrichedXml: result } = enrichXmlWithGains(xmlWithEmptyContainer, makeParsedData({
      rows92B: [{
        codigo: 'G98',
        codPais: '372',
        rendimentoLiquido: '25.32',
        impostoPagoNoEstrangeiro: '0.00',
        codPaisContraparte: '620'
      }],
    }));

    expect(result).toContain('<AnexoJq092BT01-Linha numero="1">');
    expect(result).toContain('<CodRendimento>G98</CodRendimento>');
    expect(result).toContain('<ImpostoPagoEstrangeiro>0.00</ImpostoPagoEstrangeiro>');
    expect(result).not.toContain('<CodPaisContraparte>');
    expect(result).toContain('<AnexoJq092BT01SomaC01>25.32</AnexoJq092BT01SomaC01>');
  });

  it('injects 8 A rows and sum nodes correctly', () => {
    const { enrichedXml: result } = enrichXmlWithGains(xmlWithEmptyContainer, makeParsedData({
      rows8A: [{
        codigo: 'E11',
        codPais: '840',
        rendimentoBruto: '3.71',
        impostoPago: '0.57'
      }],
    }));

    expect(result).toContain('<AnexoJq08AT01-Linha numero="1">');
    expect(result).toContain('<NLinha>801</NLinha>');
    expect(result).toContain('<CodRendimento>E11</CodRendimento>');
    expect(result).toContain('<RendimentoBruto>3.71</RendimentoBruto>');
    expect(result).toContain('<ImpostoPagoEstrangeiroPaisFonte>0.57</ImpostoPagoEstrangeiroPaisFonte>');
    expect(result).toContain('<AnexoJq08AT01SomaC01>3.71</AnexoJq08AT01SomaC01>');
    expect(result).toContain('<AnexoJq08AT01SomaC02>0.57</AnexoJq08AT01SomaC02>');
  });

  it('injects Anexo G Quadro 13 rows for CFDs correctly', () => {
    const xmlWithAnexoG = `<?xml version="1.0" encoding="UTF-8"?>
<Modelo3IRSv2026 xmlns="http://www.dgci.gov.pt/2009/Modelo3IRSv2026">
  <AnexoG>
    <Quadro13/>
  </AnexoG>
  <AnexoJ>
    <Quadro08/>
    <Quadro09/>
  </AnexoJ>
</Modelo3IRSv2026>`;

    const { enrichedXml: result } = enrichXmlWithGains(xmlWithAnexoG, makeParsedData({
      rowsG13: [{
        codigoOperacao: 'G51',
        titular: 'A',
        rendimentoLiquido: '-43.94',
        paisContraparte: '620'
      }],
    }));

    expect(result).toContain('<AnexoGq13T01-Linha numero="1">');
    expect(result).toContain('<CodigoOperacao>G51</CodigoOperacao>');
    expect(result).toContain('<Titular>A</Titular>');
    expect(result).toContain('<RendimentoLiquido>-43.94</RendimentoLiquido>');
    expect(result).toContain('<PaisContraparte>620</PaisContraparte>');
    expect(result).toContain('<AnexoGq13T01SomaC01>-43.94</AnexoGq13T01SomaC01>');
    // Should not inject into AnexoJ when only G13 rows present
    expect(result).not.toContain('<AnexoJq08AT01-Linha');
  });
});
