# PageHarvest — Product Requirements Document (PRD)

## 1. Executive Summary

**PageHarvest** is a production-quality, local-first browser extension for Chrome (Manifest V3) that empowers users to turn complex, dynamic websites into structured, clean, and exportable datasets. It provides a visual point-and-click interface embedded inside Chrome's native Side Panel, powered by automated repeated pattern detection, resilient pagination/infinite scroll automation, an interactive data grid with inline spreadsheet capabilities, and zero-telemetry local IndexedDB persistence.

---

## 2. Target Users & Core Value Proposition

### 2.1 Target Personas
1. **Data Analysts & Researchers**: Need structured tabular data from portals, directories, catalogs, and public listings without writing custom scraper scripts.
2. **Growth & Marketing Specialists**: Need lead lists, competitor product comparisons, and catalog audits without paying recurring subscriptions for cloud scrapers.
3. **Developers & Automation Engineers**: Require reusable, versioned extraction schemas and recipes that can be saved, edited, and rerun locally.

### 2.2 Core Value Pillars
- **Zero Cloud Leakage**: All DOM parsing, data extraction, and storage occur strictly within the user's browser sandbox.
- **Zero Configuration Boilerplate**: Automatic structural similarity clustering detects repeated listing cards, tables, and product grids with a single click.
- **Stealth & Resilience**: Human-like configurable delay throttling, intelligent MutationObserver synchronization, and zero DOM contamination using Shadow DOM overlays.
- **Enterprise-Grade Data Grid**: TanStack-powered spreadsheet view with real-time column reordering, type coercion, inline cell editing, sorting, filtering, and RFC 4180 CSV / JSON exports.

---

## 3. Functional Requirements

### 3.1 Visual Element Inspector & Picker
- **FR-1.1**: The user can toggle an "Inspect Element" mode from the Side Panel.
- **FR-1.2**: As the mouse hovers over elements in the target webpage, an isolated highlight box with dimensions, tag name, and breadcrumb path renders over the element.
- **FR-1.3**: The highlight overlay MUST render inside a closed Shadow DOM attached to `document.documentElement` to prevent host page CSS collisions or pollution.
- **FR-1.4**: Clicking an element locks the selection, sends its CSS selector, bounding rect, and text preview to the Side Panel, and automatically proposes parent container candidates.
- **FR-1.5**: Pressing `Escape` or clicking "Cancel" deactivates the picker and removes all overlay elements cleanly.

### 3.2 Repeated Element & Pattern Detection
- **FR-2.1**: When an element is selected (or "Auto-Detect" is clicked), the engine analyzes ancestor DOM nodes to identify repeating sibling structures.
- **FR-2.2**: Computes structural similarity scores using tag sequences, class patterns, and DOM depth.
- **FR-2.3**: Detects recurring collections (e.g., e-commerce product grids, search result items, table rows, article cards) and highlights all matching siblings simultaneously.
- **FR-2.4**: Displays the candidate container selector, total count of matched elements, and a sample preview in the Side Panel.

### 3.3 Field Definition & Auto-Discovery
- **FR-3.1**: Once a container is established, the user can define extraction fields (columns).
- **FR-3.2**: Auto-Discovery scans children of container elements to propose common field types:
  - `Title / Heading`: `h1-h6`, `[class*="title"]` -> Text
  - `URL / Link`: `a[href]` -> Absolute URL
  - `Image / Thumbnail`: `img[src]`, `img[data-src]` -> Absolute URL
  - `Price / Numeric`: Currencies, numbers with decimals -> Float
  - `Description`: `p`, `[class*="desc"]` -> Text
- **FR-2.5**: Auto-detect shows up to eight candidate lists with samples, columns, confidence and evidence, and never chooses silently. If nothing looks like data it says so.
- **FR-3.2a**: Field discovery samples many records, so a field missing from the first is still offered, with how often it was found.
- **FR-3.2b**: A number is stored only when it can be read with certainty. Otherwise the text is kept and marked ambiguous, and ranges keep both ends. The original text and currency stay with the row.
- **FR-3.3**: Users can manually add, edit, reorder, or delete fields.
- **FR-3.6**: A selected field with no value never removes a record. Only a field the user explicitly marks to skip empty rows filters records, and every outcome (detected, kept, missing fields, filtered, failed, duplicate) is shown.
- **FR-3.4**: Supported extractors: `text`, `attribute`, `href`, `src`, `html`, `number`, `regex`.
- **FR-3.5**: Supported post-processors: `trim`, `lowercase`, `uppercase`, `capitalize`.

