/**
 * The one number parser. Extraction, field discovery and the Normalize tool all use it.
 *
 * It never turns a value into a number it is unsure of. "1.234" is 1.234 in the US and 1234
 * in Germany, so unless the currency or the page's language settles it, the status is
 * 'ambiguous' and both readings are returned. The caller keeps the original text.
 */
export type NumberParseStatus = 'ok' | 'range' | 'ambiguous' | 'invalid';

export interface NumberParseResult {
  /** The text exactly as it was given. */
  raw: string;
  status: NumberParseStatus;
  /** Set only when the status is 'ok'. */
  value: number | null;
  /** Both ends of a range. */
  min?: number;
  max?: number;
  /** ISO 4217 code, only when the text identifies one currency. */
  currency?: string;
  /** The symbol as written, including shared ones such as $ and ¥. */
  currencySymbol?: string;
  /** Why the value could not be read as one number. */
  reason?: string;
  /** The readings of a separator that could not be decided, lowest first. */
  candidates?: number[];
}

export interface NumberParseOptions {
  /** The page's language, such as the lang attribute of the document. */
  locale?: string;
}

const CURRENCY_CODES = 'USD|EUR|GBP|CAD|AUD|NZD|JPY|CNY|INR|CHF|SEK|NOK|DKK|PLN|CZK|HUF|BRL|MXN|ZAR|RUB|TRY|KRW';
const PREFIXED_SYMBOLS: Record<string, string> = {
  US$: 'USD',
  CA$: 'CAD',
  C$: 'CAD',
  AU$: 'AUD',
  A$: 'AUD',
  NZ$: 'NZD',
  R$: 'BRL',
};
const UNIQUE_SYMBOLS: Record<string, string> = {
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '₩': 'KRW',
  '₽': 'RUB',
  '₺': 'TRY',
};
const CURRENCY_PATTERN = new RegExp(
  `\\b(?:${CURRENCY_CODES})\\b|(?:US|CA|C|AU|A|NZ|R)\\$|[$€£¥₹₩₽₺]`,
  'gi'
);
/** Currencies written with a comma for thousands, so "$1,234" can only mean 1234. */
const COMMA_THOUSANDS_SYMBOLS = new Set(['$', '£', '₹', '¥']);

