# PageHarvest Repair Plan

> Superseded by [CRITICAL_REMEDIATION_PLAN.md](CRITICAL_REMEDIATION_PLAN.md). Kept as history; the mechanisms it describes, including `URL_PAGINATION_READY`, no longer exist.

## Completed in this audit

1. Reconciled legacy UI/storage types with canonical Zod contracts without weakening the canonical schemas.
2. Fixed strict TypeScript errors in messaging, permissions, Dexie collections, tab events, and test fixtures.
3. Added the content-workflow coordinator and wired real `DETECT_REPEATED_ELEMENTS`, `DETECT_FIELDS`, `EXTRACT_RECORDS`, pagination-step, and scroll-step handlers into the content script.
4. Removed synthetic picker/list/field/record fallbacks from the side-panel workflow. Communication failures now produce an error state.
5. Persisted content-script extraction progress into the active Dexie dataset.
6. Preserved extended extractors such as `price`, `link`, `image`, and `date` during internal extraction-field normalization.
7. Removed production `any` types from the touched platform/extraction paths.
8. Added the `downloads` permission required by the documented Chrome Downloads export path.
9. Added integration, regression, service, and live Chromium coverage for the repaired paths.
10. Added durable URL-pagination sessions with recipe/field/project/dataset/record/hash checkpoints, expected-URL validation, cancellation, max-page and empty-page termination, and service-worker-store recreation coverage.
11. Added background `URL_PAGINATION_READY` resume routing and a real multi-document Chromium E2E flow.
12. Added ESLint 10 flat configuration and a clean `pnpm lint` gate; fixed React act warning causes in affected tests.
13. Split the side-panel grid/history/settings views into lazy chunks, reducing the initial side-panel bundle below the warning threshold.

## Remaining prioritized work

### P0 — release gate

- Completed for this audit: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e` (6/6). The initial side-panel chunk is 471.07 KB and the build emits no size warning.

### P1 — navigation correctness

- Completed: URL-template checkpoint/resume handoff between content script, background worker, and durable storage, including a browser E2E against three actual fixture documents.
- Remaining optional expansion: add separate browser workflows for next-link and infinite-scroll UI orchestration; their core engines and content handlers are already covered by integration tests.

### P1 — user-invoked browser context

- Add a browser E2E path that opens the native side panel through the extension action/user gesture. Keep `activeTab` least privilege unless product requirements demonstrate that a persistent `tabs` permission is necessary.
- Add automated picker click/confirm coverage in a real page, not only unit-level overlay tests.

### P2 — engineering gates

- Completed: ESLint configuration/script and React act warning cleanup.
- Remaining manual release check: native toolbar action/user-gesture side-panel activation, tab switching, close/reopen, and reload behavior.
- Existing persistence E2E still uses direct IndexedDB setup for its storage-isolation scenario; the live extraction E2E now covers real content-script extraction and URL pagination.
