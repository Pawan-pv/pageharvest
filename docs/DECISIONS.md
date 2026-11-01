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
