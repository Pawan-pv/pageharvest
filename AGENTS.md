# AGENTS.md — PageHarvest Multi-Agent Engineering Protocol

Welcome to the **PageHarvest** engineering workspace. PageHarvest is a production-grade Chrome extension (Manifest V3) for local-first website data extraction, built with WXT, React, TypeScript, Chrome Side Panel API, Tailwind CSS, Dexie (IndexedDB), Zod, TanStack Table, Vitest, and React Testing Library.

This project is collaboratively built and maintained by **10 specialized AI engineering agents**. All agents must follow this document strictly.

---

## 1. Documentation Map & Mandatory Reading

Before modifying any file, agents must read the relevant architectural documentation:

| Document | Purpose |
| :--- | :--- |
| [ARCHITECTURE.md](file:///c:/myProject/extension/docs/ARCHITECTURE.md) | High-level system architecture, extension entry points, Shadow DOM isolation, extraction/detection/pagination pipelines. |
| [PRODUCT_REQUIREMENTS.md](file:///c:/myProject/extension/docs/PRODUCT_REQUIREMENTS.md) | Functional requirements (FR), non-functional requirements (NFR), personas, and acceptance criteria. |
| [DECISIONS.md](file:///c:/myProject/extension/docs/DECISIONS.md) | Architectural Decision Records (ADRs) explaining technical foundations and trade-offs. |
| [FILE_OWNERSHIP.md](file:///c:/myProject/extension/docs/FILE_OWNERSHIP.md) | Detailed ownership matrix assigning every module and directory to a primary agent owner. |
| [IMPLEMENTATION_STATUS.md](file:///c:/myProject/extension/docs/IMPLEMENTATION_STATUS.md) | Implementation roadmap, task DAG, dependency chains, and parallel execution tracks. |
| [TEST_STRATEGY.md](file:///c:/myProject/extension/docs/TEST_STRATEGY.md) | TDD methodology, test pyramid, naming standards, coverage gates, and fixture layout. |
| [TEST_MATRIX.md](file:///c:/myProject/extension/docs/TEST_MATRIX.md) | Comprehensive mapping of requirements to test suites, edge cases, and failure modes. |
| [TEST_RUNBOOK.md](file:///c:/myProject/extension/docs/TEST_RUNBOOK.md) | Step-by-step commands to run, watch, debug tests and generate coverage reports. |
| [INTEGRATION_GUIDE.md](file:///c:/myProject/extension/docs/INTEGRATION_GUIDE.md) | Detailed protocols and code snippets for integrating with shared contracts, background worker, and storage. |

---

## 2. The 10 Specialized AI Engineering Roles

1. **Agent 1: Chief Architect & Technical Lead**
   - **Exclusive Owner**: `src/shared/contracts/`, `src/contracts/`, `docs/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `wxt.config.ts`.
   - **Responsibilities**: Defines and governs canonical Zod schemas, TypeScript contracts (`ExtractionProject`, `ExtractionJob`, `ExtractionSchema`, `ExtractionField`, `ExtractionRecord`, `DetectedList`, `PaginationConfig`, `ExtractionProgress`, `ExtractionError`, `BrowserMessage`, `ExportConfig`), runtime message protocol, repository rules, and architectural integrity.
   - **Authority**: No other agent may alter shared contracts without formal review.

2. **Agent 2: Local Storage & Persistence Engine**
   - **Primary Owner**: `src/storage/` and IndexedDB repositories.
   - **Responsibilities**: Manages Dexie schemas, migrations, dataset storage, extraction templates, runs, and audit history. Ensures transactional integrity and zero data loss.

3. **Agent 3: DOM Inspector & Interactive Element Picker**
   - **Primary Owner**: `src/content/picker/` and visual overlay mechanisms.
   - **Responsibilities**: Implements DOM element hovering, selection outlines, breadcrumb path, and robust CSS/XPath selector generation. Ensures 100% style isolation using closed Shadow DOM.

4. **Agent 4: Repeated Element & Pattern Detection Engine**
   - **Primary Owner**: `src/core/detection/`.
   - **Responsibilities**: Implements sibling clustering, DOM tree structural similarity heuristics, list/table container detection, and candidate preview extraction. Proposes auto-discovered fields.

5. **Agent 5: Extraction Engine & Data Normalization**
   - **Primary Owner**: `src/core/extraction/`.
   - **Responsibilities**: Extracts structured records from detected containers using user-defined or auto-detected field definitions (text, attribute, href, src, innerHTML, regex, numbers). Handles text trimming, absolute URL resolution, data normalization, and canonical record identity with SHA-256 fingerprints. A missing field never removes a record unless the user chose that filter.

6. **Agent 6: Navigation, Pagination & Infinite Scroll Runner**
   - **Primary Owner**: `src/core/navigation/`.
   - **Responsibilities**: Automates multi-page harvesting: next-button clicking, URL pattern incrementing, and smooth infinite scroll loading with MutationObserver / network idle synchronization. Enforces delay throttles, stop conditions, and circuit breakers.

7. **Agent 7: Side Panel UI & Tab Lifecycle Controller**
   - **Primary Owner**: `entrypoints/sidepanel/` shell, `entrypoints/background.ts`, `src/background/`, active tab synchronization, and extension runtime messaging.
   - **Responsibilities**: Manages extension lifecycle, tab connection status, permission checks, and the `JobCoordinator`, which owns all job state.

8. **Agent 8: Data Grid & Column Management UI**
   - **Primary Owner**: `src/components/grid/` and spreadsheet features powered by TanStack Table.
   - **Responsibilities**: Provides column reordering, resizing, sorting, filtering, editing, row deletion, and summary metrics.

9. **Agent 9: Exporter & Data Pipeline**
   - **Primary Owner**: `src/core/export/`.
   - **Responsibilities**: Serializes extracted datasets into RFC 4180-compliant CSV and JSON (pretty or ndjson). Manages local downloads via Chrome Downloads / Blob URLs with filename sanitization.

10. **Agent 10: Resilience, Error Recovery & Integration Testing**
    - **Primary Owner**: `src/core/resilience/` and integration test suites (`tests/integration/`).
    - **Responsibilities**: Implements crash recovery, partial session persistence, the job lifecycle state machine, error diagnostics, and end-to-end integration tests.

---

## 3. Non-Negotiable Engineering Rules

1. **Read Before Modifying**: Read this `AGENTS.md` and all relevant architecture docs before making changes.
2. **Never Redesign Independently**: Stick to the established architecture, canonical contracts, and directory layout.
3. **Strict Test-Driven Development (TDD)**:
   - **RED**: Write a failing unit or integration test first. Confirm it fails for the expected reason.
   - **GREEN**: Write the minimal production code necessary to make the test pass.
   - **REFACTOR**: Clean, optimize, and format without breaking passing tests.
4. **No Unrun Test Claims**: Never claim a test passed without running `pnpm test` and verifying output.
5. **Quality Gates**:
   - `pnpm test` (All tests must pass with 0 failures)
   - `pnpm typecheck` (TypeScript strict mode must have 0 errors)
   - `pnpm build` (Clean build output without compiler warnings)
6. **No Fake / Placeholder Implementations**:
   - Every button must execute real logic or workflow state machines.
   - No mock data in production paths. No `TODO: implement later` stubbed functions.
7. **No `any` Types**:
   - TypeScript must remain strictly typed. If `unknown` is required, narrow it with Zod or type guards.
8. **Contract Integrity**:
   - Never change a shared TypeScript interface in `src/shared/contracts/` without architect review.
9. **Zero Destructive Overwrites**:
   - Respect other agents' code and modules. Integrate cleanly.
10. **Local-First & Privacy Preserving**:
    - No paid APIs, external cloud scrapers, remote AI calls, or data telemetry.
    - All processing and storage remain 100% inside Chromium and local IndexedDB.
11. **Browser Safety & Ethics**:
    - No remote executable code (Manifest V3 compliance).
    - No bypassing of website authentication, CAPTCHAs, or paywalls.
12. **Document Decisions**:
    - Log architecture changes and design decisions in `docs/DECISIONS.md`.
13. **One Production Path**:
    - The background `JobCoordinator` is the only writer of extraction data. The side panel sends commands and reads storage.
    - Never acknowledge a batch before its transaction has committed. Never report a save, export, delete or start as successful before it is confirmed.
    - Every source module must be reachable from a real entry point. `tests/integration/production-wiring.test.ts` enforces this.
    - A hash is never proof that two records are identical. Compare canonical records.
    - A missing field never removes a record unless the user explicitly configured that filter.

---

## 4. Repository Structure

```text
├── AGENTS.md                  # This document
├── docs/                      # Architecture, ADRs, PRD, and testing manuals
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md
│   ├── FILE_OWNERSHIP.md
│   ├── IMPLEMENTATION_STATUS.md
│   ├── CRITICAL_REMEDIATION_PLAN.md
│   ├── INTEGRATION_GUIDE.md
│   ├── PRODUCT_REQUIREMENTS.md
│   ├── TEST_MATRIX.md
│   ├── TEST_RUNBOOK.md
│   └── TEST_STRATEGY.md
├── entrypoints/               # WXT Entrypoints
│   ├── background.ts          # Service worker lifecycle & message routing
│   ├── content.ts             # Content script coordinator & element picker
│   └── sidepanel/             # Chrome Side Panel React application
│       ├── index.html
│       ├── main.tsx
│       └── App.tsx
├── src/
│   ├── background/            # JobCoordinator: owns job state, only writer of records
│   ├── components/            # Reusable React UI components
│   │   ├── common/            # Buttons, modals, inputs, badges
│   │   ├── grid/              # TanStack spreadsheet table
│   │   ├── picker/            # Side panel controls for element picker
│   │   ├── history/           # Saved datasets & export history
│   │   └── library/           # Projects, recipes, schemas, run history
│   ├── contracts/             # Runtime schemas & backward compatibility aliases
│   ├── core/
│   │   ├── detection/         # Repeated list and field pattern detectors
│   │   ├── extraction/        # DOM record extraction and normalization
│   │   ├── navigation/        # Pagination, next-button, infinite scroll
│   │   ├── export/            # CSV, JSON serializers
│   │   ├── state/             # Job lifecycle state machine
│   │   └── resilience/        # Error reporting
│   ├── shared/
│   │   └── contracts/         # CANONICAL CONTRACTS & ZOD SCHEMAS (OWNER: Agent 1)
│   │       ├── index.ts
│   │       ├── field.ts
│   │       ├── pagination.ts
│   │       ├── schema.ts
│   │       ├── project.ts
│   │       ├── record.ts
│   │       ├── detected-list.ts
│   │       ├── job.ts
│   │       ├── progress.ts
│   │       ├── error.ts
│   │       ├── message.ts
│   │       └── export.ts
│   ├── storage/               # Dexie DB instance, tables, repositories
│   ├── types/                 # Shared domain types & re-exports
│   └── utils/                 # DOM helpers, selector generators, crypto hashing
├── tests/
│   ├── contracts/             # Canonical contract verification suites
│   ├── unit/                  # Vitest unit test suites
│   ├── integration/           # Subsystem integration tests
│   ├── fixtures/              # Static HTML page samples for DOM testing
│   └── setup.ts               # Test environment setup
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── wxt.config.ts
└── tailwind.config.js
```

---

## 5. Working Conventions

- Use **PowerShell** commands matching the Windows host environment.
- Use **forward slashes** in source code imports (`import ... from '@/shared/contracts'`).
- Commit messages follow Conventional Commits: `feat(scope): ...`, `test(scope): ...`, `fix(scope): ...`.
