import { describe, expect, it } from 'vitest';
import { normalizeFieldValue, normalizeNumber } from '@/core/extraction/normalizer';
import { extractRecordsFromContainers } from '@/core/extraction/extractor';
import { normalizeValues } from '@/core/cleaning/data-cleaner';
import { parseNumberValue } from '@/utils/dom';
import { parseNumberDetailed } from '@/utils/number-parser';

const NBSP = ' ';

describe('parseNumberDetailed', () => {
  describe('values with only one reading', () => {
    it.each<[string, number]>([
      ['€1.234,56', 1234.56],
      ['1 234,56 €', 1234.56],
      [`1${NBSP}234,56${NBSP}€`, 1234.56],
      ['1 234,56 €', 1234.56],
      ['$1,299.00', 1299],
      ['1,234.5', 1234.5],
      ['1.234.567', 1234567],
      ['1,234,567', 1234567],
      ['₹1,29,999', 129999],
      ["1'234.50", 1234.5],
      ['49,99 €', 49.99],
      ['12,50', 12.5],
      ['1,5', 1.5],
      ['0,125', 0.125],
      ['0.125', 0.125],
      ['1.50', 1.5],
      ['1234,567', 1234.567],
      ['1 500.00 USD', 1500],
      ['42', 42],
      ['Price: 42 €', 42],
      ['12 reviews', 12],
      ['100%', 100],
    ])('reads %s as %d', (text, expected) => {
      const result = parseNumberDetailed(text);
      expect(result.status).toBe('ok');
      expect(result.value).toBe(expected);
    });
  });

  describe('trailing EUR takes precedence over page locale', () => {
    it('"1.234 \u20ac" on a lang="en" page parses as 1234, not 1.234', () => {
      const result = parseNumberDetailed('1.234 \u20ac', { locale: 'en' });
      expect(result.status).toBe('ok');
      expect(result.value).toBe(1234);
    });

    it('"1.234 \u20ac" with no locale still parses as 1234', () => {
      const result = parseNumberDetailed('1.234 \u20ac');
      expect(result.status).toBe('ok');
      expect(result.value).toBe(1234);
    });

    it('"1.234" without currency still uses locale ("en" yields 1.234)', () => {
      const result = parseNumberDetailed('1.234', { locale: 'en' });
      expect(result.status).toBe('ok');
      expect(result.value).toBe(1.234);
    });
  });

  describe('negative values', () => {    it.each<[string, number]>([
      ['-5', -5],
      ['−5', -5],
      ['– 5', -5],
      ['-$25.50', -25.5],
      ['$-25.50', -25.5],
      ['-15.5%', -15.5],
      ['-1.234,50 €', -1234.5],
      ['($5.00)', -5],
    ])('reads %s as %d', (text, expected) => {
      const result = parseNumberDetailed(text);
      expect(result.status).toBe('ok');
      expect(result.value).toBe(expected);
    });

    it('does not read a count in brackets as negative', () => {
      expect(parseNumberDetailed('(5)').value).toBe(5);
      expect(parseNumberDetailed('(12 reviews)').value).toBe(12);
    });
  });

  describe('ranges keep both ends', () => {
    it.each<[string, number, number]>([
      ['$150,000 - $185,000 / yr', 150000, 185000],
      ['10–20', 10, 20],
      ['10 — 20', 10, 20],
      ['$10 to $20', 10, 20],
      ['1.000,50 € - 2.000,75 €', 1000.5, 2000.75],
    ])('reads %s', (text, min, max) => {
      const result = parseNumberDetailed(text);
      expect(result.status).toBe('range');
      expect(result).toMatchObject({ min, max, value: null });
    });

    it('does not treat a descending pair as a range', () => {
      expect(parseNumberDetailed('2024-01').status).toBe('ambiguous');
    });
  });

  describe('ambiguous values are never guessed', () => {
    it.each<[string, string]>([
      ['1,234', 'separator'],
      ['1.234', 'separator'],
      ['€1.234', 'separator'],
      ['€1,234', 'separator'],
      ['$1.234', 'separator'],
      ['2 for $10', 'multiple numbers'],
      ['Was $20 now $15', 'multiple numbers'],
      ['From $5', 'qualifier'],
      ['Up to 5', 'qualifier'],
      ['2024-01-02', 'multiple numbers'],
      ['1.2.3', 'separator'],
      ['1,23,4', 'separator'],
      ['1.2k', 'scale'],
      ['$3 million', 'scale'],
    ])('flags %s (%s)', (text, reason) => {
      const result = parseNumberDetailed(text);
      expect(result.status).toBe('ambiguous');
      expect(result.value).toBeNull();
      expect(result.reason).toContain(reason);
    });

    it('offers both readings of a separator it cannot decide', () => {
      expect(parseNumberDetailed('1.234').candidates).toEqual([1.234, 1234]);
      expect(parseNumberDetailed('1,234').candidates).toEqual([1.234, 1234]);
    });
  });

  describe('context that settles an ambiguous separator', () => {
    it('uses the currency convention for a comma with $, £, ₹ or ¥', () => {
      expect(parseNumberDetailed('$1,234').value).toBe(1234);
      expect(parseNumberDetailed('£1,234').value).toBe(1234);
      expect(parseNumberDetailed('₹1,234').value).toBe(1234);
      expect(parseNumberDetailed('¥1,500').value).toBe(1500);
    });

    it('reads a dot before a trailing euro sign as thousands', () => {
      expect(parseNumberDetailed('1.234 €').value).toBe(1234);
    });

    it('uses the language of the page', () => {
      expect(parseNumberDetailed('1.234', { locale: 'de' }).value).toBe(1234);
      expect(parseNumberDetailed('1,234', { locale: 'de' }).value).toBe(1.234);
      expect(parseNumberDetailed('1,234', { locale: 'en-US' }).value).toBe(1234);
      expect(parseNumberDetailed('1.234', { locale: 'en-US' }).value).toBe(1.234);
      expect(parseNumberDetailed('€1.234', { locale: 'fr-FR' }).value).toBe(1234);
    });

    it('ignores a language tag it cannot use', () => {
      expect(parseNumberDetailed('1.234', { locale: 'not a locale!' }).status).toBe('ambiguous');
    });
  });

  describe('values that are not numbers', () => {
    it.each(['Out of stock', '', '   ', 'N/A'])('reports %j as invalid', (text) => {
      const result = parseNumberDetailed(text);
      expect(result.status).toBe('invalid');
      expect(result.value).toBeNull();
    });

    it('reads a free item as zero, keeping the original words', () => {
      expect(parseNumberDetailed('Free download')).toMatchObject({ status: 'ok', value: 0, raw: 'Free download' });
    });
  });

  describe('ratings', () => {
    it.each<[string, number]>([
      ['4.8 out of 5', 4.8],
      ['4.8 / 5', 4.8],
      ['4,8 out of 5 stars', 4.8],
    ])('reads %s as %d', (text, expected) => {
      expect(parseNumberDetailed(text)).toMatchObject({ status: 'ok', value: expected });
    });
  });

  describe('metadata', () => {
    it('always keeps the original text', () => {
      expect(parseNumberDetailed(` €1.234,56${NBSP}`).raw).toBe(` €1.234,56${NBSP}`);
    });

    it.each<[string, string]>([
      ['€5', 'EUR'],
      ['5 €', 'EUR'],
      ['£5', 'GBP'],
      ['₹5', 'INR'],
      ['5 USD', 'USD'],
      ['CHF 120.50', 'CHF'],
      ['US$5', 'USD'],
      ['C$5', 'CAD'],
      ['A$5', 'AUD'],
      ['R$5', 'BRL'],
      ['CAD $89.00', 'CAD'],
    ])('reads the currency of %s as %s', (text, currency) => {
      expect(parseNumberDetailed(text).currency).toBe(currency);
    });

    it('keeps the symbol but names no currency when the symbol is shared', () => {
      expect(parseNumberDetailed('$5').currency).toBeUndefined();
      expect(parseNumberDetailed('$5').currencySymbol).toBe('$');
      expect(parseNumberDetailed('¥5').currency).toBeUndefined();
      expect(parseNumberDetailed('¥5').currencySymbol).toBe('¥');
    });

    it('reports the currency of a range', () => {
      expect(parseNumberDetailed('€10 - €20').currency).toBe('EUR');
    });
  });
});

