import {
  parseTradeRepublicPdf,
  parseTrading212Pdf,
  parseXtbCapitalGainsPdf,
  parseXtbDividendsPdf,
} from './pdfParser';
import { parseDegiroTransactionsCsv } from './degiroCsvParser';
import { enrichXmlWithGains } from './xmlModifier';
import type { BrokerName, EnrichmentResult, ParsedPdfData } from '../types';

export const NO_ROWS_FOUND_ERROR = 'NO_ROWS_FOUND';

export interface ProcessTaxFilesInput {
  xmlFile: File;
  xtbCapitalGainsPdf?: File | null;
  xtbDividendsPdf?: File | null;
  tradeRepublicPdf?: File | null;
  trading212Pdf?: File | null;
  degiroTransactionsCsv?: File | null;
}

export interface ProcessBrokerFilesInput {
  xtbCapitalGainsPdf?: File | null;
  xtbDividendsPdf?: File | null;
  tradeRepublicPdf?: File | null;
  trading212Pdf?: File | null;
  degiroTransactionsCsv?: File | null;
}

export interface BrokerFilesResult {
  parsedData: ParsedPdfData;
  sources: {
    table8A: string[];
    table92A: string[];
    table92B: string[];
    tableG13: string[];
  };
}

interface ParseJob {
  file: File | null | undefined;
  parser: (file: File) => Promise<ParsedPdfData>;
  brokerName: BrokerName;
}

interface AggregatedSources {
  table8A: Set<BrokerName>;
  table92A: Set<BrokerName>;
  table92B: Set<BrokerName>;
  tableG13: Set<BrokerName>;
}

function emptyParsedData(): ParsedPdfData {
  return {
    rows8A: [],
    rows92A: [],
    rows92B: [],
    rowsG13: [],
  };
}

function mergeParsedData(target: ParsedPdfData, incoming: ParsedPdfData, brokerName: BrokerName, sources: AggregatedSources): void {
  if (incoming.rows8A.length > 0) {
    target.rows8A.push(...incoming.rows8A);
    sources.table8A.add(brokerName);
  }

  if (incoming.rows92A.length > 0) {
    target.rows92A.push(...incoming.rows92A);
    sources.table92A.add(brokerName);
  }

  if (incoming.rows92B.length > 0) {
    target.rows92B.push(...incoming.rows92B);
    sources.table92B.add(brokerName);
  }

  if (incoming.rowsG13.length > 0) {
    target.rowsG13.push(...incoming.rowsG13);
    sources.tableG13.add(brokerName);
  }
}

function inferTargetRealizationYearFromXml(xmlText: string): string | undefined {
  const match = xmlText.match(/<Modelo3IRSv(\d{4})\b/);
  if (!match) {
    return undefined;
  }

  const filingCampaignYear = Number.parseInt(match[1], 10);
  if (!Number.isFinite(filingCampaignYear)) {
    return undefined;
  }

  return String(filingCampaignYear - 1);
}

/**
 * Parses all uploaded broker files and enriches the provided IRS XML.
 * Throws `NO_ROWS_FOUND_ERROR` when no supported rows are extracted.
 */
export async function processTaxFiles(input: ProcessTaxFilesInput): Promise<EnrichmentResult> {
  const originalXmlText = await input.xmlFile.text();
  const degiroTargetRealizationYear = inferTargetRealizationYearFromXml(originalXmlText);
  const parsedData = emptyParsedData();

  const sources: AggregatedSources = {
    table8A: new Set<BrokerName>(),
    table92A: new Set<BrokerName>(),
    table92B: new Set<BrokerName>(),
    tableG13: new Set<BrokerName>(),
  };

  const parseJobs: ParseJob[] = [
    {
      file: input.xtbCapitalGainsPdf,
      parser: parseXtbCapitalGainsPdf,
      brokerName: 'XTB',
    },
    {
      file: input.xtbDividendsPdf,
      parser: parseXtbDividendsPdf,
      brokerName: 'XTB',
    },
    {
      file: input.tradeRepublicPdf,
      parser: parseTradeRepublicPdf,
      brokerName: 'Trade Republic',
    },
    {
      file: input.trading212Pdf,
      parser: parseTrading212Pdf,
      brokerName: 'Trading 212',
    },
    {
      file: input.degiroTransactionsCsv,
      parser: file => parseDegiroTransactionsCsv(file, { targetRealizationYear: degiroTargetRealizationYear }),
      brokerName: 'DEGIRO',
    },
  ];

  for (const parseJob of parseJobs) {
    if (!parseJob.file) {
      continue;
    }

    const parsed = await parseJob.parser(parseJob.file);
    mergeParsedData(parsedData, parsed, parseJob.brokerName, sources);
  }

  const totalRows = parsedData.rows8A.length + parsedData.rows92A.length + parsedData.rows92B.length + parsedData.rowsG13.length;
  if (totalRows === 0) {
    throw new Error(NO_ROWS_FOUND_ERROR);
  }

  return enrichXmlWithGains(originalXmlText, parsedData, {
    table8A: [...sources.table8A],
    table92A: [...sources.table92A],
    table92B: [...sources.table92B],
    tableG13: [...sources.tableG13],
  });
}

/**
 * Parses all uploaded broker files and returns the raw parsed data without XML enrichment.
 * Throws `NO_ROWS_FOUND_ERROR` when no supported rows are extracted.
 */
export async function processBrokerFiles(input: ProcessBrokerFilesInput): Promise<BrokerFilesResult> {
  const parsedData = emptyParsedData();

  const sources: AggregatedSources = {
    table8A: new Set<BrokerName>(),
    table92A: new Set<BrokerName>(),
    table92B: new Set<BrokerName>(),
    tableG13: new Set<BrokerName>(),
  };

  const parseJobs: ParseJob[] = [
    {
      file: input.xtbCapitalGainsPdf,
      parser: parseXtbCapitalGainsPdf,
      brokerName: 'XTB',
    },
    {
      file: input.xtbDividendsPdf,
      parser: parseXtbDividendsPdf,
      brokerName: 'XTB',
    },
    {
      file: input.tradeRepublicPdf,
      parser: parseTradeRepublicPdf,
      brokerName: 'Trade Republic',
    },
    {
      file: input.trading212Pdf,
      parser: parseTrading212Pdf,
      brokerName: 'Trading 212',
    },
    {
      file: input.degiroTransactionsCsv,
      parser: parseDegiroTransactionsCsv,
      brokerName: 'DEGIRO',
    },
  ];

  for (const parseJob of parseJobs) {
    if (!parseJob.file) {
      continue;
    }

    const parsed = await parseJob.parser(parseJob.file);
    mergeParsedData(parsedData, parsed, parseJob.brokerName, sources);
  }

  const totalRows = parsedData.rows8A.length + parsedData.rows92A.length + parsedData.rows92B.length + parsedData.rowsG13.length;
  if (totalRows === 0) {
    throw new Error(NO_ROWS_FOUND_ERROR);
  }

  return {
    parsedData,
    sources: {
      table8A: [...sources.table8A],
      table92A: [...sources.table92A],
      table92B: [...sources.table92B],
      tableG13: [...sources.tableG13],
    },
  };
}

/**
 * Triggers a browser download for an XML string and always revokes the object URL.
 */
export function downloadXmlFile(content: string, fileName: string): void {
  const blob = new Blob([content], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(url);
  }
}
