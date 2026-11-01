# PageHarvest Feature Audit

Audit date: 2026-11-02. Baseline: `b0cf556` plus the uncommitted worktree. Full findings and evidence are in [CRITICAL_REMEDIATION_PLAN.md](CRITICAL_REMEDIATION_PLAN.md).

Assessment: **functional MVP**.

| Area | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Manifest V3, icons, ZIP | PASS | `manifest-assets.test.ts`, E2E "installs", ZIP inspected | A draft store screenshot exists in `store-assets/`, showing test data |
| Durable persistence | PASS | `job-persistence.test.ts`, E2E A | Tested with the panel opened as a tab |
| Job isolation and cancellation | PASS | `job-isolation.test.ts`, E2E B | Simultaneous tabs are concurrent only in integration tests |
| Recovery | PASS | `job-recovery.test.ts`, E2E C | Real browser close and relaunch |
| Next button across documents | PASS | `job-pagination.test.ts`, E2E "Next Button" | |
| Infinite scroll limits and progress | PASS | `scroll-limits.test.ts`, E2E K | |
| URL template | PASS | `job-pagination.test.ts`, E2E J | |
| Pause, finish, cancel | PASS | E2E "Pause, Finish and Cancel" | |
| Record preservation | PASS | `record-preservation.test.ts`, E2E G | |
| Deduplication | PASS | `job-deduplication.test.ts`, E2E H | Forced hash collisions in integration only |
| CSV integrity | PASS | `csv-integrity.test.ts`, E2E I | |
| Grid edits | PASS | `grid-persistence.test.tsx`, E2E "grid edits" | |
| Settings | PASS | `settings-persistence.test.tsx`, E2E D | |
| Projects, recipes, schemas, history | PASS | `repository-wiring.test.ts`, `panel-workflow.test.tsx`, E2E E, F | |
| Picker and closed Shadow DOM | PASS | `overlay-closed-shadow.test.ts`, E2E "picker" | |
| Production wiring | PASS | `production-wiring.test.ts` | Fails if a module is unreachable from an entry point |
| Auto-detect on real page layouts | PASS | `detection-real-pages.test.ts`, trial on two scraping practice sites | Commercial sites not tried |
| Native toolbar and real side panel | BLOCKED | | Manual procedure below has not been run |
| Complete release gate as one run | NOT COMPLETED | | Stopped by the system for low memory; every layer passed separately |

## Native Chrome Side Panel manual verification

1. Run `pnpm build` and open `chrome://extensions` in a headed Chrome profile.
2. Enable Developer mode, choose **Load unpacked**, and select `C:\myProject\extension\.output\chrome-mv3`.
3. Pin PageHarvest, open `http://127.0.0.1:3456/simple-grid.html` (start `pnpm serve:fixtures` if needed), and click the PageHarvest toolbar action. Confirm the native side panel opens with the active fixture tab.
4. Run Auto-Detect Lists, confirm fields, start extraction, and verify records appear in the grid.
5. On `long-scroll.html`, start an Infinite Scroll job and close the side panel mid-run. Reopen it and confirm the job is still running and its rows are present.
6. Switch tabs, reload the fixture, and run a URL Template job on `catalog-1.html` with `http://127.0.0.1:3456/catalog-{page}.html`.
7. This procedure is the evidence for toolbar behavior. Playwright opens `sidepanel.html` directly and does not claim it.
