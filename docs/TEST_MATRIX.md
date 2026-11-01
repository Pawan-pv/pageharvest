# PageHarvest Test Matrix

This matrix maps every functional requirement and architectural subsystem to its corresponding test suite, edge-case scenarios, failure modes, and verification commands.

---

## Comprehensive Subsystem Test Matrix

| Subsystem | Requirement ID | Test Suite Path | Scenarios & Edge Cases Covered | Verification Command |
| :--- | :--- | :--- | :--- | :--- |
| **Shared Contracts** | PRD-FR-All | `tests/contracts/canonical-contracts.spec.ts` | - Schema validation with valid & malformed inputs<br>- Discriminated union parsing of `BrowserMessage`<br>- Default fallback values for `PaginationConfig`<br>- Mandatory field checks for `attributeName` & `regexPattern` | `pnpm vitest run tests/contracts/canonical-contracts.spec.ts` |
| **DOM Selector Engine**| PRD-FR-1.4 | `tests/unit/selector.test.ts` | - ID selector generation (`#main-title`)<br>- Multi-class fallback selector generation<br>- Ancestor breadcrumb hierarchy calculation<br>- Handling elements with dynamic or generated classes | `pnpm vitest run tests/unit/selector.test.ts` |
| **DOM Normalization** | PRD-FR-3.4 | `tests/unit/dom.test.ts` | - Stripping redundant whitespace and newline tabs<br>- Empty element text handling (`null`/`""`)<br>- Special character entity decoding (`&amp;`, `&gt;`) | `pnpm vitest run tests/unit/dom.test.ts` |
| **Repeated Element Detection** | PRD-FR-2.1 to 2.4 | `tests/unit/detection.test.ts` | - Finding repeated cards in `<ul>` / `<div>` lists<br>- Table row (`<tr>`) container detection<br>- Structural fingerprint comparison across siblings<br>- Rejection of isolated non-repeating DOM elements | `pnpm vitest run tests/unit/detection.test.ts` |
| **Field Extraction Engine** | PRD-FR-3.4 to 3.5 | `tests/unit/extractor.test.ts` | - Text extractor with whitespace trimming<br>- Attribute extractor (`data-sku`, `alt`, `title`)<br>- Relative to absolute URL conversion (`href`, `src`)<br>- Regex pattern matching with capture group indexing<br>- Price / numeric parsing with currency symbols (`$`, `€`)<br>- Required field absence handling | `pnpm vitest run tests/unit/extractor.test.ts` |
| **Pagination & Navigation** | PRD-FR-4.1 to 4.5 | `tests/unit/navigation.test.ts` | - Next button identification via `rel="next"`<br>- Next button heuristic text search (`Next >`, `Older`)<br>- Detection of disabled next buttons (`disabled`, `aria-disabled`)<br>- Synthetic click event dispatching<br>- Scroll step distance and boundary calculation | `pnpm vitest run tests/unit/navigation.test.ts` |
| **Persistence (Dexie)** | PRD-FR-5.1 to 5.4 | `tests/unit/storage.test.ts` | - Project schema saving and retrieval<br>- Batch record insertion and dataset count updating<br>- Inline cell modification<br>- Single record deletion<br>- Atomic cascade deletion of dataset with records | `pnpm vitest run tests/unit/storage.test.ts` |
| **Data Exporter** | PRD-FR-7.1 to 7.4 | `tests/unit/exporter.test.ts` | - RFC 4180 CSV serialization<br>- Double-quote escaping (`"Value"` $\to$ `"""Value"""`)<br>- Comma and newline preservation inside quoted fields<br>- Semicolon and tab delimiter configurations<br>- UTF-8 Byte Order Mark (`\uFEFF`) insertion<br>- JSON array and NDJSON formatting | `pnpm vitest run tests/unit/exporter.test.ts` |
| **Runtime Messaging** | PRD-FR-1.1, 4.5 | `tests/integration/messaging-lifecycle.test.ts` | - Side panel to content script request-response flow<br>- Disconnected tab error handling<br>- Malformed message rejection | `pnpm vitest run tests/integration` |

---

## Test Failure Resolution Matrix

| Failure Type | Root Cause Indicator | Remediation Steps |
| :--- | :--- | :--- |
| `ZodError` | Payload violates contract definition | Verify payload matches schema in `src/shared/contracts/`. Never modify contracts without architect approval. |
| `NoSuchElement / NullReference` | DOM query selector did not find target node | Check fixture HTML structure or ensure `container.querySelector` uses relative selectors without leading slashes. |
| `StorageTransactionError` | IndexedDB table lock or schema index mismatch | Ensure `fake-indexeddb` is loaded in `tests/setup.ts` and table versions match Dexie definition. |
| `CSV Quoting Error` | Unescaped comma or quotation in output file | Ensure the export engine wraps strings containing quotes, commas, or newlines in double quotes. |
