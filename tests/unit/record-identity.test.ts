import { describe, expect, it } from 'vitest';
import {
  canonicalizeRecord,
  fingerprintRecord,
  sha256Hex,
} from '@/core/extraction/record-identity';

describe('Canonical record identity', () => {
  it('produces the same form regardless of field order', () => {
    expect(canonicalizeRecord({ a: 1, b: 'x' })).toBe(canonicalizeRecord({ b: 'x', a: 1 }));
  });

  it('collapses whitespace and normalizes Unicode, but keeps letter case', () => {
    expect(canonicalizeRecord({ t: '  a   b\n c ' })).toBe(canonicalizeRecord({ t: 'a b c' }));
    expect(canonicalizeRecord({ t: 'Café' })).toBe(canonicalizeRecord({ t: 'Café' }));
    expect(canonicalizeRecord({ t: 'Abc' })).not.toBe(canonicalizeRecord({ t: 'abc' }));
  });

  it('treats null, undefined, empty strings and absent fields as no value', () => {
    const expected = canonicalizeRecord({ a: 1 });
    expect(canonicalizeRecord({ a: 1, b: null })).toBe(expected);
    expect(canonicalizeRecord({ a: 1, b: undefined })).toBe(expected);
    expect(canonicalizeRecord({ a: 1, b: '   ' })).toBe(expected);
  });

  it('keeps value types distinct', () => {
    expect(canonicalizeRecord({ a: 5 })).not.toBe(canonicalizeRecord({ a: '5' }));
    expect(canonicalizeRecord({ a: true })).not.toBe(canonicalizeRecord({ a: 'true' }));
  });

  it('cannot be confused by values that look like separators', () => {
    expect(canonicalizeRecord({ a: 'x|b:y' })).not.toBe(canonicalizeRecord({ a: 'x', b: 'y' }));
    expect(canonicalizeRecord({ a: '","b","y' })).not.toBe(canonicalizeRecord({ a: '', b: 'y' }));
  });

  it('leaves out provenance metadata', () => {
    expect(
      canonicalizeRecord({ a: 1, _id: 'x', _page: 3, _hash: 'h', _sourceUrl: 'u', datasetId: 'd' })
    ).toBe(canonicalizeRecord({ a: 1 }));
  });

  it('can limit identity to selected fields', () => {
    expect(canonicalizeRecord({ a: 1, b: 2 }, ['a'])).toBe(canonicalizeRecord({ a: 1, b: 3 }, ['a']));
  });
});

describe('SHA-256 fingerprints', () => {
  it('matches the known SHA-256 test vector', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('hashes Unicode as UTF-8', async () => {
    expect(await sha256Hex('é')).toBe(
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c'
    );
  });

  it('returns the canonical form with its hash', async () => {
    const result = await fingerprintRecord({ b: 2, a: 1 });
    expect(result.canonical).toBe('[["a",1],["b",2]]');
    expect(result.hash).toBe(await sha256Hex(result.canonical));
  });

  it('uses an injected hash when one is supplied', async () => {
    const result = await fingerprintRecord({ a: 1 }, async () => 'fixed');
    expect(result.hash).toBe('fixed');
  });
});
