import type { TaxRow, TaxRow92B, TaxRow8A, TaxRowG13, ParsedPdfData, EnrichmentResult, EnrichmentSummary } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseHighestNLinha(xml: string, blockName: string): number {
  let highest = 950;
  if (blockName === 'AnexoJq092BT01') highest = 990;
  if (blockName === 'AnexoJq08AT01') highest = 800; // 8.A starts at 801
  const re = /<NLinha>(\d+)<\/NLinha>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = parseInt(m[1], 10);
    if (v > highest) highest = v;
  }
  return highest;
}

function parseHighestNumero(xml: string, blockName: string): number {
  let highest = 0;
  const re = new RegExp(`<${blockName}-Linha\\s[^>]*numero="(\\d+)"`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = parseInt(m[1], 10);
    if (v > highest) highest = v;
  }
  return highest;
}

function sumField(tag: string, text: string): number {
  let total = 0;
  const re = new RegExp(`<${tag}>(-?[\\d.]+)<\\/${tag}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) total += parseFloat(m[1]);
  return total;
}

function upsertSomaNode(xml: string, tag: string, value: number, searchStartIdx: number, quadroName: string): string {
  const formatted = value.toFixed(2);
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const idx = xml.indexOf(openTag, searchStartIdx);
  if (idx !== -1) {
    const closeIdx = xml.indexOf(closeTag, idx);
    return xml.slice(0, idx + openTag.length) + formatted + xml.slice(closeIdx);
  }
  const quadroClose = `</${quadroName}>`;
  const qIdx = xml.indexOf(quadroClose, searchStartIdx);
  if (qIdx === -1) return xml;
  const lineStart = xml.lastIndexOf('\n', qIdx);
  const lineIndent = lineStart !== -1 ? xml.slice(lineStart + 1, qIdx).match(/^(\s*)/)?.[1] ?? '      ' : '      ';
  const newNode = `\n${lineIndent}${openTag}${formatted}${closeTag}`;
  return xml.slice(0, qIdx) + newNode + '\n' + xml.slice(qIdx);
}

// ---------------------------------------------------------------------------
// Block Injector Generic Function
// ---------------------------------------------------------------------------

interface InjectConfig<T> {
  containerName: string;
  quadroName: string;
  rows: T[];
  buildFields: (row: T, nLinha: number) => [string, string][];
  somaNodes: { tag: string; fieldToSum: string; computeNewSoma: (rows: T[]) => number }[];
}

function processBlock<T>(originalXml: string, config: InjectConfig<T>, searchStartIdx: number): string {
  if (config.rows.length === 0) return originalXml;

  let xml = originalXml;
  const containerOpen = `<${config.containerName}>`;
  const containerClose = `</${config.containerName}>`;
  const containerEmpty = `<${config.containerName}/>`;

  if (xml.indexOf(containerEmpty, searchStartIdx) !== -1) {
    xml = xml.replace(containerEmpty, `${containerOpen}${containerClose}`);
  }

  if (xml.indexOf(containerOpen, searchStartIdx) === -1) {
    const quadroClose = `</${config.quadroName}>`;
    const qIdx = xml.indexOf(quadroClose, searchStartIdx);
    if (qIdx === -1) throw new Error(`${config.quadroName} not found in the XML.`);
    const lineStart = xml.lastIndexOf('\n', qIdx);
    const lineIndent = lineStart !== -1 ? (xml.slice(lineStart + 1, qIdx).match(/^(\s*)/)?.[1] ?? '      ') : '      ';
    const injection = `\n${lineIndent}${containerOpen}${containerClose}\n`;
    xml = xml.slice(0, qIdx) + injection + xml.slice(qIdx);
  }

  const containerOpenIdx = xml.indexOf(containerOpen, searchStartIdx);
  const containerCloseIdx = xml.indexOf(containerClose, containerOpenIdx);
  const existingBlock = xml.slice(containerOpenIdx + containerOpen.length, containerCloseIdx);

  let linhaIndent = '          ';
  let fieldIndent = '            ';
  const firstChildMatch = existingBlock.match(/\n(\s+)</);
  if (firstChildMatch) {
    linhaIndent = firstChildMatch[1];
    fieldIndent = linhaIndent + '  ';
  } else {
    const containerLine = xml.lastIndexOf('\n', containerOpenIdx);
    if (containerLine !== -1) {
      const containerIndentMatch = xml.slice(containerLine + 1, containerOpenIdx).match(/^(\s*)/);
      if (containerIndentMatch) {
        linhaIndent = containerIndentMatch[1] + '  ';
        fieldIndent = linhaIndent + '  ';
      }
    }
  }

  let nextNLinha = parseHighestNLinha(existingBlock, config.containerName) + 1;
  let nextNumero = parseHighestNumero(existingBlock, config.containerName) + 1;

  const newLinhasXml = config.rows.map(row => {
    const fields = config.buildFields(row, nextNLinha);
    nextNLinha++;
    const inner = fields.map(([name, value]) => `${fieldIndent}<${name}>${value}</${name}>`).join('\n');
    const linha = `${linhaIndent}<${config.containerName}-Linha numero="${nextNumero}">\n` + inner + '\n' + `${linhaIndent}</${config.containerName}-Linha>`;
    nextNumero++;
    return linha;
  }).join('\n');

  const containerIndentLine = xml.lastIndexOf('\n', containerCloseIdx);
  const containerIndent = containerIndentLine !== -1 ? (xml.slice(containerIndentLine + 1, containerCloseIdx).match(/^(\s*)/)?.[1] ?? '') : '';
  const insertion = '\n' + newLinhasXml + '\n' + containerIndent;

  const closeTagPos = xml.indexOf(containerClose, containerOpenIdx);
  xml = xml.slice(0, closeTagPos) + insertion + xml.slice(closeTagPos);

  for (const somaConfig of config.somaNodes) {
    const existingVal = sumField(somaConfig.fieldToSum, existingBlock);
    const newVal = somaConfig.computeNewSoma(config.rows);
    xml = upsertSomaNode(xml, somaConfig.tag, existingVal + newVal, searchStartIdx, config.quadroName);
  }

  return xml;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function enrichXmlWithGains(
  originalXml: string, 
  data: ParsedPdfData, 
  sources: { table8A: string[], table92A: string[], table92B: string[], tableG13: string[] } = { table8A: [], table92A: [], table92B: [], tableG13: [] }
): EnrichmentResult {
  const { rows8A, rows92A, rows92B, rowsG13 } = data;
  
  const emptySummary: EnrichmentSummary = {
    table8A: { rowsAdded: 0, totals: [] },
    table92A: { rowsAdded: 0, totals: [] },
    table92B: { rowsAdded: 0, totals: [] },
    tableG13: { rowsAdded: 0, totals: [] },
    totalRowsAdded: 0,
  };

  if (rows8A.length === 0 && rows92A.length === 0 && rows92B.length === 0 && rowsG13.length === 0) {
    return {
      originalXml,
      enrichedXml: originalXml,
      summary: emptySummary,
    };
  }

  let xml = originalXml;

  // Helper to expand self-closing quadro tags within a bounded annex region
  const expandSelfClosing = (tagName: string, startIdx: number, endIdx: number) => {
    const qEmptyIdx = xml.indexOf(`<${tagName}/>`, startIdx);
    if (qEmptyIdx !== -1 && (endIdx === -1 || qEmptyIdx < endIdx)) {
      const lineStart = xml.lastIndexOf('\n', qEmptyIdx);
      const lineIndent = lineStart !== -1 ? (xml.slice(lineStart + 1, qEmptyIdx).match(/^(\s*)/)?.[1] ?? '    ') : '    ';
      xml = xml.slice(0, qEmptyIdx) + `<${tagName}>\n${lineIndent}</${tagName}>` + xml.slice(qEmptyIdx + `<${tagName}/>`.length);
    }
  };

  // ---------------------------------------------------------------------------
  // Anexo J enrichment
  // ---------------------------------------------------------------------------
  const anexoJOpenIdx = xml.indexOf('<AnexoJ');
  if (anexoJOpenIdx !== -1 && (rows8A.length > 0 || rows92A.length > 0 || rows92B.length > 0)) {
    const anexoJCloseIdx = xml.indexOf('</AnexoJ>', anexoJOpenIdx);

    expandSelfClosing('Quadro08', anexoJOpenIdx, anexoJCloseIdx);
    expandSelfClosing('Quadro09', anexoJOpenIdx, anexoJCloseIdx);

    // Inject 8 A
    xml = processBlock<TaxRow8A>(xml, {
      containerName: 'AnexoJq08AT01',
      quadroName: 'Quadro08',
      rows: rows8A,
      buildFields: (row, nLinha) => [
        ['NLinha', String(nLinha)],
        ['CodRendimento', row.codigo],
        ['CodPais', row.codPais],
        ['RendimentoBruto', row.rendimentoBruto],
        ['ImpostoPagoEstrangeiroPaisFonte', row.impostoPago]
      ],
      somaNodes: [
        { tag: 'AnexoJq08AT01SomaC01', fieldToSum: 'RendimentoBruto', computeNewSoma: rows => rows.reduce((acc, r) => acc + parseFloat(r.rendimentoBruto), 0) },
        { tag: 'AnexoJq08AT01SomaC02', fieldToSum: 'ImpostoPagoEstrangeiroPaisFonte', computeNewSoma: rows => rows.reduce((acc, r) => acc + parseFloat(r.impostoPago), 0) },
      ]
    }, anexoJOpenIdx);

    // Inject 9.2 A
    xml = processBlock<TaxRow>(xml, {
      containerName: 'AnexoJq092AT01',
      quadroName: 'Quadro09',
      rows: rows92A,
      buildFields: (row, nLinha) => [
        ['NLinha', String(nLinha)],
        ['CodPais', row.codPais],
        ['Codigo', row.codigo],
        ['AnoRealizacao', row.anoRealizacao],
        ['MesRealizacao', row.mesRealizacao],
        ['DiaRealizacao', row.diaRealizacao],
        ['ValorRealizacao', row.valorRealizacao],
        ['AnoAquisicao', row.anoAquisicao],
        ['MesAquisicao', row.mesAquisicao],
        ['DiaAquisicao', row.diaAquisicao],
        ['ValorAquisicao', row.valorAquisicao],
        ['DespesasEncargos', row.despesasEncargos],
        ['ImpostoPagoNoEstrangeiro', row.impostoPagoNoEstrangeiro],
        ['CodPaisContraparte', row.codPaisContraparte],
      ],
      somaNodes: [
        { tag: 'AnexoJq092AT01SomaC01', fieldToSum: 'ValorRealizacao', computeNewSoma: rows => rows.reduce((acc, r) => acc + parseFloat(r.valorRealizacao), 0) },
        { tag: 'AnexoJq092AT01SomaC02', fieldToSum: 'ValorAquisicao', computeNewSoma: rows => rows.reduce((acc, r) => acc + parseFloat(r.valorAquisicao), 0) },
        { tag: 'AnexoJq092AT01SomaC03', fieldToSum: 'DespesasEncargos', computeNewSoma: rows => rows.reduce((acc, r) => acc + parseFloat(r.despesasEncargos), 0) },
        { tag: 'AnexoJq092AT01SomaC04', fieldToSum: 'ImpostoPagoNoEstrangeiro', computeNewSoma: rows => rows.reduce((acc, r) => acc + parseFloat(r.impostoPagoNoEstrangeiro), 0) },
      ]
    }, anexoJOpenIdx);

    // Inject 9.2 B
    xml = processBlock<TaxRow92B>(xml, {
      containerName: 'AnexoJq092BT01',
      quadroName: 'Quadro09',
      rows: rows92B,
      buildFields: (row, nLinha) => [
        ['NLinha', String(nLinha)],
        ['CodRendimento', row.codigo],
        ['CodPais', row.codPais],
        ['RendimentoLiquido', row.rendimentoLiquido],
        ['ImpostoPagoEstrangeiro', row.impostoPagoNoEstrangeiro]
      ],
      somaNodes: [
        { tag: 'AnexoJq092BT01SomaC01', fieldToSum: 'RendimentoLiquido', computeNewSoma: rows => rows.reduce((acc, r) => acc + parseFloat(r.rendimentoLiquido), 0) },
        { tag: 'AnexoJq092BT01SomaC02', fieldToSum: 'ImpostoPagoEstrangeiro', computeNewSoma: rows => rows.reduce((acc, r) => acc + parseFloat(r.impostoPagoNoEstrangeiro), 0) },
      ]
    }, anexoJOpenIdx);
  }

  // ---------------------------------------------------------------------------
  // Anexo G enrichment (Quadro 13 – CFDs / Derivative instruments)
  // ---------------------------------------------------------------------------
  const anexoGOpenIdx = xml.indexOf('<AnexoG');
  if (anexoGOpenIdx !== -1 && rowsG13.length > 0) {
    const anexoGCloseIdx = xml.indexOf('</AnexoG>', anexoGOpenIdx);
    expandSelfClosing('Quadro13', anexoGOpenIdx, anexoGCloseIdx);

    xml = processBlock<TaxRowG13>(xml, {
      containerName: 'AnexoGq13T01',
      quadroName: 'Quadro13',
      rows: rowsG13,
      buildFields: (row, _nLinha) => [
        ['CodigoOperacao', row.codigoOperacao],
        ['Titular', row.titular],
        ['RendimentoLiquido', row.rendimentoLiquido],
        ['PaisContraparte', row.paisContraparte],
      ],
      somaNodes: [
        { tag: 'AnexoGq13T01SomaC01', fieldToSum: 'RendimentoLiquido', computeNewSoma: rows => rows.reduce((acc, r) => acc + parseFloat(r.rendimentoLiquido), 0) },
      ]
    }, anexoGOpenIdx);
  }

  // Build summary
  const fmt = (n: number) => n.toFixed(2);

  const summary: EnrichmentSummary = {
    table8A: {
      rowsAdded: rows8A.length,
      sources: sources.table8A,
      totals: rows8A.length === 0 ? [] : [
        { label: 'Gross Income (RendimentoBruto)', value: fmt(rows8A.reduce((a, r) => a + parseFloat(r.rendimentoBruto), 0)), currency: true },
        { label: 'Tax Paid Abroad (ImpostoPago)', value: fmt(rows8A.reduce((a, r) => a + parseFloat(r.impostoPago), 0)), currency: true },
      ],
    },
    table92A: {
      rowsAdded: rows92A.length,
      sources: sources.table92A,
      totals: rows92A.length === 0 ? [] : [
        { label: 'Realisation Value', value: fmt(rows92A.reduce((a, r) => a + parseFloat(r.valorRealizacao), 0)), currency: true },
        { label: 'Acquisition Value', value: fmt(rows92A.reduce((a, r) => a + parseFloat(r.valorAquisicao), 0)), currency: true },
        { label: 'Expenses & Charges', value: fmt(rows92A.reduce((a, r) => a + parseFloat(r.despesasEncargos), 0)), currency: true },
        { label: 'Tax Paid Abroad', value: fmt(rows92A.reduce((a, r) => a + parseFloat(r.impostoPagoNoEstrangeiro), 0)), currency: true },
      ],
    },
    table92B: {
      rowsAdded: rows92B.length,
      sources: sources.table92B,
      totals: rows92B.length === 0 ? [] : [
        { label: 'Net Income (RendimentoLiquido)', value: fmt(rows92B.reduce((a, r) => a + parseFloat(r.rendimentoLiquido), 0)), currency: true },
        { label: 'Tax Paid Abroad', value: fmt(rows92B.reduce((a, r) => a + parseFloat(r.impostoPagoNoEstrangeiro), 0)), currency: true },
      ],
    },
    tableG13: {
      rowsAdded: rowsG13.length,
      sources: sources.tableG13,
      totals: rowsG13.length === 0 ? [] : [
        { label: 'Net Income (RendimentoLiquido)', value: fmt(rowsG13.reduce((a, r) => a + parseFloat(r.rendimentoLiquido), 0)), currency: true },
      ],
    },
    totalRowsAdded: rows8A.length + rows92A.length + rows92B.length + rowsG13.length,
  };

  return { originalXml, enrichedXml: xml, summary };
}
