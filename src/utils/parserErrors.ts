export class BrokerParsingError extends Error {
  /** i18n key for the UI to use */
  public readonly i18nKey: string;
  /** Interpolation params for i18n */
  public readonly i18nParams: Record<string, string>;

  constructor(message: string, i18nKey: string, i18nParams: Record<string, string> = {}) {
    super(message);
    this.name = 'BrokerParsingError';
    this.i18nKey = i18nKey;
    this.i18nParams = i18nParams;
  }
}