### 3.4 Multi-Page Navigation & Pagination
- **FR-4.1**: Single-Page Mode (`none`): Harvests only currently rendered records.
- **FR-4.2**: Next-Button Pagination (`next_button`):
  - User selects or engine auto-detects the pagination "Next" button.
  - Automatically clicks next, waits for DOM mutations or network idle, and harvests consecutive pages.
  - Terminates when: next button is disabled/missing, max pages reached, or consecutive runs produce 0 new records.
- **FR-4.3**: Infinite Scroll Mode (`infinite_scroll`):
  - Automatically scrolls the window or specific scroll container in increments.
  - Waits for DOM child expansion via MutationObserver.
  - Halts when scroll limit is hit or no new elements load after 3 retries.
- **FR-4.3a**: URL Template Mode (`url_template`):
  - Visits numbered URLs built from a template with `{page}` or `{offset}`, a starting page, an increment and a maximum page count, with a preview of the generated URLs.
  - Stays on the website the job started from. Stops at the limit, on an empty page, or when a page adds nothing new.
- **FR-4.4**: Configurable delay throttle (default 1500ms, range 200ms–30000ms) to respect host website resources.
- **FR-4.5**: Circuit Breakers: Hard page cap (default 20, max 500) and instant user "Pause" / "Stop" abort buttons.

### 3.5 Local-First Persistence & Storage
- **FR-5.1**: Datasets, schemas/recipes, and execution logs persist in IndexedDB via Dexie.
- **FR-5.2**: Schema management allows users to save extraction templates per domain and reload them on future visits.
- **FR-5.3**: Automatic content deduplication prevents duplicate rows across pages or scrolls. Two rows are duplicates only if their canonical records are equal; SHA-256 fingerprints only find candidates, so a hash collision can never remove a distinct record.
- **FR-5.5**: Durable jobs: an acknowledged record survives closing the panel or tab, a service worker restart and a browser restart. An interrupted job can be resumed or discarded, without duplicate records.
- **FR-5.4**: History tracking logs timestamp, duration, records count, duplicates skipped, and errors for every job run.

### 3.6 Data Grid & Transformation
- **FR-6.1**: Extracted records display in a real-time responsive data table (TanStack Table).
- **FR-6.2**: Supports column sorting (ascending/descending) and global text search/filtering.
- **FR-6.3**: Supports inline cell editing so users can clean typo/format errors before export.
- **FR-6.4**: Allows single row deletion or bulk clear.
- **FR-6.5**: Shows live record counter, duplicate counter, and current harvest status (idle, running, paused, completed).

### 3.7 Export Pipeline
- **FR-7.1**: CSV Export: RFC 4180-compliant serialization with correct quote escaping, UTF-8 BOM encoding for Excel compatibility, and customizable delimiter (`,`, `;`, `\t`).
- **FR-7.2**: JSON Export: Formatted indented JSON array.
- **FR-7.3**: NDJSON Export: High-efficiency line-delimited JSON stream.
- **FR-7.4**: Clipboard copy: Instant copy of CSV or JSON to system clipboard.
- **FR-7.5**: File download triggers via `chrome.downloads` or Blob object URLs with sanitized filenames.

---

## 4. Non-Functional Requirements

### 4.1 Performance & Resource Efficiency
- **NFR-1**: Content script memory footprint must remain under 15MB during active inspection.
- **NFR-2**: Data extraction pipeline must process 1,000 DOM records in under 200ms.
- **NFR-3**: Side Panel UI must render 60 FPS without UI jank during streaming data ingestion.

### 4.2 Security, Privacy & Extension Isolation
- **NFR-4**: Manifest V3 compliant. Zero remote code evaluation (`eval`, `new Function` prohibited).
- **NFR-5**: 100% offline-first architecture. Zero telemetry, tracking, or outbound analytical network calls.
- **NFR-6**: Content scripts run in `ISOLATED` world. Page scripts cannot access extension runtime APIs or storage.

### 4.3 Browser Compatibility
- **NFR-7**: Chrome 116+ (supporting `chrome.sidePanel` and MV3 service workers).
- **NFR-8**: Cross-engine readiness for Chromium-based browsers (Edge, Brave, Opera).

---

## 5. Milestone & Release Criteria
- **v1.0.0-alpha**: Core contracts, build system, DOM picker, single-page extraction, CSV export.
- **v1.0.0-beta**: Repeated pattern detection, Next-button & infinite scroll pagination, Dexie storage.
- **v1.0.0-GA**: Full TanStack data grid, recipe presets, comprehensive test suite (85%+ coverage), Chrome Web Store package.