const NUMBER_TOKEN = /\d{1,3}(?:[ '’]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)*/g;
const SCALE_WORD = /^\s?(?:k|m|mn|bn|b|thousand|million|billion|trillion)(?![a-z])/i;
const RANGE_WORD = /^(?:-|–|—|~|to|bis|à|até)$/i;
const FREE_WORD = /^(?:free|gratis|complimentary)\b/i;
const RATING = /(\d+(?:[.,]\d+)?)\s*(?:out of|\/)\s*\d+/i;

type TokenReading =
  | { kind: 'number'; value: number }
  | { kind: 'ambiguous'; reason: string; candidates?: number[] };

interface CurrencyInfo {
  currency?: string;
  currencySymbol?: string;
  /** The currency is written after the amount, as is usual in continental Europe. */
  trailing: boolean;
}

function detectCurrency(text: string, firstTokenIndex: number): CurrencyInfo {
  const matches = Array.from(text.matchAll(CURRENCY_PATTERN));
  if (matches.length === 0) return { trailing: false };

  const written = matches.map((match) => match[0]);
  const named = written
    .map((symbol) => {
      const upper = symbol.toUpperCase();
      return PREFIXED_SYMBOLS[upper] ?? UNIQUE_SYMBOLS[symbol] ?? (/^[A-Z]{3}$/.test(upper) ? upper : undefined);
    })
    .filter((code): code is string => code !== undefined);

  return {
    currency: new Set(named).size === 1 ? named[0] : undefined,
    currencySymbol: written.find((symbol) => /[$€£¥₹₩₽₺]/.test(symbol)),
    trailing: (matches[0].index ?? 0) > firstTokenIndex,
  };
}

function decimalSeparatorOf(locale: string | undefined): '.' | ',' | null {
  if (!locale) return null;
  try {
    const decimal = new Intl.NumberFormat(locale)
      .formatToParts(1.5)
      .find((part) => part.type === 'decimal')?.value;
    return decimal === ',' || decimal === '.' ? decimal : null;
  } catch {
    return null;
  }
}

function digits(text: string): number {
  return Number(text.replace(/[^\d.]/g, ''));
}

function readSingleSeparator(
  token: string,
  separator: '.' | ',',
  currency: CurrencyInfo,
  locale: string | undefined
): TokenReading {
  const [whole, fraction] = token.split(separator);
  const asDecimal = Number(`${whole}.${fraction}`);

  // Only three digits after a separator, with a short non-zero start, can be thousands.
  const couldBeThousands = fraction.length === 3 && whole.length <= 3 && !whole.startsWith('0');
  if (!couldBeThousands) return { kind: 'number', value: asDecimal };

  const asThousands = Number(`${whole}${fraction}`);
  const decimal = decimalSeparatorOf(locale);
  if (decimal) {
    return { kind: 'number', value: separator === decimal ? asDecimal : asThousands };
  }
  if (separator === ',' && currency.currencySymbol && COMMA_THOUSANDS_SYMBOLS.has(currency.currencySymbol)) {
    return { kind: 'number', value: asThousands };
  }
  if (separator === '.' && currency.trailing && currency.currency === 'EUR') {
    return { kind: 'number', value: asThousands };
  }
  return {
    kind: 'ambiguous',
    reason: `The separator in "${token}" could mean decimals or thousands.`,
    candidates: [asDecimal, asThousands],
  };
}

function readToken(token: string, currency: CurrencyInfo, locale: string | undefined): TokenReading {
  const invalid: TokenReading = {
    kind: 'ambiguous',
    reason: `The separator pattern in "${token}" is not a known number format.`,
  };
  const grouped = /[ '’]/.test(token);
  const compact = token.replace(/[ '’]/g, '');
  const commas = (compact.match(/,/g) ?? []).length;
  const dots = (compact.match(/\./g) ?? []).length;

  if (commas === 0 && dots === 0) return { kind: 'number', value: Number(compact) };

  if (grouped) {
    // A space or apostrophe is only ever a thousands separator.
    return commas + dots === 1
      ? { kind: 'number', value: Number(compact.replace(',', '.')) }
      : invalid;
  }

  if (commas > 0 && dots > 0) {
    const decimal = compact.lastIndexOf(',') > compact.lastIndexOf('.') ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    const lastIndex = compact.lastIndexOf(decimal);
    const whole = compact.slice(0, lastIndex);
    const fraction = compact.slice(lastIndex + 1);
    const validGroups = new RegExp(`^\\d{1,3}(?:\\${thousands}\\d{2,3})+$`).test(whole);
    if (!validGroups || compact.split(decimal).length !== 2) return invalid;
    return { kind: 'number', value: digits(`${whole.split(thousands).join('')}.${fraction}`) };
  }

  const separator = commas > 0 ? ',' : '.';
  if (commas + dots === 1) return readSingleSeparator(compact, separator, currency, locale);

  const thousandsGroups = new RegExp(`^\\d{1,3}(?:\\${separator}\\d{3})+$`).test(compact);
  const indianGroups = separator === ',' && /^\d{1,2}(?:,\d{2})+,\d{3}$/.test(compact);
  if (thousandsGroups || indianGroups) {
    return { kind: 'number', value: Number(compact.split(separator).join('')) };
  }
  return invalid;
}

function isNegative(text: string, index: number, end: number, hasCurrency: boolean): boolean {
  const before = text.slice(0, index).replace(CURRENCY_PATTERN, '').trimEnd();
  if (/(?:^|[\s(])[-–—−]$/.test(before)) return true;
  if (hasCurrency && before.endsWith('(')) {
    return text.slice(end).replace(CURRENCY_PATTERN, '').trimStart().startsWith(')');
  }
  return false;
}

export function parseNumberDetailed(input: unknown, options: NumberParseOptions = {}): NumberParseResult {
  const raw = input === null || input === undefined ? '' : String(input);
  const text = raw.replace(/[    ]/g, ' ').replace(/−/g, '-').trim();
  const invalid: NumberParseResult = { raw, status: 'invalid', value: null };
  if (!text) return invalid;

  if (FREE_WORD.test(text)) {
    return { raw, status: 'ok', value: 0, reason: 'free' };
  }

  const tokens = Array.from(text.matchAll(NUMBER_TOKEN));
  if (tokens.length === 0) return invalid;

  const firstIndex = tokens[0].index ?? 0;
  const currency = detectCurrency(text, firstIndex);
  const metadata = {
    ...(currency.currency ? { currency: currency.currency } : {}),
    ...(currency.currencySymbol ? { currencySymbol: currency.currencySymbol } : {}),
  };
  const ambiguous = (reason: string, candidates?: number[]): NumberParseResult => ({
    raw,
    status: 'ambiguous',
    value: null,
    reason,
    ...(candidates ? { candidates } : {}),
    ...metadata,
  });

  if (!currency.currencySymbol) {
    const rating = text.match(RATING);
    if (rating) {
      return { raw, status: 'ok', value: Number(rating[1].replace(',', '.')) };
    }
  }

  const locale = options.locale;
  if (tokens.length === 2) {
    const between = text
      .slice((tokens[0].index ?? 0) + tokens[0][0].length, tokens[1].index ?? 0)
      .replace(CURRENCY_PATTERN, '')
      .trim();
    if (RANGE_WORD.test(between)) {
      const low = readToken(tokens[0][0], currency, locale);
      const high = readToken(tokens[1][0], currency, locale);
      if (low.kind === 'number' && high.kind === 'number' && high.value >= low.value) {
        return { raw, status: 'range', value: null, min: low.value, max: high.value, ...metadata };
      }
      if (low.kind === 'number' && high.kind === 'number') {
        return ambiguous('multiple numbers that are not a range');
      }
      return ambiguous('The separator in a range could mean decimals or thousands.');
    }
  }

  if (tokens.length > 1) {
    return ambiguous('The text has multiple numbers, so no single value can be chosen.');
  }

  const token = tokens[0];
  const end = (token.index ?? 0) + token[0].length;
  if (SCALE_WORD.test(text.slice(end))) {
    return ambiguous('The number has a scale word or letter, such as k or million.');
  }

  const reading = readToken(token[0], currency, locale);
  if (reading.kind === 'ambiguous') return ambiguous(reading.reason, reading.candidates);

  const negative = isNegative(text, token.index ?? 0, end, Boolean(currency.currencySymbol));
  return { raw, status: 'ok', value: negative ? -reading.value : reading.value, ...metadata };
}
