# PageHarvest File Ownership Matrix

This document defines the strict, non-negotiable **file ownership and responsibility matrix** across all 10 specialized engineering roles in the PageHarvest repository.

## Ownership Rules
1. **Single Primary Owner**: Every file, module, and directory has exactly **one primary agent owner**.
2. **Contract Governance**: Shared contracts (`src/shared/contracts/` and `src/contracts/`) are strictly owned by **Agent 1 (Chief Architect)**. No other agent may alter, delete, or bypass these contracts without an RFC and formal approval.
3. **No Cross-Module Contamination**: Agents must interact through defined contracts and public module APIs rather than reaching into private internals of other modules.
4. **Integration Gatekeeper**: Agent 1 and Agent 10 review cross-cutting PRs, integration test results, and subsystem boundaries.

---

## Detailed File Ownership Matrix

| Path / Module | Primary Owner | Secondary Reviewer | Scope & Responsibilities |
| :--- | :--- | :--- | :--- |
| `src/shared/contracts/**` | **Agent 1 (Chief Architect)** | Agent 10 (Resilience) | Canonical Zod schemas, TypeScript types, `BrowserMessage` protocol, domain entities. |
| `src/contracts/**` | **Agent 1 (Chief Architect)** | Agent 10 (Resilience) | Schema aliases and runtime message validation layers. |
| `docs/**` | **Agent 1 (Chief Architect)** | All Agents | Architecture, ADRs, PRD, testing documentation, integration guides. |
| `AGENTS.md` | **Agent 1 (Chief Architect)** | All Agents | Engineering protocol, agent rules, and quality gates. |
| `package.json`, `tsconfig.json`, `wxt.config.ts`, `vitest.config.ts` | **Agent 1 (Chief Architect)** | Agent 10 (Resilience) | Build system, bundler entrypoints, compiler options, test runner configuration. |
| `src/storage/**` | **Agent 2 (Storage & Persistence)** | Agent 1 (Chief Architect) | Dexie IndexedDB schemas, migrations, repositories (`projects`, `jobs`, `records`, `recipes`), database transactions. |
| `src/content/picker/**` | **Agent 3 (DOM Inspector & Picker)** | Agent 4 (Detection) | Visual hover overlay, closed Shadow DOM mounting, breadcrumb path, bounding box tracking, selector generator. |
| `src/core/detection/**` | **Agent 4 (Pattern Detection)** | Agent 3 (Picker) | Sibling clustering, DOM structural similarity heuristics, list/card/table detection, confidence scoring, field candidate proposals. |
| `src/core/extraction/**` | **Agent 5 (Extraction & Normalization)** | Agent 8 (Data Grid) | Record extraction engine, relative selectors, attribute/href/regex extractors, text cleaning, URL resolution, SHA-256 deduplication. |
| `src/core/navigation/**` | **Agent 6 (Navigation & Pagination)** | Agent 10 (Resilience) | Next-button runner, infinite scroll controller, MutationObserver triggers, delay throttling, circuit breakers. |
| `entrypoints/sidepanel/**`, `src/components/picker/**` | **Agent 7 (Side Panel UI & Tab Lifecycle)** | Agent 8 (Data Grid) | Side panel React shell, tab status monitoring, active tab messaging, job workflow coordination. |
| `entrypoints/background.ts` | **Agent 7 (Side Panel UI & Tab Lifecycle)** | Agent 1 (Chief Architect) | Service worker lifecycle, side panel toggle on extension click, tab activation listeners. |
| `entrypoints/content.ts` | **Agent 3 (DOM Inspector & Picker)** | Agent 5 (Extraction) | Content script bootstrap, message dispatcher, coordinator between picker, detection, and extraction engines. |
| `src/components/grid/**` | **Agent 8 (Data Grid & Table UI)** | Agent 7 (Side Panel UI) | TanStack Table spreadsheet, column reordering/resizing, sorting, filtering, inline cell editing, row deletion. |
| `src/core/export/**` | **Agent 9 (Export & Data Pipeline)** | Agent 8 (Data Grid) | RFC 4180 CSV serializer, JSON / NDJSON formatters, chunked streaming, Chrome Downloads API broker. |
| `src/core/resilience/**` | **Agent 10 (Resilience & Integration)** | Agent 1 (Chief Architect) | Crash recovery, session checkpointing, error logging, retry backoff, circuit breakers. |
| `tests/unit/contracts.test.ts` | **Agent 1 (Chief Architect)** | Agent 10 (Resilience) | Unit validation of Zod contracts, schemas, and message discriminated unions. |
| `tests/unit/detection/**` | **Agent 4 (Pattern Detection)** | Agent 10 (Resilience) | Unit tests for structural fingerprinting and similarity clustering. |
| `tests/unit/extraction/**` | **Agent 5 (Extraction & Normalization)** | Agent 10 (Resilience) | Unit tests for field extractors, regex captures, and record hashing. |
| `tests/unit/navigation/**` | **Agent 6 (Navigation & Pagination)** | Agent 10 (Resilience) | Unit tests for next-button detection and scroll triggers. |
| `tests/unit/storage/**` | **Agent 2 (Storage & Persistence)** | Agent 10 (Resilience) | Unit tests for Dexie CRUD, queries, and migrations using `fake-indexeddb`. |
| `tests/unit/export/**` | **Agent 9 (Export & Data Pipeline)** | Agent 10 (Resilience) | Unit tests for CSV escaping, quotation, delimiter variation, and JSON formatting. |
| `tests/integration/**` | **Agent 10 (Resilience & Integration)** | Agent 1 (Chief Architect) | End-to-end integration flows across Content Script, Side Panel, and Storage. |
| `tests/fixtures/**` | **Agent 1 (Chief Architect)** | All Agents | Realistic HTML snapshots (e-commerce listings, news archives, tabular data). |

---

## Escalation & Modification Protocol

1. **Contract Changes**: If an agent requires a new field or schema change, it must submit an RFC issue detailing the motivation, schema diff, and migration impact.
2. **Shared Utility Changes**: Utility functions in `src/utils/` must be pure, accompanied by 100% test coverage, and backward-compatible.
3. **Emergency Fixes**: Only the Chief Architect may bypass standard review to address critical build or runtime regressions.
