/* global URL */
/**
 * Scoring for the real-site benchmark. Pure, so the scoring itself can be tested: a bug here
 * could otherwise make the results look better than they are.
 *
 * Truth records come from hand-written selectors in tests/benchmark/sites.json, which share
 * no code with the extension.
 */

const round = (value) => Math.round(value * 10000) / 10000;

export function normalizeForComparison(value, field) {
  if (value === null || value === undefined) return null;
  if (field.kind === 'number') {
    if (typeof value === 'number') return value;
    const text = String(value);
    const digits =
      field.numberFormat === 'eu'
        ? text.replace(/[^0-9,-]/g, '').replace(',', '.')
        : text.replace(/[^0-9.-]/g, '');
    if (digits === '' || digits === '-') return null;
    const parsed = Number(digits);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const text = String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

function valuesMatch(rowValue, truthValue, field) {
  const actual = normalizeForComparison(rowValue, field);
  const expected = normalizeForComparison(truthValue, field);
  if (actual === null || expected === null) return false;
  if (field.kind === 'srcset') {
    // The extension chooses one candidate from the srcset, which must be a real one.
    try {
      const url = new URL(String(actual));
      return String(expected).includes(`${url.pathname}${url.search}`);
    } catch {
      return false;
    }
  }
  return actual === expected;
}

/** The column that best holds a truth field. The extension names columns itself. */
function bestColumn(matched, field) {
  const counts = new Map();
  for (const { row, truth } of matched) {
    for (const [column, value] of Object.entries(row)) {
      if (column.startsWith('_') || column === 'datasetId') continue;
      if (valuesMatch(value, truth[field.name], field)) {
        counts.set(column, (counts.get(column) ?? 0) + 1);
      }
    }
  }
  let best = null;
  let bestCount = 0;
  for (const [column, count] of counts) {
    if (count > bestCount) {
      best = column;
      bestCount = count;
    }
  }
  return best;
}

function keyColumn(rows, truthKeys, keyField) {
  const counts = new Map();
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (column.startsWith('_') || column === 'datasetId') continue;
      if (truthKeys.has(normalizeForComparison(value, keyField))) {
        counts.set(column, (counts.get(column) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function computeMetrics({ truthRecords, rows, key, fields, pagesVisited, expectedPages }) {
  const keyField = fields.find((field) => field.name === key) ?? { name: key, kind: 'text' };

  const truthByKey = new Map();
  for (const record of truthRecords) {
    const value = normalizeForComparison(record[key], keyField);
    if (value !== null && !truthByKey.has(value)) truthByKey.set(value, record);
  }

  const column = keyColumn(rows, new Set(truthByKey.keys()), keyField);
  const seen = new Set();
  const matched = [];
  let correctRows = 0;
  let duplicates = 0;

  for (const row of rows) {
    const value = column === null ? null : normalizeForComparison(row[column], keyField);
    if (value !== null && truthByKey.has(value)) {
      correctRows += 1;
      if (seen.has(value)) {
        duplicates += 1;
      } else {
        seen.add(value);
        matched.push({ row, truth: truthByKey.get(value) });
      }
    }
  }

  const perField = {};
  let totalChecked = 0;
  let totalCorrect = 0;
  let totalPresent = 0;
  let totalExpected = 0;

  for (const field of fields) {
    const fieldColumn = bestColumn(matched, field);
    let correct = 0;
    let present = 0;
    let expected = 0;
    for (const { row, truth } of matched) {
      if (normalizeForComparison(truth[field.name], field) === null) continue;
      expected += 1;
      const value = fieldColumn === null ? null : row[fieldColumn];
      if (normalizeForComparison(value, field) === null) continue;
      present += 1;
      if (valuesMatch(value, truth[field.name], field)) correct += 1;
    }
    perField[field.name] = {
      column: fieldColumn,
      accuracy: present > 0 ? round(correct / present) : 0,
      completeness: expected > 0 ? round(present / expected) : 0,
    };
    totalChecked += present;
    totalCorrect += correct;
    totalPresent += present;
    totalExpected += expected;
  }

  return {
    truthCount: truthByKey.size,
    rowCount: rows.length,
    precision: rows.length > 0 ? round(correctRows / rows.length) : 0,
    recall: truthByKey.size > 0 ? round(seen.size / truthByKey.size) : 0,
    fieldAccuracy: totalChecked > 0 ? round(totalCorrect / totalChecked) : 0,
    fieldCompleteness: totalExpected > 0 ? round(totalPresent / totalExpected) : 0,
    duplicateRate: rows.length > 0 ? round(duplicates / rows.length) : 0,
    pageCoverage: expectedPages > 0 ? round(Math.min(pagesVisited / expectedPages, 1)) : 0,
    perField,
  };
}

export function summarizeResults(results) {
  const counted = results.filter((result) => result.metrics);
  const mean = {};
  for (const name of ['precision', 'recall', 'fieldAccuracy', 'fieldCompleteness', 'duplicateRate', 'pageCoverage']) {
    const total = counted.reduce((sum, result) => sum + (result.metrics[name] ?? 0), 0);
    mean[name] = counted.length > 0 ? round(total / counted.length) : 0;
  }
  return {
    total: results.length,
    passed: results.filter((result) => result.status === 'PASS').length,
    failed: results.filter((result) => result.status === 'FAIL').length,
    blocked: results.filter((result) => result.status === 'BLOCKED').length,
    mean,
  };
}
