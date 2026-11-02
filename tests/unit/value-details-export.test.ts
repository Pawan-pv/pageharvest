import { describe, expect, it } from 'vitest';
import { recordsToCsv, recordsToJson, withValueDetails, countValuesNeedingReview } from '@/core/export/exporter';
import { ExtractedRecord } from '@/types';

const notes = (value: object) => JSON.stringify({ Price: value });
const RECORDS: ExtractedRecord[] = [
  {
    _id: '1', _page: 1, _extractedAt: 1, Title: 'A', Price: 1234.56,
    _valueNotes: notes({ raw: '€1.234,56', status: 'ok', value: 1234.56, currency: 'EUR' }),
  },
  {
    _id: '2', _page: 1, _extractedAt: 1, Title: 'B', Price: '$10 - $20',
    _valueNotes: notes({ raw: '$10 - $20', status: 'range', value: null, min: 10, max: 20, currencySymbol: '$' }),
  },
  {
    _id: '3', _page: 1, _extractedAt: 1, Title: 'C', Price: '1.234',
    _valueNotes: notes({ raw: '1.234', status: 'ambiguous', value: null, candidates: [1.234, 1234] }),
  },
  { _id: '4', _page: 1, _extractedAt: 1, Title: 'D', Price: null },
];
const FIELDS = [
  { id: 't', name: 'Title', selector: '.t', extractor: 'text' as const },
  { id: 'p', name: 'Price', selector: '.p', extractor: 'number' as const },
];

describe('how a number was read reaches the user', () => {
  it('counts the values that need a person to look at them', () => {
    expect(countValuesNeedingReview(RECORDS)).toBe(1);
  });

  it('leaves exports as they were by default', () => {
    expect(recordsToCsv(RECORDS, FIELDS, { useBom: false }).split('\r\n')[0]).toBe('Title,Price');
  });

  it('adds the original text, currency, status and range to a CSV when asked', () => {
    const { records, fields } = withValueDetails(RECORDS, FIELDS);
    const lines = recordsToCsv(records, fields, { useBom: false }).split('\r\n');

    expect(lines[0]).toBe('Title,Price,Price (original),Price (status),Price (currency),Price (min),Price (max)');
    expect(lines[1]).toBe('A,1234.56,"€1.234,56",ok,EUR,,');
    expect(lines[2]).toBe('B,$10 - $20,$10 - $20,range,$,10,20');
    expect(lines[3]).toBe('C,1.234,1.234,ambiguous,,,');
    expect(lines[4]).toBe('D,,,,,,');
  });

  it('adds the same details to JSON', () => {
    const { records, fields } = withValueDetails(RECORDS, FIELDS);
    const [first] = JSON.parse(recordsToJson(records, fields, { format: 'json', pretty: false }));

    expect(first).toMatchObject({ Price: 1234.56, 'Price (original)': '€1.234,56', 'Price (currency)': 'EUR' });
  });

  it('adds nothing for records with no number fields', () => {
    const plain = [{ _id: '1', _page: 1, _extractedAt: 1, Title: 'A' }];

    expect(withValueDetails(plain, FIELDS.slice(0, 1)).fields).toHaveLength(1);
  });

  it('survives notes it cannot read', () => {
    const broken = [{ _id: '1', _page: 1, _extractedAt: 1, Price: 1, _valueNotes: 'not json' }];

    expect(countValuesNeedingReview(broken)).toBe(0);
    expect(() => withValueDetails(broken, FIELDS)).not.toThrow();
  });
});
