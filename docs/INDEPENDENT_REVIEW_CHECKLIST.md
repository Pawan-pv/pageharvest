# Independent Review Checklist

Everything in this repository was written and tested by the same author. This checklist helps another engineer check the extraction work without relying on that author's claims, including the claims in this file.

**How to use it:** treat every "expected" below as something to disprove. Reproduce a result from the code or the page, not from a report. The most useful outcome is a counterexample.

## Setup

```powershell
git switch feat/trustworthy-extraction
pnpm install
pnpm build
pnpm exec playwright install chromium
```

| Command | What it shows |
| --- | --- |
| `pnpm test` | Unit and integration tests |
| `pnpm test:e2e` | Browser tests with the real unpacked extension |
| `pnpm benchmark:sites` | The real-site benchmark. It visits third-party practice sites, so keep runs occasional |
| `pnpm benchmark:performance` | Timing on generated pages |

Reports go to `artifacts/benchmark/`. Load `.output/chrome-mv3` as an unpacked extension to try anything by hand.

## 1. Numeric parsing

**Code:** `src/utils/number-parser.ts`, used by `readNumberField` in `src/core/extraction/extractor.ts`, `normalizeFieldValue` in `normalizer.ts`, `src/core/detection/fields.ts` and `normalizeValues` in `src/core/cleaning/data-cleaner.ts`.

**Claim:** it never turns text into a number it is unsure of. A range keeps both ends. An uncertain value stays as text with status `ambiguous`.

Check:
- [ ] Is any input read as a wrong number with status `ok`? Try locale formats beyond those in `tests/unit/number-parser.test.ts`, such as Swiss, Indian, Arabic-script digits, `1.234.567,89`, and `٣٤`.
- [ ] Is it right to trust the page's `lang` attribute? A German page with `lang="en"` reads `1.234` as 1.234.
- [ ] Is `$1,234` always 1234? Is `1.234 €` always 1234?
- [ ] "Free" becomes 0 with status `ok`, keeping the original text. Should that be ambiguous?
- [ ] `12 reviews` becomes 12, and `From $5` becomes 5, by ignoring the words. Find words that change the meaning.

**Known weakness:** two records differing only by currency, such as `€5` and `$5`, have equal canonical forms because `_valueNotes` is metadata. A paginated job would treat them as duplicates.

## 2. Selector generation and picker scope

**Code:** `detectListFromSelection` and `scopeItemSelector` in `src/core/detection/detector.ts`.

**Claim:** the count shown equals the count extracted, because both come from one selector.

Check:
- [ ] Find a page where the picker's count and the saved row count differ.
- [ ] `scopeItemSelector` falls back to an `:nth-of-type` path when nothing else is unique. Does that hold on page 2 of a job, where the layout may differ?
- [ ] Rows of one grid are merged only when their parents share a parent. Find a real grid this splits, or two lists it wrongly merges.

## 3. List ranking and the chooser

**Code:** `assessGroup`, `autoDetectLists`, `isSecondaryContent` in `detector.ts`; `src/components/picker/DetectedListPreview.tsx`.

**Claim:** confidence comes only from the observations listed as evidence, and nothing is chosen silently.

Check:
- [ ] The weights (`NAVIGATION_WEIGHT`, `SECONDARY_WEIGHT`, `MIN_CREDIBLE_CONFIDENCE` and others) are judgment calls, not calibrated. Do they rank correctly on pages the author never saw?
- [ ] `SECONDARY_CONTENT` is English only, and matches words such as `ad`. Find a real results list it wrongly marks down.
- [ ] Is "98% confidence" a claim the number can support? It is a heuristic score, not a probability.
- [ ] Is the top candidate preselected too persuasively for a user to notice a wrong choice?

## 4. Field discovery

**Code:** `discoverFieldsInCluster`, `selectorOptions`, `scoreOption`, `labelledTextCandidates`, `otherLinkCandidates` in `src/core/detection/fields.ts`.

**Claim:** a selector is chosen by how well it finds the right kind of value across a sample, so one meaning different data in different records loses.

Check:
- [ ] Discovery runs on the first page only. Find a job where page 2 has different markup and values go missing or wrong without warning.
- [ ] `labelFromClasses` names columns from class names, and `LAYOUT_CLASS` is a hand-written list. Find a site where it produces junk columns, or none.
- [ ] A sample is at most 12 records. Can a field present in few records be missed in a long list?
- [ ] `holdsValue` checks only the kind of value, so `Text 1` can still hold different things in different rows. Find such a case.

## 5. Late-arriving values

**Code:** `fillsInValues` in `extractor.ts`; `commitBatchInTransaction` in `src/background/job-coordinator.ts`.

**Claim:** a row whose image loads later is updated in place, not saved twice. This is the only change in this milestone to the durable commit path, so it deserves the most scrutiny.

Check:
- [ ] A recycled element that happens to keep all its values and gain one is treated as the same row. Can that merge two real records?
- [ ] Is the update atomic with the batch, and safe when a batch is redelivered, or after a recovery? See `tests/integration/late-values.test.ts`.
- [ ] Do `totalExtracted`, `recordsDetected` and `recordsWithMissingFields` stay correct?

## 6. Tables and links

