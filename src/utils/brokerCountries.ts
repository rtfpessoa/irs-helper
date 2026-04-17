const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  Germany: '276',
  Australia: '036',
  Austria: '040',
  Belgium: '056',
  Brazil: '076',
  Canada: '124',
  China: '156',
  Cyprus: '196',
  Denmark: '208',
  Spain: '724',
  'United States': '840',
  USA: '840',
  US: '840',
  Finland: '246',
  France: '250',
  Ireland: '372',
  Italy: '380',
  Japan: '392',
  Luxembourg: '442',
  Norway: '578',
  Netherlands: '528',
  Portugal: '620',
  'United Kingdom': '826',
  UK: '826',
  Sweden: '752',
  Switzerland: '756',
};

const ISIN_PREFIX_TO_CODE: Record<string, string> = {
  AU: '036',
  AT: '040',
  BE: '056',
  BR: '076',
  CA: '124',
  CN: '156',
  CY: '196',
  DK: '208',
  FI: '246',
  FR: '250',
  DE: '276',
  IE: '372',
  IT: '380',
  JP: '392',
  LU: '442',
  NL: '528',
  NO: '578',
  PT: '620',
  ES: '724',
  SE: '752',
  CH: '756',
  GB: '826',
  US: '840',
};

export function resolveCountryCode(name: string): string | undefined {
  return COUNTRY_NAME_TO_CODE[name];
}

export function resolveCountryCodeFromIsin(isin: string): string | undefined {
  return ISIN_PREFIX_TO_CODE[isin.trim().slice(0, 2).toUpperCase()];
}
