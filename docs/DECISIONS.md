# Architecture Decision Records (ADRs)

This document tracks all foundational architectural and technical decisions made for **PageHarvest**. Every decision adheres to strict engineering criteria: reliability, local-first privacy, performance, and multi-agent maintainability.

---

## ADR-001: Adoption of Manifest V3 & Chrome Side Panel API

- **Status**: Accepted
- **Context**: Older Chrome extensions utilized Manifest V2 and intrusive popup modals or floating iframes injected into web pages. Manifest V3 is now mandatory for Chrome Web Store extensions.
- **Decision**: Build PageHarvest on Manifest V3 using Chrome's native Side Panel API (`chrome.sidePanel`) and Background Service Worker.
- **Consequences**:
  - *Positive*: Side panel provides persistent, multi-tab workspace without occluding webpage content. No risk of page CSS interfering with extension panels. Full compliance with Chrome Web Store security guidelines.
  - *Negative*: Service worker enters inactive state when idle; requires event-driven awakening and IndexedDB state storage rather than global in-memory state.

---

## ADR-002: WXT Framework as Modern Extension Foundation

- **Status**: Accepted
- **Context**: Building raw multi-entrypoint extensions with manual Vite/Rollup configurations requires bespoke build scripts for manifest generation, content script bundling, HMR, and zip archiving.
- **Decision**: Adopt [WXT](https://wxt.dev/) as the extension bundler and framework foundation.
- **Consequences**:
  - *Positive*: First-class Manifest V3 support, automatic manifest generation, Vite integration, fast development HMR, React module support, and out-of-the-box cross-browser support (Chrome, Edge, Firefox).
  - *Negative*: Minor build tool dependency abstraction; handled by standard npm scripts.

---

## ADR-003: Canonical Type Contracts & Zod Validation at System Boundaries

- **Status**: Accepted
- **Context**: In multi-agent systems, agents frequently invent ad-hoc interfaces (e.g. `RecordData` vs `ExtractedRecord`, `Field` vs `FieldDefinition`), leading to silent runtime breakage when modules integrate.
- **Decision**: All shared contracts are strictly governed by Zod schemas in `src/shared/contracts/` and owned exclusively by Agent 1 (Chief Architect). Every runtime message across Chrome boundaries (SidePanel $\leftrightarrow$ Background $\leftrightarrow$ ContentScript) must parse against `BrowserMessageSchema`.
- **Consequences**:
  - *Positive*: Runtime type validation prevents corrupted data. TypeScript types are automatically inferred via `z.infer`. Zero ambiguity between agents.
  - *Negative*: Negligible runtime parsing overhead (<0.5ms per message).

---

## ADR-004: Shadow DOM for Content Script Visual Picker Overlay

- **Status**: Accepted
- **Context**: Injected content scripts that draw highlight boxes or selector badges often clash with host webpage stylesheets (e.g., Bootstrap, Tailwind, resets, `!important` rules) or alter the page layout.
- **Decision**: All picker overlays, bounding boxes, and badges must be rendered inside a closed Shadow DOM (`attachShadow({ mode: 'closed' })`) rooted at `document.documentElement`.
- **Consequences**:
  - *Positive*: 100% style isolation. Page styles cannot distort picker outlines, and picker styles cannot leak into host DOM.
  - *Negative*: Cannot use external stylesheets directly inside the shadow root without injecting inline `<style>` tags.

---

## ADR-005: Dexie (IndexedDB) for Local-First Persistence

- **Status**: Accepted
- **Context**: `chrome.storage.local` has quota limits (typically 10MB default) and stores serializable JSON without indexing or query capabilities. Large scrapes (5,000+ rows) easily exceed local storage quotas.
- **Decision**: Use Dexie over IndexedDB for all entity storage (Projects, Jobs, Records, Schemas, History). Reserve `chrome.storage.local` only for lightweight user preferences and active session flags.
- **Consequences**:
  - *Positive*: Virtually unlimited storage quota (up to gigabytes depending on disk space), rich indexing, transactional safety, and fast reactive queries.
  - *Negative*: IndexedDB requires asynchronous database operations; handled cleanly via Dexie and React hooks.

---

## ADR-006: Local Structural Similarity Clustering for Pattern Detection

- **Status**: Accepted
- **Context**: Traditional scrapers require users to manually type complex XPath or CSS selectors. Remote computer vision or LLM-based element pickers introduce latency, subscription costs, and privacy hazards.
- **Decision**: Implement a pure local DOM clustering algorithm based on structural fingerprinting (tag sequence, class frequency, ancestor hierarchy) and relative heuristics.
- **Consequences**:
  - *Positive*: Instantaneous detection (<50ms), 100% private, works offline, zero token costs.
  - *Negative*: Edge cases on deeply obfuscated or non-standard DOMs require manual selector tuning fallback.

---

## ADR-007: TanStack Table for Side Panel Data Grid

- **Status**: Accepted
- **Context**: Users need to inspect, sort, filter, and edit harvested data before exporting. Writing a custom spreadsheet grid is error-prone.
- **Decision**: Integrate `@tanstack/react-table` (v8) for headless, high-performance table management in the React side panel.
- **Consequences**:
  - *Positive*: Virtualization-ready, flexible column sorting/filtering, inline editing support, lightweight, accessible.
  - *Negative*: Headless design requires styling table components using Tailwind CSS.

---

## ADR-008: RFC 4180-Compliant Streaming Data Export

- **Status**: Accepted
- **Context**: Naive CSV generation (`row.join(',')`) breaks when values contain commas, quotation marks, or newlines. Exporting large datasets in a single in-memory string can cause browser tab crashes.
- **Decision**: Implement a dedicated RFC 4180 CSV serializer with quote escaping, UTF-8 Byte Order Mark (`\uFEFF`) injection for Excel compatibility, and chunked Blob streaming.
- **Consequences**:
  - *Positive*: Seamless opening in Excel, Numbers, and Google Sheets without encoding issues.
  - *Negative*: Must sanitize filenames across different OS filesystems.

---

## ADR-009: Service Worker State Resilience & Robust Browser Messaging Architecture

- **Status**: Accepted, except item 2. ADR-017 replaces the `chrome.storage.local` snapshot with the durable job lifecycle.
- **Context**: Manifest V3 service workers are ephemeral and will be suspended by Chrome after ~30 seconds of inactivity. In addition, communication between the side panel, service worker, and content scripts can encounter transient disconnections, restricted internal pages (`chrome://`), or duplicate concurrent requests.
- **Decision**:
  1. Build a typed `MessageRouter` and `MessagingClient` layer that validates all messages using canonical Zod schemas, deduplicates concurrent in-flight requests, supports `AbortSignal` cancellation, and handles disconnected receiver errors with retry backoff.
  2. Implement durable extraction job checkpointing (`job-recovery.ts`) in `chrome.storage.local` under `__pageharvest_active_job__`. On service worker restart, suspended extraction state is inspected, recovered, and surfaced to the UI.
  3. Enforce least-privilege permissions (`activeTab`, `scripting`, `sidePanel`, `storage`, `downloads`), sanitize file downloads, and block execution on browser internal URLs.

---

## ADR-010: Deterministic Reusable Extraction Engine & Multi-Type Normalization Pipeline

- **Status**: Accepted, except item 5, which ADR-018 supersedes.
- **Context**: Converting complex website DOM hierarchies into clean, normalized structured records requires deterministic parsing without LLM hallucinations or network latency. Scraped websites exhibit varied markup conventions: missing optional fields, malformed CSS selectors, international currency/price formats (`$129.00`, `129,00 €`, `1 299,50 €`), relative URLs, lazy-loaded images (`srcset`, `data-src`, `data-lazy-src`), and varied date formats. A missing element or malformed selector must never crash the job or corrupt clean records.
- **Decision**:
  1. Implement a unified, reusable `ExtractionEngine` in `src/core/extraction/` adhering to documented input and output contracts (`ExtractionInput` $\to$ `ExtractionOutput`).
  2. Implement comprehensive data normalizers for 10+ data types: Text, Links, Images, Attributes, Prices, Dates, Numeric values, Boolean values, Metadata, HTML, and Regex.
  3. Support full HTML entity decoding (named, decimal `&#...;`, hex `&#x...;`), whitespace/newline collapse, and non-breaking space normalization.
  4. Implement relative URL and image resolution supporting `srcset`, background styles, protocol-relative links, and invalid URI safety filters.
  5. Employ fast FNV-1a 32-bit content hashing for in-memory deduplication, isolating provenance metadata (`_id`, `_page`, `_extractedAt`, `_sourceUrl`, `_hash`) from content hashing.
  6. Provide structured diagnostic error collection (`ExtractionJobError`) and operational statistics (`ExtractionStatistics`) with real-time field coverage tracking.
- **Consequences**:
  - *Positive*: Completely deterministic, local-first execution; parses 1,000 records in sub-second time; missing fields or invalid selectors safely fall back without job abortion; 100% backward compatibility with `extractRecordsFromScope` and `extractFieldValue`.
  - *Negative*: Complex custom site-specific date formats beyond ISO/standard notations may require custom regex extractors.

---

## ADR-011: Content Workflow Coordinator Owns Real DOM Operations

- **Status**: Accepted
- **Context**: The side panel already dispatched typed detection and extraction requests, but the content entrypoint only handled `PING` and picker lifecycle messages. The UI also contained synthetic lists, fields, records, and URLs for disconnected-tab fallbacks.
- **Decision**: Keep DOM-dependent work in a content-script coordinator that calls the existing local detection, extraction, and navigation engines. It emits validated progress/results back through `chrome.runtime.sendMessage`; communication errors become structured error states and never become fabricated data.
- **Consequences**:
  - *Positive*: The extension’s user-visible workflow now uses the live page DOM and preserves the local-first privacy boundary.
  - *Negative*: Browser-context failures are visible to the user and require a refresh/retry instead of silently showing a demo result.

## ADR-012: Preserve Least-Privilege Tab Access in Browser Tests

- **Status**: Accepted
- **Context**: A directly opened extension page in Playwright cannot always read the active tab URL with only `activeTab`; adding persistent `tabs` permission would broaden access solely to accommodate that harness.
- **Decision**: Keep `activeTab` as the production permission. When Chrome redacts URL/title fields from a directly opened extension document, recover the metadata from the already-loaded content script's typed `PING` response; do not add broad `tabs` permission. Native side-panel user-gesture coverage remains a follow-up item.
- **Consequences**:
  - *Positive*: The manifest stays least-privilege aligned while browser tests still exercise the real content script and DOM.
  - *Negative*: The E2E harness still does not reproduce the exact action-click/native-side-panel activation sequence.

## ADR-013: Durable URL Pagination Handoff Across Documents

- **Status**: Superseded by ADR-016 and ADR-017. The handoff design remains; sessions moved from `chrome.storage.local` into IndexedDB, and they no longer hold records.
- **Context**: A full-page URL navigation unloads the content script and cannot leave an in-memory extraction engine waiting for the next document. The existing generic navigation engine therefore could not safely resume URL-template jobs.
- **Decision**: Store a URL-pagination session in `chrome.storage.local` before navigation. The checkpoint contains the canonical recipe and fields, job/project/dataset identifiers, completed records, seen hashes, current page, counters, terminal status, and expected next URL. A new content script emits `URL_PAGINATION_READY`; the service worker validates the URL and sends the next typed extraction request. Terminal sessions are idempotent, and unexpected or failed navigation transitions the session to `failed`.
- **Consequences**:
  - *Positive*: Page reloads and service-worker store recreation do not lose the extraction configuration or collected records; duplicate pages are rejected deterministically.
  - *Negative*: The native toolbar/user-gesture side-panel sequence still requires headed Chrome manual verification because Playwright cannot reliably drive browser chrome.

## ADR-014: Side-Panel Route-Level Code Splitting

- **Status**: Accepted
- **Context**: The initial side-panel chunk exceeded the Rollup 500 KB warning threshold because the data grid, export surface, history, and settings views were eagerly imported by the shell.
- **Decision**: Lazy-load the results grid, history, and settings views behind `Suspense` boundaries. Keep the dashboard and extraction workflow in the initial shell.
- **Consequences**:
  - *Positive*: Initial side-panel JavaScript decreased from approximately 580 KB to 471 KB without removing functionality; the grid is isolated in a 97 KB chunk.
  - *Negative*: First navigation to a lazy view performs one local extension chunk fetch and displays a short loading fallback.

## ADR-015: Layered Automated Release Verification

- **Status**: Accepted
- **Context**: Unit and integration suites prove local algorithms, but release confidence also requires the production MV3 artifact to run inside a real Chromium profile and the native toolbar gesture to be distinguished from direct extension-page navigation.
- **Decision**: Add a release runner with three explicit layers: deterministic unit/static checks, headed Playwright tests that load `.output/chrome-mv3` into a temporary profile and exercise real fixture workflows, and a Windows native-Chrome probe that launches an isolated profile, confirms the unpacked extension loads, and reports `BLOCKED` unless a configured desktop UI backend can genuinely click the browser action. Every run emits JSON and Markdown reports plus command/browser diagnostics.
- **Consequences**:
  - *Positive*: One command produces auditable release evidence, preserves failure artifacts, and prevents a direct side-panel page test from being misreported as native toolbar coverage.
  - *Negative*: The complete gate can legitimately exit `3` when the host lacks pywinauto/AutoHotkey; manual or desktop-driver verification remains necessary for the browser-chrome gesture.

## ADR-016: Background-Owned Durable Persistence

- **Status**: Accepted
- **Context**: Extracted rows were written by a React hook in the side panel, so closing the panel lost rows. Records were tagged only with what the panel remembered, and the content script could not write them itself, because a content script's IndexedDB belongs to the page.
- **Decision**: The background `JobCoordinator` is the only writer of extraction data. Content scripts send `RECORD_BATCH` and wait for an acknowledgement, which is only sent after the IndexedDB transaction resolves. Rows, job counters and the checkpoint commit together. The side panel sends commands and reads from storage.
- **Consequences**:
  - *Positive*: An acknowledged record survives a closed panel, closed tab, worker restart and browser restart. The panel can open and close at any time.
  - *Negative*: Each batch round-trips through the worker, so extraction waits on storage. This is deliberate backpressure.

## ADR-017: One Job Lifecycle, Enforced by the State Machine

- **Status**: Accepted
- **Context**: Three unconnected models existed: `ExtractionStateMachine` (used only by tests), lower-case `JobStatus`, and UI-only statuses. `persistJobState` had no callers, so the recovery banner could not appear. `UrlPaginationSession` kept every row in `chrome.storage.local`, was never read back, and was never deleted.
- **Decision**: `JobStatus` is the lifecycle: CREATED, RUNNING, PAUSED, INTERRUPTED, RECOVERABLE, COMPLETED, CANCELLED, FAILED, EXPIRED. `ExtractionStateMachine` owns the transitions, and the coordinator applies them inside the transaction that persists them. A `checkpoints` table holds resumable state and is deleted with the transition to any terminal state. `job-recovery.ts` and `url-pagination-session.ts` are removed. UI inspection states are not job states; they stay in the panel's `view`.
- **Consequences**:
  - *Positive*: Illegal transitions cannot reach storage. Recovery is one path for every pagination type. The banner shows only for a job that can really resume.
  - *Negative*: A recovered infinite-scroll job has to scroll back through known rows, because the feed reloads from the top.

## ADR-018: Canonical Record Identity with SHA-256 Fingerprints

- **Status**: Accepted
- **Context**: Deduplication compared 32-bit FNV-1a hashes and nothing else, which silently dropped real rows: "Product 1079599" and "Product 1262382" collide. Values were also lower-cased, merging variants like "SKU-aB3" and "SKU-Ab3". Signatures joined pairs with `|`, so values could imitate separators.
- **Decision**: Identity is the canonical record (see `record-identity.ts` for the rules). SHA-256 only narrows which stored rows to compare, and a row is a duplicate only if its canonical form is equal. Within a page run, an exact signature set is used with no hash at all. Single-page jobs do not deduplicate unless recovering, because each matched element is its own row.
- **Consequences**:
  - *Positive*: A collision cannot remove a distinct record.
  - *Negative*: This is a deliberate behavior change: rows differing only by letter case are now distinct. Deduplicating a resumed single-page job compares against stored rows, so identical rows on that page collapse in that one case.

## ADR-019: One Runtime Message Protocol

- **Status**: Accepted
- **Context**: `BrowserMessage` in `src/shared/contracts` was documented as canonical but never used at runtime, while `ExtensionMessage` in `src/contracts` was used with different names. `MessagingClient`, which has timeouts, retries and validation, was used only by tests.
- **Decision**: `src/shared/contracts/message.ts` now defines the protocol the extension actually speaks, and `src/contracts/messages.ts` only re-exports it. All sends go through `MessagingClient`. The picker's hover, confirm and cancel messages were being dropped because they were not in the protocol; they are now defined, and cancel returns the panel to the dashboard.
- **Consequences**:
  - *Positive*: One protocol, validated at every boundary.
  - *Negative*: Older `BrowserMessage` variant names are gone.

## ADR-020: Module Decisions After the Wiring Audit

- **Status**: Accepted
- **Context**: Several modules were reached only by tests.
- **Decision**:

| Module | Decision | Now |
| :--- | :--- | :--- |
| `MessagingClient` | Wired | All panel, content and background sends |
| `ExtractionStateMachine` | Wired, reworked to the lifecycle | Every job transition |
| `error-reporter` | Wired | Coordinator and content workflow errors, persisted on jobs |
| `storage/repositories` | Wired, completed | All production storage access |
| `platform/downloads` | Wired | All exports; the duplicate in `exporter.ts` is removed |
| `platform/permissions` | Wired | Checked before a job starts; `requestPermission` removed, because every permission is required in the manifest and nothing could call it |
| `navigation/runner` | Wired, reworked | `runNavigationJob` runs every job; step helpers with no caller are removed, and their behavior is tested through the engine |
| `TabManager` | Wired | Tab close and load detection in the worker |
| `ExtractionEngine` | Wired | Single-page and URL-template extraction, sharing one loop with the engine path |
| `DuplicateDetector` | Wired | The in-run signature check |
| `job-recovery`, `url-pagination-session` | Removed | Replaced by ADR-017 |
| `EXECUTE_PAGINATION_STEP`, `EXECUTE_SCROLL_STEP` | Removed | Nothing sent them |
| `theme`, `autoCleanOnExtract` settings | Removed | Nothing read them |

- **Consequences**: `tests/integration/production-wiring.test.ts` walks the import graph from the entry points and fails if a source module is unreachable.

## ADR-021: Value-Aware CSV Formula Protection

- **Status**: Accepted
- **Context**: Every value starting with `-` or `+` was prefixed, so `-5` was written as `' -5`, which corrupts data. Leading whitespace also bypassed the check.
- **Decision**: Numbers and booleans are never prefixed. Text is prefixed only when it is formula-like, and signed numeric text is treated as data. Leading whitespace no longer bypasses the check. The prefix stays `' `.
- **Consequences**:
  - *Positive*: Numeric columns export unchanged, and anything able to reference a cell or run a command is neutralized.
  - *Negative*: Text like `-2+3` is prefixed even though it only does arithmetic, because it contains an operator after the first character.

## ADR-022: Closed Shadow Root for the Picker Overlay

- **Status**: Accepted
- **Context**: ADR-004 required a closed root but the code used an open one, and the page could reach into the overlay through `host.shadowRoot`.
- **Decision**: The overlay attaches a closed root and keeps the only reference in a private field, with no global or attribute exposing it. Browser tests use the keyboard and on-screen coordinates, using CDP to locate buttons. Unit tests observe `attachShadow` from the test side to check what renders.
- **Consequences**: Page scripts cannot read or change the overlay. A leftover host cannot be reused, so each attach creates a new one.

## ADR-023: Auto-Detect Ranks by Record Content

- **Status**: Accepted
- **Context**: A trial on real sites stored navigation links with status COMPLETED, while every fixture test passed. Lists were ranked by confidence times size, so a 50-link sidebar beat 20 products. Only containers with list-like class names were scanned, so plain `div.quote` items were never considered. A `ul > li` selector also matched the site menu.
- **Decision**: Every parent with repeated children is a candidate. The score weighs confidence and size against field variety, and reduces it for link-only items, navigation regions, and items that wrap another list. Outside list-like containers a list needs three items. The selector is narrowed until it matches exactly the chosen items. Items with no recognized text offer their text elements as columns, and a `title` attribute that extends the visible text is preferred, because sites shorten long titles on screen.
- **Consequences**: `detectListFromSelection`, used by the picker, is unchanged. Navigation is still listed as a lower-ranked candidate. Fixtures must include the surroundings of real pages: `tests/unit/detection-real-pages.test.ts` follows real page layouts.

## ADR-024: Verify the Native Side Panel by Clicking the Real Toolbar

- **Status**: Accepted
- **Context**: Playwright cannot click browser chrome, so its tests open `sidepanel.html` in a tab, and that does not prove the toolbar works. The native check meant to cover this had no way to pass, and the report stayed BLOCKED.
- **Decision**: A `windows-latest` job clicks the extension in the real toolbar with pywinauto, finding controls by name. A pass needs the browser to report a `SIDE_PANEL` context, 20 rows saved through that panel, and the rows still present after closing and reopening it from the toolbar. Neither `chrome.sidePanel.open()` nor opening the page in a tab is used. The job runs Chrome for Testing, because branded Chrome did not load the unpacked extension. A step with no evidence fails, and BLOCKED fails the job. The Linux job uses a new `automated` scope.
- **Consequences**: A green run means the toolbar was verified, in Chrome for Testing. Branded Chrome stays a manual check. The job only works on machines with a desktop, and Windows minutes count double on a private repository.

## ADR-025: One Number Parser That Never Guesses

- **Status**: Accepted
- **Context**: Extraction used `normalizeNumber`, while field samples and the Normalize tool used `parseNumberValue`, and both silently produced wrong numbers: `1.234.567` became 1.234, a Unicode minus was lost, and `49,99 €` became 4999 in the Normalize tool.
- **Decision**: `src/utils/number-parser.ts` serves every path. A value is read as a number only if its format, currency or the page's `lang` settles it. Otherwise the status is `ambiguous`, both readings are returned, and the cell keeps its text. Ranges keep both ends and keep their text as the cell value. Each row stores how its numbers were read in `_valueNotes`, which can be exported as extra columns.
- **Consequences**: Contract addition: `_valueNotes` on records. A price column can now hold text as well as numbers, and the grid says how many values need a look. A `srcset` now resolves to its largest candidate instead of its first, which changed one earlier test expectation deliberately. Known gap: currency is metadata, so `€5` and `$5` have equal canonical forms.

## ADR-026: Discover Fields From Many Records

- **Status**: Accepted
- **Context**: Fields came from the first record only, so a column missing there was never offered, and positional selectors could read different data in different records.
- **Decision**: `discoverFieldsInCluster` samples up to 12 records, including the first and last, and merges what it finds. For each field it tries several selectors and keeps the one with the most correct values and fewest conflicts across the sample. An element belongs to the fields that recognized it, so a badge on one record can't claim another record's price. Values known only by a class name become columns named after that class, and a card's other links become columns named after their text if they recur. Coverage and confidence are recorded on the field, and a rare field is offered but not selected.
- **Consequences**: Contract additions: `discovery` on fields, and the `table_cell` and `link_text` extractors. More columns are offered than before. Naming from class names is a heuristic with a hand-written list of layout classes. Discovery still looks only at the page it starts on.

## ADR-027: Rank Lists on Recorded Evidence and Let the User Choose

- **Status**: Accepted
- **Context**: Auto-detect silently took its first result, and gave a blog menu 88% confidence because that score only measured how alike the items were.
- **Decision**: Confidence starts from structural similarity and is adjusted by observations, each recorded as evidence: how many consistent values items have, whether they are only links, whether they sit in navigation, whether they are labelled as promotions, and whether they are in the main content. The chooser shows up to eight candidates with samples, columns, confidence and evidence. A list in navigation, or below a minimum score, is not credible. If nothing is credible the panel says so, and continuing takes a deliberate click. Extract Tables and Extract Links produce candidates through the same chooser, and the picker's selector is narrowed until it matches exactly the chosen items.
- **Consequences**: Contract addition: `candidates` and `credible` on `REPEATED_ELEMENTS_DETECTED`, and `kind` on `DETECT_FIELDS`. The weights are judgment calls, not calibrated, and the label vocabulary is English. The score is a heuristic, not a probability.

## ADR-028: A Value That Arrives Late Updates Its Row

- **Status**: Accepted
- **Context**: On an infinite-scroll job, a row read before its image loaded was saved again once it had, leaving two rows for one record.
- **Decision**: When an element is read again and has only gained values, the new record carries `_supersedes` with the earlier canonical form. In the batch's transaction, the coordinator finds that row by hash, confirms it by canonical comparison, and replaces it in place, keeping its order. If it isn't found, the record is added normally, so nothing is lost. A changed value is treated as new content, as a recycled row is. The marker is never stored.
- **Consequences**: This is the only change to the durable commit path in this milestone. It is covered by `tests/integration/late-values.test.ts`, and listed for independent review.

## ADR-029: The Running Record Total Travels With Each Document

- **Status**: Accepted
- **Context**: The neon scan overlay's HUD counter lives in the page. On a Next Button or URL job each new document mounts a fresh overlay, so a two-page run of 6 rows ended showing `3 rows`. Real-Chromium E2E (`tests/e2e/neon-overlays.spec.ts`) proved it. The stored data was always correct; only the display was wrong.
- **Decision**: `JobResumeState` gains `recordsExtracted`, the job's committed `totalExtracted` at the moment the background starts a document. The content script starts the HUD from it, and adds only acknowledged inserts, as before. It defaults to 0, so a message without it still parses.
- **Consequences**: Contract addition, display-only: nothing in the commit path reads it, and the background stays the only source of the number. Covered by `tests/unit/messages.test.ts`, `tests/integration/job-pagination.test.ts`, `tests/integration/extraction-overlay-wiring.test.ts` and the E2E spec.

## ADR-030: Read-Only Field Preview (PREVIEW_FIELDS)

- **Status**: Accepted
- **Context**: While editing columns, the user needs to see the values each column will collect. Detection reports each item's text but no per-column values, and the only message that runs field extraction, `EXTRACT_RECORDS`, starts a job and writes rows.
- **Decision**:
  1. Contract addition: `PREVIEW_FIELDS` (side panel to content script) with `containerSelector`, `fields` (1 to 50 `ExtractionField`s) and `limit` (1 to `PREVIEW_ROW_LIMIT`, 5). The reply is `FieldPreviewResult`: `{ ok: true, rows, matchCount }`, where each cell is a string, number, boolean or null, or `{ ok: false, code, message }` with an `ExtractionErrorCode`.
  2. Strictly read-only. The content script queries the DOM and runs the extraction engine, which only reads. It stores nothing, sends no other message, and changes no job. Required columns are not applied, so the preview shows every item.
  3. Refused while a job is active in that tab: by the content script when it has a run, and by the panel when the job it follows is active in that tab (`VALIDATION_ERROR`, with a message written for the user).
  4. A selector that is not valid CSS is `VALIDATION_ERROR`; one that no longer matches anything is `CONTAINER_NOT_FOUND` ("The list is no longer on this page").
  5. The panel gives up after 4 seconds, with no retry, and reports `TAB_DISCONNECTED`. The request is validated before it is sent and by the content router; the reply is validated before it leaves the page and again by the panel, and a reply that fails is `UNKNOWN_ERROR`, never rows.
  6. The panel asks after a 300 ms pause in editing, and ignores an answer that arrives after a newer request. If the preview fails it says why and falls back to the detection sample.
  7. `containerAnchor` (optional) carries the list's backup ladder, which detection builds with `buildContainerAnchor` (added in `cfd5115`; no ADR covers the anchor ladder yet). When the saved selector matches nothing, the content script tries `recoverContainerItems`: the class backup, then the structural fingerprint. Rows found that way come back with `usedFallback: true`. Extraction uses only the saved selector today, so the panel labels those rows "Found with a backup", says the page layout changed and that a run would not find the list yet, blocks Start extraction, and offers "Pick the list again". Nothing is healed or written back: no IndexedDB write, no recipe change, no message to the background.
- **Consequences**: The background is not involved, so a preview cannot reach storage. A large list is extracted in full and then cut to five rows; extraction of 1,000 items is sub-second. Covered by `tests/integration/preview-fields.test.ts` and `tests/unit/ui/field-preview-live.test.tsx`.

## ADR-031: Error Codes Reach the Side Panel

- **Status**: Accepted
- **Context**: The side panel must explain every error in plain words: what happened, whether data is safe, and what to do. Choosing that explanation by reading message text is fragile, so it is chosen by `ExtractionErrorCode`. But no runtime path carried a code: `HarvestError` had only a `category`, `JOB_FAILED` sent a category, and `useExtractionWorkflow` flattened every error to a string.
- **Decision**:
  1. Contract addition: optional `code: ExtractionErrorCode` on `HarvestError` and on the `JOB_FAILED` payload. Optional, so stored errors and older messages still parse.
  2. `ErrorReporter.report` takes an optional `code` and otherwise derives one from the category. A category maps to a specific code only when every error in it means that one thing: `STORAGE_FAILED` is `STORAGE_ERROR`, `RUNTIME_MESSAGING` is `TAB_DISCONNECTED`, `SELECTOR_NOT_FOUND` is `CONTAINER_NOT_FOUND`; the rest are `UNKNOWN_ERROR`.
  3. `NavigationJobError` carries a code set where it is thrown: an invalid selector or URL template, an off-site or repeated page URL are `VALIDATION_ERROR`; a next page that could not be reached is `PAGINATION_TIMEOUT`. The content workflow reports it and sends it in `JOB_FAILED`; the coordinator stores it on the job and broadcasts it in `EXTRACTION_ERROR`. The message router's fallback errors are `UNKNOWN_ERROR`.
  4. `useExtractionWorkflow` exposes `operationError` as `{ message, code? }`, and `ExtractionStats.errorCode` is the code of the job's latest error. An error stored before this ADR has no code; the panel gives it the default for its category, the one the reporter would assign today (`tests/integration/legacy-error-records.test.tsx`). The panel's own setup checks use `VALIDATION_ERROR`.
  5. `VALIDATION_ERROR` means the user's own setup is invalid, and its message is written for the user, so the panel shows that message as the explanation. Internal data that fails validation is `UNKNOWN_ERROR`. For every other code the message stays behind "Technical details".
- **Consequences**: Errors without a precise code still get the generic explanation, which is honest but less helpful; adding a code at a throw site improves it without touching the panel. `DOM_PARSING` errors, which cover most detection failures, are `UNKNOWN_ERROR` until those sites name a code. Covered by `tests/unit/error-codes.test.tsx`.

## ADR-032: Side Panel Design Tokens, Shared Components and In-App Guide

- **Status**: Accepted
- **Context**: A first-time user should get from install to a CSV in under two minutes without help. The panel had no design tokens, no dark mode, Tailwind 4 class names that Tailwind 3 never generated, one long configuration screen, raw status codes, and no help of any kind.
- **Decision**:
  1. Colours, radii, spacing and the smallest type size are defined once in `tailwind.config.js`. Each colour is a CSS variable with a light value and a `prefers-color-scheme: dark` value, so components follow the system theme without `dark:` variants. `tests/unit/ui/design-tokens.test.ts` holds every text and UI pair to WCAG AA in both themes and keeps raw palette classes out of the UI code.
  2. One component set in `src/components/common/`: Button, IconButton (a label is required), Card, Banner (what happened, whether data is safe, what to do), Stepper, Tooltip and HelpTip, Dialog (focus trap and return), Disclosure, and EmptyState (an action decision is required).
  3. The flow is five steps: pick data, review fields, pagination (optional), run, export. The stepper is derived from the workflow view; Review fields and Pagination are halves of one view, chosen by panel state. Each flow names its first step instead of hiding steps.
  4. Errors are explained by `ExtractionErrorCode` only (ADR-031). Recovery says how many rows are saved, and Discard asks first.
  5. The guide ships inside the extension: a five-step first-run tour, a searchable Help screen, and `?` tips whose ids are typed keys into the guide. Whether the tour was seen is a preference in `chrome.storage.local` (ADR-005), never IndexedDB; if local storage fails the tour shows at most once per browser session. The Help screen links to a public practice site and fetches nothing.
  6. The picker, list, field and progress screens, Help and the tour are lazy chunks (ADR-014). On `main` the flow screens were eager and the side panel chunk passed Rollup's 500 kB warning; it is now about 477 kB.
  7. The picker overlay keeps its closed root (ADR-022) and gains reduced motion, focus rings and AA button contrast.
- **Consequences**: `useExtractionWorkflow` gained `moveField`, panel state only, so column order is the export order. The tour would open over App tests, so the test setup marks it seen; the tour's own tests clear the flag. Tests give lazy views 5s per wait and 15s per test. Detection results are ranked candidate cards built on ADR-027's evidence: a plain reason, sample rows, column count and a confidence label, with the evidence behind Technical details. Columns in the preview follow every edit, and cell values come from `PREVIEW_FIELDS` (ADR-030).

## ADR-033: A Client-Side Route Is Not a Failed Page Load

- **Status**: Accepted
- **Context**: Before a Next click the content script commits a checkpoint with `awaitingNavigation`, because the click may destroy its document. When the tab then reports `complete`, the background waits `pageLoadGraceMs` and, if the checkpoint still says it is waiting, interrupts the job as "failed to load". On a site that changes its address with `pushState` (a client-side route) the document survives and keeps running, but if a `complete` event arrives before its next checkpoint, the job was interrupted while it was working. Real-Chromium E2E (`extraction-accuracy.spec.ts`, pages that change without a reload) hit it intermittently.
- **Decision**: `checkPendingNavigation` asks the tab with `QUERY_JOB_RUN` before interrupting, as reconciliation already does. If the page answers that it is running this job with the same generation, and the job has not moved on since, nothing failed and the job is left alone; its next checkpoint clears the flag. No answer, an idle page, or another run means the load really failed, and the job is interrupted as before.
- **Consequences**: One extra tab message on a rare path. A real failed navigation is still caught, because a document that is gone cannot answer. Covered by `tests/integration/client-side-navigation.test.ts`. The test harness now refuses sends from a document it has replaced, as a browser does, which removed a race in `job-pagination.test.ts` where jsdom kept a replaced page running.

## ADR-034: No `scripting` Permission

- **Status**: Superseded by ADR-037
- **Context**: The manifest requested `scripting`, and `src/platform/permissions.ts` required it before a job could start, but no production code calls `chrome.scripting`. The content script is declared in the manifest (`entrypoints/content.ts`, `<all_urls>`), so Chrome injects it on every page load, which is what multi-page jobs and recovery rely on. The Chrome Web Store rejects items that request permissions they do not use.
- **Decision**: Remove `scripting` from the manifest and from `REQUIRED_PERMISSIONS`. `tests/unit/manifest-assets.test.ts` now holds the two lists equal and keeps `scripting` out.
- **Consequences**: No change to what users are asked to grant: `scripting` shows no install warning. `wxt dev` still works, because WXT adds `scripting` and `tabs` to the development manifest on its own. If a future feature injects scripts programmatically, it must add the permission back with its first caller.

## ADR-035: Zod 4

- **Status**: Accepted
- **Context**: `zod@3.25.76` was the only shipped dependency with a known vulnerability: GHSA-mrhx-c7xc-m3w5 (high), where an array schema records an issue for every failing element with no limit, so a large invalid array can exhaust memory. Every release below 4.6.6 is affected, including all of Zod 3, which receives no further fixes.
- **Decision**: Upgrade to `zod@^4.6.7` and keep every contract's parsed output identical. Zod 4 changed when defaults apply, and three contracts would have changed silently, with no type error:
  1. `regexGroup` and `tags` were `.default(x).optional()`. In Zod 3 the outer `optional` returned before the default ran, so absent stayed absent; Zod 4 would write `0` and `[]`. The dead `.default()` is removed.
  2. A schema's `pagination` default lists five fields, and Zod 3 parsed it, so the schema's own defaults filled the rest. Zod 4 returns a default unparsed; `.prefault()` keeps the old behavior.
  3. One-argument `z.record(v)` is now `z.record(z.string(), v)`, and `ZodError.errors` is now `.issues`.
  `tests/contracts/zod-parity.test.ts` records these behaviors. It passed on Zod 3, failed in exactly the three places above on Zod 4 before the fix, and passes now.
- **Consequences**:
  - **Size.** Zod 4's chainable API attaches every format check to every schema, so it does not tree-shake as well. Measured on the same commit: the side panel chunk grew from 482.5 kB to 526.5 kB and the content script from 225.5 kB to 266.8 kB. The panel is now over the 500 kB Rollup default that ADR-014 aimed for, and under the 550 kB limit set in `wxt.config.ts`. Both load from the extension package, not the network. `zod/mini` would recover most of this, at the cost of rewriting every contract in its functional style.
  - **URLs.** `z.string().url()` accepts the same addresses (both use the platform `URL` parser), but now trims surrounding whitespace and removes tabs and line breaks from the parsed value. Addresses here come from `location.href`, which has neither.
  - **What the fix covers.** Zod 4.6.6 rejects an over-long array at once only when the schema declares `.max()`. `RECORD_BATCH.records` has no maximum, because one batch is one page's records. That array is built by the extension's own extractor, and a page cannot send messages into the extension (there is no `externally_connectable`, `onMessageExternal` or `window` message listener), so a page cannot supply the many invalid elements the attack needs.

## ADR-036: The Side Panel Survives a Render Error

- **Status**: Accepted
- **Context**: The panel had no React error boundary. React answers an error thrown while rendering by unmounting the whole tree, so any such bug left an empty panel with no way back but closing it. One cause is not a bug at all: Chrome can update the extension while a panel is open, and the open panel then asks for lazy chunks (ADR-014) whose names no longer exist.
- **Decision**: `PanelErrorBoundary` (`src/components/shell/`) wraps `App` in `entrypoints/sidepanel/main.tsx`. It shows a danger `Banner` (ADR-032): what happened, that saved rows are safe, a **Reload panel** button, and the message under Technical details. A failed dynamic import is worded as an update rather than a fault. The error goes to `errorReporter` with severity `FATAL` and the component stack, and stays in memory; nothing is sent anywhere.
- **Consequences**: Jobs and saved rows belong to the background (ADR-016), so reloading the panel loses neither. Errors in event handlers and promises are not render errors, and are still handled where they occur. Covered by `tests/unit/ui/panel-error-boundary.test.tsx`.

## ADR-037: On-Demand Content-Script Injection via `scripting` + Optional Host Permissions

- **Status**: Accepted. Its permission model (optional per-site grants) is superseded by ADR-040; on-demand injection stands.
- **Context**: The static `content_scripts` entry (`<all_urls>`) forced the "Read and change your data on all websites" install warning, even though most users only ever extract from a handful of sites. Chrome's documented alternative is `chrome.scripting.executeScript` with the `scripting` permission plus per-site host grants: `activeTab` gives temporary access after a toolbar click with no install warning, and `optional_host_permissions` lets the extension request one site's origin at a time from a user gesture (Chrome prompts "this site", never "all sites").
- **Decision**: Remove the static entry by registering the content script at runtime (`registration: 'runtime'` in `entrypoints/content.ts`, a WXT built-in option — no hand-removed `matches`). Add `scripting` to required `permissions` and `optional_host_permissions: ["http://*/*", "https://*/*"]` so any site's origin can be requested as `https://host/*`. Picking/detection/preview inject under the `activeTab` grant (no prompt); starting any job (including single-page and recipe runs) first requests a persistent origin grant with `chrome.permissions.request` as the first await in the Start click, before any messaging round trip. Resume from the recovery banner requests the job's origin the same way (Chrome answers at once, with no prompt, when it is already granted). The background only checks (`permissions.contains`) and injects (`executeScript`, idempotent via `__PAGEHARVEST_INJECTED__`): on every `tabs.onUpdated` "complete" in an active job's tab (running or paused, expected navigation or not) the coordinator probes the document (`executeScript` with a `func` that reads the flag and `location.href`) and injects only when the script is missing; only a document that is new to the script goes to `handleContentReady`, which keeps deciding continue / park / interrupt as it did for the static script. The content script no longer sends `CONTENT_READY` on startup (the background router still accepts the message and passes it to `handleContentReady`, but the current script never sends it): the script is now often injected into the page a job is already running on (at Start, on resume, before a retried `EXTRACT_RECORDS`), where a self-announcement would read as a reload and interrupt the job, or send a Next-button job to the same page twice. The `CONTENT_READY` schema stays in the contracts, unused. The toolbar button is handled in the background (`src/background/toolbar-action.ts`: `openPanelOnActionClick: false`, `action.onClicked` → `sidePanel.open`), because Chrome's own open-on-click does not grant `activeTab`, which left the panel unable to see the page; a click that invokes the action does. When Chrome hides the active tab's address (no grant for it yet), the panel shows **Access needed** and asks for a click on the toolbar button, instead of calling the page restricted, and re-checks every 2 s until the address appears. A load that cannot be scripted on a granted site interrupts a running job that was not expecting navigation (the tab left the site or shows an error page); a missing grant interrupts with `SITE_PERMISSION_REQUIRED`. `permissions.onRemoved` moves active jobs on that origin to RECOVERABLE with that code, and the recovery banner then reads **Allow access and resume**. Restricted pages are checked before the grant, so they keep their own message. `TAB_DISCONNECTED` keeps its meaning; revoked/missing access is `SITE_PERMISSION_REQUIRED` only. The one wording is `SITE_PERMISSION_MESSAGE` in `src/platform/permissions.ts`; `requestSiteOrigin` and `hasHostAccess` return false instead of throwing.
- **Consequences**: Install shows no host warning. First use via the toolbar button injects without a prompt; starting a job persists the grant so later pages, resume after tab close, and restart resume work without relying on `activeTab` surviving navigation. `manifest-assets.test.ts` asserts the built manifest (no `content_scripts` entries, no `host_permissions`, no `<all_urls>`, `optional_host_permissions` exactly as above). Covered by unit, integration (`tests/integration/site-permission.test.ts`, chrome mock + production wiring), and `tests/e2e/site-permission.spec.ts`. Playwright cannot answer Chrome's permission bubble, so every E2E spec, the native-Chrome release check and the real-site benchmark load a copy of the production build whose manifest also grants the sites they visit as `host_permissions` (`scripts/testing/test-extension.mjs`, `.output/chrome-mv3-test`); the production build is never modified. Manual checks: the prompt and its wording, revoking a site in `chrome://extensions`, and the toolbar click granting `activeTab` while the panel is open. The chrome mock passes its permission implementations to `vi.fn(impl)` so `vi.restoreAllMocks()` in a test file does not leave `permissions.contains` returning undefined.

## ADR-038: A Scan Overlay That Shows Harvesting, Not Just Activity

- **Status**: Accepted
- **Context**: The scan overlay (`src/content/extraction-visual-overlay.ts`) showed a 3 px rail, flat boxes that each swept on a loop, and a pill reading "⚡ Harvesting • 20 rows ✓ Harvest Complete!" at the end, which says it is harvesting and finished at once. Labels such as "Scanning DOM..." were developer wording, and "1 rows" was ungrammatical.
- **Decision**: Keep the host, closed root, class names, timings and API, and change what is drawn. While running: a travelling highlight on the top rail, a soft scan beam sweeping down the viewport (faster for scrolling and page changes, via `data-action` on the root), and a breathing glow on the viewport edge. Per committed batch: boxes that lock on with corner brackets, one light sweep and a popping `✓ #n` badge, plus a spark per item that arcs into the HUD (horizontal and vertical motion on two elements), and a bump of the counter. The HUD is a card with a spinning ring, the step in small capitals ("Reading the page…", "Scrolling for more…", "Opening the next page…") and the count ("⚡ Harvesting • 1 row"). On completion the card turns green with a check in the ring, a ripple and a particle burst, the edge glow flashes green, and the text reads "Harvest complete" / "20 rows saved". Only transform and opacity animate, except the rail's background shimmer, and opacity is never set in a box keyframe's last frame, so the scheduled fade still works. Reduced motion keeps every state and hides the beam, sparks, burst and comet.
- **Consequences**: The contrast rules for boxes, badges and the HUD (`tests/unit/neon-overlay-accessibility.test.ts`) are unchanged and still pass. The content script grew by about 11 kB, almost all of it the stylesheet string, to about 278 kB against a 280 kB budget. Covered by `tests/unit/extraction-visual-overlay.test.ts`, `tests/integration/extraction-overlay-wiring.test.ts` and `tests/e2e/neon-overlays.spec.ts`.

## ADR-039: Simple Mode by Default, Advanced Options Behind a Switch

- **Status**: Accepted
- **Context**: The panel was written in the words of the people who built it: selector, schema, recipe, dataset, pagination, confidence. Someone who uses Excel and wants "the list on this page, in a spreadsheet" met five start decisions, a type picker and four pagination modes before the first row. Experienced users rely on those same controls, so none can be removed.
- **Decision**:
  1. The panel has two modes. Simple mode is the default. **Advanced options**, a switch in Settings, brings every detailed control back. The switch hides controls; it deletes nothing, and every control it hides is reachable when it is on.
  2. The choice is a preference in `chrome.storage.local` (`pageharvest.advanced`, `src/components/settings/advanced-preference.ts`), like the tour flag (ADR-005, ADR-032). It is not in `UserSettings`, so no contract changes, and it never touches IndexedDB. A read that is still under way cannot undo a newer choice; unreadable storage means simple mode; a choice that cannot be stored still applies to the open panel, and Settings says it was not remembered.
  3. Users read plain words in both modes: "Get data" and "My data" in the navigation, and the steps Check columns, More pages, Collect and Download. Code names are unchanged.
  4. In simple mode the start screen has one large action, "Get the list on this page", with "Pick one item myself" as the way out when it fails.
  5. Contract addition, display-only: `REPEATED_ELEMENTS_DETECTED` gains optional `moreItems: 'next' | 'load_more' | 'none'` (`MoreItemsHintSchema`). The content workflow coordinator fills it with `findMoreItems` (`src/content/more-items.ts`), which calls the finders a job uses, `findNextPageControl` and `findLoadMoreControl`, and only reads the DOM: it never clicks, scrolls or focuses, and a disabled control counts as none. If the look throws, the list is reported without the hint. The side panel keeps it on the detected list and uses it to word one question: with `next` or `load_more`, "This list continues on more pages. Get them too?", defaulting to yes; with `none` or no hint, "Does this list continue on more pages?", defaulting to "No, just this page". The background registers no handler for the message, a job does not read the hint, and a job still finds its own control when it runs. Infinite scroll is not hinted, because finding it would mean scrolling.
- **Consequences**: The unit suites and Playwright specs written before simple mode run with Advanced options on (`tests/setup.ts`, `enableAdvancedOptions` in `tests/e2e/helpers/panel.ts`) and are the proof that nothing was lost; simple-mode tests switch it off (`tests/utils/panel-mode.ts`). The real-site benchmark turns it on; the native-Chrome release check uses a fresh profile and follows the simple flow. A message without `moreItems` parses as before. Covered by `tests/unit/ui/advanced-options.test.tsx`, `tests/unit/ui/simple-start.test.tsx`, `tests/contracts/more-items-hint.test.ts` and `tests/integration/more-items-hint.test.ts`.

## ADR-040: Site Access Held From Install, No Per-Site Prompt

- **Status**: Accepted. Supersedes the permission part of ADR-037 (`optional_host_permissions`, one prompt per site); on-demand injection from ADR-037 stays.
- **Context**: With ADR-037, the first Start on every new site made Chrome show its own bubble: "PageHarvest wants to read and change your data on this site". People using the extension, and the owner, found it alarming and repetitive, more so because PageHarvest never changes a page's data. Chrome writes that sentence and an extension can neither reword nor suppress it; the only way not to show it per site is to hold the access already. Comparable extraction extensions declare the access in the manifest and are never interrupted while in use.
- **Decision**: Move `["http://*/*", "https://*/*"]` from `optional_host_permissions` to `host_permissions` in `wxt.config.ts`. Nothing else in production code changes. `requestSiteOrigin` still runs first in the Start, resume and Allow access clicks, and `hasHostAccess` still guards the coordinator: Chrome answers both at once, with no prompt, for a granted site. They keep their purpose for one case, a user who limits the extension to "on click" or to named sites in `chrome://extensions`; there Chrome can still ask, and `SITE_PERMISSION_REQUIRED` and **Allow access and resume** work as before. The content script stays runtime-registered and is injected only into a page the user works on.
- **Consequences**: Chrome shows "Read and change all your data on all websites" once, at install, which ADR-037 had avoided; that is the trade for no prompts afterwards. The Chrome Web Store reviews items with broad host access in more depth. An already-installed copy that updates across this change is disabled by Chrome until the user accepts the new permission (no copy is published yet). With site access, Chrome shows the panel the tab's address without a toolbar click, so the **Access needed** state appears only where the user restricted access. `tests/unit/manifest-assets.test.ts` asserts exact `host_permissions`, no `optional_host_permissions`, no `content_scripts` entries and no `<all_urls>`. `scripts/testing/test-extension.mjs` no longer has to add a grant to the copy automated browsers load. `tests/e2e/site-permission.spec.ts` now proves a site never used before starts a job unasked; refusal for a site without access remains covered by `tests/integration/site-permission.test.ts`. `PRIVACY.md`, `STORE_LISTING.md` and ARCHITECTURE §3.10 say the same.

## ADR-041: The Privacy Policy, the Listing and the Package Say Only What the Code Does

- **Status**: Accepted
- **Context**: An audit before release compared the manifest, the code and the three texts a reviewer and a user read: `PRIVACY.md`, `STORE_LISTING.md` and the panel. Five things did not match. (1) `scripting` was in the manifest with no justification in either permission table, and `storage` and `activeTab` were justified by uses that had since changed. (2) The policy still said the page script "runs on the pages you visit", which stopped being true with on-demand injection (ADR-037). (3) The dashboard showed the site's icon with `<img src={tab.favIconUrl}>`, a request from the panel to the site, while the policy and the listing say the extension makes no network requests of its own. (4) Since ADR-040 every website's address is visible to the panel, so a hidden address is a browser page; the panel still answered it with **Access needed** and "click the toolbar button", which sends someone on a new tab page into a click that changes nothing. (5) The package contained React, Dexie, Zod and nine other packages with only one-line banners, although MIT, ISC and Apache-2.0 require the copyright notice and licence text, and Dexie's NOTICE file, to travel with every copy.
- **Decision**:
  1. Every manifest permission has a row in both tables, worded from what the code does with it today. `tests/unit/manifest-assets.test.ts` fails when a permission has no row, when either text calls site access optional, or when the policy describes a script that runs on every page.
  2. The policy describes the three things the extension observes (the page the user starts it on, the open tab's address while the panel is open, and tab load and close events used only for a tab with a running job), states that nothing is edited or submitted on a site, and carries the Chrome Web Store Limited Use statement.
  3. The panel never loads the site's icon. `TabInfo` has no `favIconUrl`, so no component can.
  4. `hasAllSitesAccess` (`src/platform/permissions.ts`) asks Chrome whether the installed access is still held. `needsAccess` is true only for a hidden address when it is not, which is the case of a user who chose "when you click the extension" or named sites. Otherwise a hidden address is shown as a page that cannot be read, with "switch to a tab with a website". The manual refresh button is shown only with Advanced options on, because the panel follows the tab by itself.
  5. `scripts/generate-third-party-notices.mjs` writes `public/THIRD_PARTY_NOTICES.txt` from the installed production dependencies and what they depend on, plus Tailwind (its base stylesheet is shipped) and WXT (its entrypoint helpers are bundled), with each licence text and any NOTICE file. `pnpm build` and `pnpm zip` run it, `tests/unit/third-party-notices.test.ts` fails when the committed file is stale, when a runtime dependency is missing or when a licence is not a permissive one, and Help links to the file and to the privacy policy and shows the version. The version badge left the header.
- **Consequences**: The dashboard shows a globe where the site's icon was. A user who limited site access and stands on a browser page is told the page cannot be read, which is true, instead of being asked for a click. The package grows by about 30 kB of text. Adding a runtime dependency without regenerating the notices fails the unit suite.

## ADR-042: Simple Mode From the List to the File

- **Status**: Accepted. Completes ADR-039.
- **Context**: ADR-039 gave simple mode its start screen and "We found N items". After that a new user still met the detailed screens: a column editor with types and selectors, four ways of paging with limits and waits, a progress view with seven counters, a results grid with cleaning tools, a library with five tabs, and an export dialog with four formats and a "Save as" window. Driving the built extension on a real shop showed two more things no test had: a column filled with "Add to basket" on every row, ticked by default, and a native-Chrome release check that pressed buttons simple mode no longer has.
- **Decision** (simple mode only, unless a point says both modes; Advanced options keeps every screen it had):
  1. **Columns** (`src/components/simple/Columns.tsx`): each column is a tick box, a name the user changes by typing over it, and an example from the page. A name is written when the user leaves the box, never left empty, and never the same as another column's, because two columns with one name would write into one cell. What a column reads and where is not shown. A saved setup loaded in simple mode still opens the detailed screen.
  2. **More pages** (`more-pages.ts`): one question replaces the four modes. When the page showed a Next or "Load more" control (ADR-039's `moreItems`), it reads "This list continues on more pages. Get them too?" with Yes chosen; otherwise "Does this list continue on more pages?" with "No, just this page" chosen and two ways to say yes, a Next button or scrolling. The answer is written into the existing `PaginationConfig`: `next_button` with `maxPages`, or `infinite_scroll` with `scrollCount`. Simple mode starts at 5 pages or 10 scrolls and allows 1 to 50; the Settings defaults (20 and 30) apply only with Advanced options on. When a list is accepted in simple mode, `nextButtonSelector`, `urlTemplate` and `maxRecords` are cleared, so nothing the user cannot see shapes the job. No contract changes.
  3. **Collecting** (`Progress.tsx`): rows saved, the page or scroll it is on, Pause, and one way to stop, "Stop here and keep my rows", which is the existing Finish. Cancel is not offered, because it also keeps the rows and differs only in where the panel goes next.
  4. **Done** (`Done.tsx`): "Done. N rows collected", one large "Download for Excel", a CSV file and "Copy the table" as the other ways, and the first five rows. Copy uses tabs between cells, so a paste lands in separate cells. A run that ended at the page or scroll limit says so. No rows is not called done: it says what happened and offers to try again. The same screen, headed by the list's name, is what a saved list opens as; the full table, with cell editing and search, is one click further.
  5. **Downloads, both modes** (`src/platform/downloads.ts`): `saveAs: false` and `conflictAction: 'uniquify'`, so a file goes to the Downloads folder with no window to answer and never replaces an older one. `triggerDownload` still means Chrome accepted the download. `waitForSavedFile` then follows it with `chrome.downloads.search`: only `complete` is called saved, with the name Chrome really used and never the folder path; `interrupted` is reported with a plain reason; anything else is "still saving". `showInFolder` calls `chrome.downloads.show`. `SavedFileNotice` shows this on the Done screen, in My data, and under the grid after the export dialog closes, since without a "Save as" window the user would otherwise not know where the file went. A file is named after the list and today's date, without repeating the date the list's own name ends with.
  6. **My data** (`MyData.tsx`): the saved lists, each with Open, Download for Excel and Delete. Groups, saved setups, column sets and the run history are other views of the same data and stay under Advanced options.
  7. **Stopped early and errors**: the recovery banner reads "Stopped early", with one plain sentence, "Continue" and "Stop here and keep my rows"; where and why it stopped are under Technical details. `describeError(error, { simple })` swaps in simple-mode wording for the codes whose usual advice points at a control only Advanced options shows, and `ErrorBanner` follows the Settings switch through `useIsAdvanced`.
  8. **Deleting, both modes**: the grid asked with the browser's `confirm()`, which is not reliably shown for a side panel and names the extension by its address. It now asks in the panel's own dialog, as My data and Settings do.
  9. **Detection**: the label of a button on each item ("Add to basket") is still offered as a column, but starts unticked (`isSuggested` in `src/core/detection/fields.ts`). Ticking it collects it as before.
  10. **Wording, both modes**: Settings no longer names IndexedDB or "client-side"; it offers Excel as a default export format, which the settings contract already allowed; the tour and Help describe the simple flow and name the Advanced equivalents.
- **Consequences**: A new user reaches a saved Excel file in four clicks. `tests/unit/ui/simple-flow.test.tsx` runs the whole path with the real coordinator, router and content workflow coordinator; `simple-columns`, `simple-run` and `simple-my-data` cover each screen; `tests/e2e/simple-mode.spec.ts` runs it in Chromium, opens the saved workbook from disk, and asserts the panel made no network request. The suites written before simple mode still run with Advanced options on and are unchanged except where both modes changed: the delete dialog, `saveAs`, and Settings wording. `scripts/release-testing/native-chrome.mjs` presses the simple flow's buttons again. A user who relied on the "Save as" window to choose a folder now moves the file afterwards, or sets Chrome to ask where to save each file.

## ADR-043: A Found List Belongs to Its Tab and Page

- **Status**: Accepted.
- **Context**: The release audit of 2026-11-15 found, and a run in Chromium with the built extension confirmed, that the panel kept a found list when the user switched tabs and then started it on whichever tab was in front. Finding the list on one page, switching to another tab and pressing Start created a job on the other page with the first page's selectors. It ended "completed" with no rows. Every page message (detection, columns, preview, stopping the picker) also went to "the active tab", and the panel acted on detection results from any tab.
- **Decision**:
  1. Finding a list (any of the four ways) or opening a saved setup records its source, `{ tabId, url, title }`, in `useExtractionWorkflow`. Detection, column discovery, `PREVIEW_FIELDS` and `STOP_PICKER` are sent to that tab. The messaging service tells each listener which tab a message came from, and the panel ignores page reports (`ELEMENT_SELECTED`, `SELECTION_*`, `REPEATED_ELEMENTS_DETECTED`, `FIELDS_DETECTED`, `EXTRACTION_ERROR`) from any other tab, or when no list is being found.
  2. While another tab is in front, the list screens are replaced by "This list is on another tab", with "Go back to that tab" (`chrome.tabs.update`, no permission needed) and "Start again on this page". Going back brings the screens back as they were.
  3. When the source tab shows another document (a new address, ignoring `#fragment`) or is closed, the list is dropped and the start screen says "The page changed, so the list you found is gone."
  4. Start is refused in the panel on a tab or address mismatch. `START_JOB` is also checked in the background: `JobTransport.getTabUrl` reads the tab's address from Chrome, and a different document is refused (`LIST_PAGE_CHANGED_MESSAGE`) before anything is stored.
  5. Resume is unchanged: it opens a new tab on the job's own checkpoint address and never consults the tab in front.
- **Consequences**: Covered by `tests/integration/tab-binding.test.tsx` (panel, background and two pages in jsdom), `tests/integration/start-job-source.test.ts` (the background check and Resume), and `tests/e2e/tab-binding.spec.ts` (Chromium, the real "Go back to that tab"). No contract and no permission changed. With this and the slow-start fix, the side panel's main chunk grew from 526,486 B to 530,294 B, past its absolute cap of 530 kB; the cap is now 540 kB and the baseline 530,294 B (`scripts/check-bundle-budget.mjs`).

## ADR-044: The Picker Ends With the Panel That Started It

- **Status**: Accepted.
- **Context**: The release audit found that closing the side panel while picking left the page's picker running: its capturing click and key handlers kept swallowing the page's clicks until the user pressed Escape, and nothing told the page the panel had gone.
- **Decision**: While the user picks, the panel holds a port open to the page (`chrome.tabs.connect`, name `pageharvest-picker`, `src/platform/picker-lifetime.ts`). Chrome closes it when the panel closes or reloads; the content script then stops the picker, which removes its overlay. A newer hold replaces an older one, so an older connection ending late cannot stop a picker started again. The panel also lets go when the selection is confirmed or cancelled, when picking stops, and when it unmounts. When another tab comes to the front while the user picks, the panel stops the picker on its own tab (ADR-043) and the start screen says "Picking stopped because you switched to another tab."
- **Consequences**: No permission is needed. Covered by `tests/unit/picker-lifetime.test.ts`, the picker cases in `tests/integration/tab-binding.test.tsx`, and `tests/e2e/tab-binding.spec.ts`, which closes the real panel and checks that the overlay is gone and the page's link works again.

## ADR-045: "Slow Down" Only for a Real 429

- **Status**: Accepted.
- **Context**: The `RATE_LIMITED` error code and its message ("The site asked PageHarvest to slow down") existed, but nothing raised them, so the message could never appear.
- **Decision**: The content script reads the HTTP status the document was served with from its navigation timing entry (`responseStatus`, Chrome 109+). When a job's page was answered with 429 Too Many Requests, nothing is read from it and the page reports `JOB_FAILED` with `recoverable: true` and `code: 'RATE_LIMITED'`. The coordinator keeps the code on the error it stores when it makes the job recoverable, and the recovery banner, in both modes, then says "The site asked PageHarvest to slow down" with the copy's advice and Continue. No other status, and no guess from page text, triggers it. A rate limit that a site applies without a 429, or to requests made by the page's own scripts (for example while scrolling a feed), is not detected.
- **Consequences**: Covered by `tests/integration/rate-limit.test.tsx` and `tests/e2e/rate-limit.spec.ts`, where the fixture server answers page 2 with 429 (`?status=429`, `tests/fixtures/serve.cjs`) and the real panel shows the message.

## ADR-046: At Least One Second Between Pages

- **Status**: Accepted. Changes the pagination and settings contracts.
- **Context**: The release audit of 2026-11-15 found the politeness controls thin: Advanced options allowed 200 ms between pages. Simple mode already used the 1.5 s default, but a saved setup or a changed setting could hit a site five times a second.
- **Decision**: `MIN_PAGE_DELAY_MS = 1000` in `src/shared/contracts/pagination.ts`. `PaginationConfig.delayMs` and `UserSettings.defaultDelayMs` accept 1000 to 30000 ms; the default stays 1500 ms. The Pagination panel's input starts at 1 second and Settings at 1000 ms. Dexie version 4 has no index change: its upgrade raises any stored wait below 1000 ms to 1000 ms, in the settings row and in `pagination.delayMs` of saved setups, column sets and jobs, so every stored row still parses. Waits at or above the minimum are left as they were. The scroll wait (`scrollDelayMs`, 300 ms minimum) is unchanged: it paces scrolling within one page, not loading new pages.
- **Consequences**: A job visits at most one page per second. Tests that ran jobs with 200 ms waits now use 1000 ms, which makes a few multi-page tests slower. `tests/unit/minimum-page-wait.test.ts` covers the contracts and the version 3 to 4 upgrade.