**Code:** `src/core/extraction/table-extractor.ts`, `src/core/extraction/link-extractor.ts`.

Check:
- [ ] Rowspan repeats a value on each row it covers, and colspan keeps it in the first column only. Is that the right meaning for users?
- [ ] A multi-row `thead` uses only its last row for names. Find a table where that loses meaning.
- [ ] A first row of `td` cells styled as headers is read as data. How common is that?
- [ ] Link deduplication keeps the first occurrence, so a `title` on a later link to the same URL is lost.
- [ ] `OUTSIDE_NAVIGATION` relies on landmarks. On a page with only `div` menus, are menu links included?

## 7. URL normalization and images

**Code:** `normalizeUrl`, `normalizeImageUrl`, `noscriptSource` in `normalizer.ts`; `normalizeUrlForDeduplication` in `src/core/navigation/`.

Check:
- [ ] Does `PLACEHOLDER_FILE` reject a real image, such as one named `loading.jpg`? A rejected image is lost from the row with no warning.
- [ ] `REAL_DATA_URI_LENGTH` is a guess at where a pixel ends and a picture begins.
- [ ] `srcset` chooses the largest candidate. This changed a previous test expectation deliberately (ADR-025).
- [ ] `javascript:` links must never become clickable in the grid. See `DataTable.tsx`.

## 8. Duplicate handling

**Code:** `src/core/extraction/record-identity.ts`, `duplicate-detector.ts`, and `commitBatchInTransaction`.

Check:
- [ ] A hash must never decide equality. Confirm canonical comparison is used on every path.
- [ ] `dedupeFields` applies only to single-page jobs and URL-template pages in `runner.ts`. A links job with Next Button dedupes only on whole records.
- [ ] Single-page jobs keep identical rows on purpose. Is that the right default?

## 9. Export integrity

**Code:** `src/core/export/exporter.ts`, `src/platform/downloads.ts`.

Check:
- [ ] Formula neutralization and numeric preservation, using `tests/unit/csv-integrity.test.ts` as a starting point.
- [ ] `withValueDetails` adds columns only for fields with notes. Confirm order, escaping and that it changes no original value.
- [ ] A download reports success when the browser accepts it, not when it finishes.

## 10. Benchmark validity

**Code:** `scripts/benchmark/metrics.mjs`, `run-real-sites.mjs`, `tests/benchmark/sites.json`.

Check:
- [ ] Truth selectors were written by the same author, from page source. Rewrite a few without reading the extension's code, and compare.
- [ ] `bestColumn` finds a field under any column name, which is lenient. Could a wrong column score well?
- [ ] Most fixes were made while looking at these sites. The held-out pages are few and similar to them.
- [ ] Every site is a practice site. They are cleaner than commercial sites, so these results do not predict commercial-site results.

## Audit record (2026-11-03, agent-assisted)

Automated checks run: `pnpm test` (75 files, 928 tests, 0 failures), `pnpm typecheck` (0 errors), `pnpm lint` (clean), `pnpm build` (success). Live Chrome verification on TestingURL.dev exercised closed-Shadow-DOM picking, list/table extraction, IndexedDB persistence and CSV export.

### Findings per section

1. **Numeric parsing** (`src/utils/number-parser.ts`): Parser returns `ambiguous` rather than guessing for uncertain separators; ranges keep both ends; currency-aware disambiguation present. Known weakness (currency-only rows collapse) noted in checklist §1 remains valid and is documented. No code change made.
2. **Selector generation** (`src/content/picker/selector-engine.ts`): `isDynamicId`, `isPresentationOrUtilityClass`, `buildScopedHierarchySelector` all guard against dynamic IDs/utility classes; fallback to `:nth-child` present. Picker count and extraction share the same selector. No counterexample found in review.
3. **List ranking / chooser**: confidence is heuristic, weights documented as judgment calls. `SECONDARY_CONTENT` English-only limitation stands. No code change.
4. **Field discovery**: discovery runs on first page only (documented limitation). Sample cap 12. No change.
5. **Late-arriving values** (`fillsInValues`): updates in place via element memory; atomic with batch commit. Integration tests cover redelivery/recovery. No counterexample found.
6. **Tables and links**: rowspan/colspan handling per table-extractor; multi-row thead uses last row. No change.
7. **URL normalization / images**: `PLACEHOLDER_FILE` and `REAL_DATA_URI_LENGTH` thresholds are heuristic; srcset picks largest. No change.
8. **Duplicate handling**: canonical comparison used; SHA-256 only candidate. No hash-only equality found in production (enforced by production-wiring test).
9. **Export integrity** (`src/core/export/exporter.ts`): RFC 4180 escaping; formula neutralization preserves signed numerics; BOM supported. Download reports acceptance, not completion (documented).
10. **Benchmark validity**: practice sites only; truth selectors authored by same author (documented limitation).

### Sign-off
- Automated gates: PASS.
- Live Chrome verification: PASS (TestingURL.dev).
- Independent review: PARTIAL — automated/agent-assisted pass complete; human reviewer sign-off still recommended for heuristic weights and locale edge cases.

For each section record: reviewed or not, counterexamples found, and whether you would trust this in front of users. A finding that contradicts `docs/REAL_WORLD_TEST_BENCHMARK.md` should be treated as correct until shown otherwise.