describe('the production paths use this parser', () => {
  it('normalizeNumber returns no number for a value it cannot be sure of', () => {
    expect(normalizeNumber('1.234.567')).toBe(1234567);
    expect(normalizeNumber('−5')).toBe(-5);
    expect(normalizeNumber("1'234.50")).toBe(1234.5);
    expect(normalizeNumber('1.234')).toBeNull();
    expect(normalizeNumber('2 for $10')).toBeNull();
    expect(normalizeNumber('2024-01-02')).toBeNull();
    expect(normalizeNumber('$150,000 - $185,000')).toBeNull();
  });

  it('parseNumberValue agrees with extraction', () => {
    expect(parseNumberValue('€1.234,56')).toBe(1234.56);
    expect(parseNumberValue('1 234,56 €')).toBe(1234.56);
    expect(parseNumberValue('49,99 €')).toBe(49.99);
    expect(parseNumberValue('1.234')).toBeNull();
  });

  it('a number field keeps the text of a value it cannot read as one number', () => {
    expect(normalizeFieldValue('$150,000 - $185,000 / yr', 'number')).toBe('$150,000 - $185,000 / yr');
    expect(normalizeFieldValue('1.234', 'number')).toBe('1.234');
    expect(normalizeFieldValue('Out of stock', 'number')).toBeNull();
    expect(normalizeFieldValue('€1.234,56', 'number')).toBe(1234.56);
  });

  it('a number field uses the language of the page', () => {
    document.documentElement.lang = 'de';
    const element = document.createElement('span');
    expect(normalizeFieldValue('1.234', 'number', { element })).toBe(1234);
    document.documentElement.lang = '';
  });

  it('the Normalize tool leaves a value alone rather than guess', () => {
    const { records } = normalizeValues(
      [
        { _id: '1', _page: 1, _extractedAt: 1, Price: '49,99 €' },
        { _id: '2', _page: 1, _extractedAt: 1, Price: '1.234' },
        { _id: '3', _page: 1, _extractedAt: 1, Price: 'Call us' },
      ],
      'Price',
      'number'
    );

    expect(records.map((record) => record.Price)).toEqual([49.99, '1.234', 'Call us']);
  });
});

