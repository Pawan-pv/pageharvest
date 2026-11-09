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

- **Status**: Accepted
- **Context**: The static `content_scripts` entry (`<all_urls>`) forced the "Read and change your data on all websites" install warning, even though most users only ever extract from a handful of sites. Chrome's documented alternative is `chrome.scripting.executeScript` with the `scripting` permission plus per-site host grants: `activeTab` gives temporary access after a toolbar click with no install warning, and `optional_host_permissions` lets the extension request one site's origin at a time from a user gesture (Chrome prompts "this site", never "all sites").
- **Decision**: Remove the static entry by registering the content script at runtime (`registration: 'runtime'` in `entrypoints/content.ts`, a WXT built-in option — no hand-removed `matches`). Add `scripting` to required `permissions` and `optional_host_permissions: ["http://*/*", "https://*/*"]` so any site's origin can be requested as `https://host/*`. Picking/detection/preview inject under the `activeTab` grant (no prompt); starting any job (including single-page and recipe runs) first requests a persistent origin grant with `chrome.permissions.request` as the first await in the Start click, before any messaging round trip. Resume from the recovery banner requests the job's origin the same way (Chrome answers at once, with no prompt, when it is already granted). The background only checks (`permissions.contains`) and injects (`executeScript`, idempotent via `__PAGEHARVEST_INJECTED__`): on every `tabs.onUpdated` "complete" in an active job's tab (running or paused, expected navigation or not) the coordinator probes the document (`executeScript` with a `func` that reads the flag and `location.href`) and injects only when the script is missing; only a document that is new to the script goes to `handleContentReady`, which keeps deciding continue / park / interrupt as it did for the static script. The content script no longer sends `CONTENT_READY` on startup and the router no longer handles it: the script is now often injected into the page a job is already running on (at Start, on resume, before a retried `EXTRACT_RECORDS`), where a self-announcement would read as a reload and interrupt the job, or send a Next-button job to the same page twice. The `CONTENT_READY` schema stays in the contracts, unused. When Chrome hides the active tab's address (no grant for it yet), the panel shows **Access needed** and asks for a click on the toolbar button, instead of calling the page restricted, and re-checks every 2 s until the address appears. A load that cannot be scripted on a granted site interrupts a running job that was not expecting navigation (the tab left the site or shows an error page); a missing grant interrupts with `SITE_PERMISSION_REQUIRED`. `permissions.onRemoved` moves active jobs on that origin to RECOVERABLE with that code, and the recovery banner then reads **Allow access and resume**. Restricted pages are checked before the grant, so they keep their own message. `TAB_DISCONNECTED` keeps its meaning; revoked/missing access is `SITE_PERMISSION_REQUIRED` only. The one wording is `SITE_PERMISSION_MESSAGE` in `src/platform/permissions.ts`; `requestSiteOrigin` and `hasHostAccess` return false instead of throwing.
- **Consequences**: Install shows no host warning. First use via the toolbar button injects without a prompt; starting a job persists the grant so later pages, resume after tab close, and restart resume work without relying on `activeTab` surviving navigation. `manifest-assets.test.ts` asserts the built manifest (no `content_scripts` entries, no `host_permissions`, no `<all_urls>`, `optional_host_permissions` exactly as above). Covered by unit, integration (`tests/integration/site-permission.test.ts`, chrome mock + production wiring), and `tests/e2e/site-permission.spec.ts`. Playwright cannot answer Chrome's permission bubble, so every E2E spec, the native-Chrome release check and the real-site benchmark load a copy of the production build whose manifest also grants the sites they visit as `host_permissions` (`scripts/testing/test-extension.mjs`, `.output/chrome-mv3-test`); the production build is never modified. Manual checks: the prompt and its wording, revoking a site in `chrome://extensions`, and the toolbar click granting `activeTab` while the panel is open. The chrome mock passes its permission implementations to `vi.fn(impl)` so `vi.restoreAllMocks()` in a test file does not leave `permissions.contains` returning undefined.