describe('extraction keeps the evidence with each row', () => {
  const fields = [
    { id: 'p', name: 'Price', selector: '.p', extractor: 'number' as const, required: false, transform: 'trim' as const },
  ];
  const rows = (values: string[]) => {
    document.body.innerHTML = values.map((value) => `<div class="c"><span class="p">${value}</span></div>`).join('');
    return extractRecordsFromContainers(Array.from(document.querySelectorAll('.c')), fields).records;
  };
  const notes = (record: Record<string, unknown>) => JSON.parse(String(record._valueNotes));

  it('stores the original text and currency next to the number', () => {
    const [row] = rows(['€1.234,56']);

    expect(row.Price).toBe(1234.56);
    expect(notes(row).Price).toMatchObject({ raw: '€1.234,56', status: 'ok', currency: 'EUR' });
  });

  it('stores both ends of a range and keeps the text as the value', () => {
    const [row] = rows(['$150,000 - $185,000 / yr']);

    expect(row.Price).toBe('$150,000 - $185,000 / yr');
    expect(notes(row).Price).toMatchObject({ status: 'range', min: 150000, max: 185000 });
  });

  it('marks an ambiguous value and does not count it as missing', () => {
    const [row] = rows(['1.234']);

    expect(row.Price).toBe('1.234');
    expect(notes(row).Price).toMatchObject({ status: 'ambiguous', candidates: [1.234, 1234] });
    expect(row._missingFields).toBeUndefined();
  });

  it('keeps the words when there is no number at all', () => {
    const [row] = rows(['Call for price']);

    expect(row.Price).toBeNull();
    expect(row._missingFields).toBe('Price');
    expect(notes(row).Price).toMatchObject({ status: 'invalid', raw: 'Call for price' });
  });

  it('writes no notes for an element that is not there', () => {
    document.body.innerHTML = '<div class="c"></div>';
    const [row] = extractRecordsFromContainers(Array.from(document.querySelectorAll('.c')), fields).records;

    expect(row._valueNotes).toBeUndefined();
  });
});
