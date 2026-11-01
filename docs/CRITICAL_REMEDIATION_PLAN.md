# PageHarvest Critical Remediation Plan & Acceptance Report

Date: 2026-11-02. Baseline commit: `b0cf556`. The remediation is in `7f532cc` and `5888574` on `main`.

## Release decision: FUNCTIONAL MVP

Every P0, P1 and P2 finding below is fixed and tested on the production path, including in real Chromium. It is not called a release candidate yet, because these are still open:

1. The native toolbar and real side panel have not been exercised (BLOCKED, see Remaining issues).
2. Verification was done by the same author as the fixes, so it is not the independent verification the release bar asks for.
3. Real-website evidence covers two public scraping practice sites only, not commercial sites.

## Findings

Priority: P0 data loss or cross-job corruption. P1 extraction correctness or broken required functionality. P2 architecture, settings, assets, maintainability.

"Reproduced" means the failure was observed by running it. "Read" means it was confirmed in the code and its tests failed before the fix.

| # | P | Finding | Confirmed? | Root cause | Main files changed | Regression tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | P0 | Closing the panel loses rows | Read | The only writer of records was a React hook | `src/background/job-coordinator.ts`, `entrypoints/background.ts`, `src/hooks/useExtractionWorkflow.ts` | `job-persistence.test.ts`; E2E A | PASS |
| 2 | P0 | Stale messages can reach another job | Read | Progress messages had no identity; jobs had no generation | `src/shared/contracts/message.ts`, `job.ts`, `job-coordinator.ts` | `job-isolation.test.ts`; E2E B | PASS |
| 3 | P0 | Pause, Finish and Cancel did not stop the page | Reproduced: rows went 6 to 15 after each | No cancel message existed; `signal` was never passed | `workflow-coordinator.ts`, `navigation/engine.ts`, `runner.ts` | `job-pagination.test.ts`, `scroll-limits.test.ts`; E2E "Pause, Finish and Cancel" | PASS |
| 4 | P0 | Next Button stops after page 1 on ordinary links | Reproduced: 3 of 6 rows, then an error | The click destroyed the run, and only URL jobs could resume | `job-coordinator.ts`, `runner.ts`, `engine.ts` | `job-pagination.test.ts`; E2E "Next Button" and H | PASS |
| 5 | P0 | Grid edits were not saved | Reproduced: deleted column returned | `App.tsx` passed no persistence callback, and props reset the grid | `DataTable.tsx`, `App.tsx`, `dataset-repository.ts` | `grid-persistence.test.tsx`; E2E "grid edits" | PASS |
| 6 | P0 | Records silently dropped for a missing field | Read | Discovery set `required` on the first field; errors were discarded | `detection/fields.ts`, `extraction/extractor.ts`, `FieldEditorRow.tsx` | `record-preservation.test.ts`; E2E G | PASS |
| 7 | P0 | Hash collisions drop real rows | Reproduced with a real pair: "Product 1079599", "Product 1262382" | Equality was 32-bit FNV-1a only | `extraction/record-identity.ts`, `duplicate-detector.ts`, `job-coordinator.ts` | `dedup-collision.test.ts`, `record-identity.test.ts`, `job-deduplication.test.ts`; E2E H | PASS |
| 8 | P1 | Recovery could never trigger | Read | `persistJobState` had no callers | `job-coordinator.ts`, `extraction-machine.ts`, `App.tsx`; removed `job-recovery.ts` | `job-recovery.test.ts`, `app-integration.test.tsx`; E2E C | PASS |
| 9 | P1 | URL template had no UI; sessions never read or cleaned | Read | Session code existed with no entry point | `PaginationConfigPanel.tsx`, `url-paginator.ts`, `runner.ts`; removed `url-pagination-session.ts` | `job-pagination.test.ts`, `panel-workflow.test.tsx`; E2E J | PASS |
| 10 | P1 | `maxPages` overrides Max Scrolls; "Page 2 of 1" | Reproduced both | One limit and one counter served two dimensions | `engine.ts`, `ExtractionProgressView.tsx`, contracts | `scroll-limits.test.ts`, `extraction-workflow.test.tsx`; E2E K | PASS |
| 11 | P1 | CSV changes `-5` | Reproduced | Every leading `+` or `-` was treated as a formula | `export/exporter.ts` | `csv-integrity.test.ts`; E2E I | PASS |
| 12 | P1 | Settings "saved" without saving | Read | The button only showed a message | `SettingsView.tsx`, `settings-repository.ts`, `db.ts` | `settings-persistence.test.tsx`; E2E D | PASS |
| 13 | P1 | Projects, jobs, schemas, recipes, history unused | Read | Repositories existed with no production caller | `src/storage/repositories/*`, `components/library/LibraryView.tsx`, `job-coordinator.ts` | `repository-wiring.test.ts`, `panel-workflow.test.tsx`; E2E E, F | PASS |
| 14 | P1 | Saved rows reopen out of order | Reproduced: 1,5,3,2,4,0 | Sort key tied, falling back to hash-based IDs | `storage/db.ts` | `dataset-order.test.ts`; E2E "saved rows" | PASS |
| 15 | P1 | Picker left open blocks page clicks; its cancel was ignored | Read | Picker messages were outside the protocol and dropped | `messenger.ts`, `message.ts`, `useExtractionWorkflow.ts`, `content.ts` | E2E "picker", "Escape" | PASS |
| 16 | P2 | Open shadow root | Reproduced | `mode: 'open'` | `content/picker/overlay.ts` | `overlay-closed-shadow.test.ts`; E2E "picker" | PASS |
| 17 | P2 | No icons in manifest | Reproduced | None existed | `public/icon/*`, `wxt.config.ts`, `scripts/generate-icons.mjs` | `manifest-assets.test.ts`; E2E "installs"; ZIP inspected | PASS |
| 18 | P2 | Modules used only by tests | Read | See ADR-020 for the decision on each | See ADR-020 | `production-wiring.test.ts` | PASS |
| 20 | P0 | Auto-detect extracts the navigation instead of the data | Reproduced on real sites: 0 of 60 books, 0 of 30 quotes, job still COMPLETED | Ranked by size alone; only scanned list-like class names; `ul > li` also matched the menu | `detection/detector.ts`, `detection/fields.ts` | `detection-real-pages.test.ts`; real-site trial | PASS |
| 21 | P1 | A healthy job marked interrupted while starting | Reproduced on CI: 0 rows, "The page stopped responding" | The panel's check could ask the page before the page had been told to run the job, and a slow transaction made the job look quiet | `background/job-coordinator.ts` | `job-recovery.test.ts`; E2E I on CI | PASS |
| 19 | P2 | Two message protocols | Read | `BrowserMessage` was documented, `ExtensionMessage` was used | `shared/contracts/message.ts`, `contracts/messages.ts` | `canonical-contracts.spec.ts`, `messages.test.ts` | PASS |

Finding 20 was found by the real-site trial after every fixture test had passed. Finding 21 was found by the first release gate run on GitHub Actions, and depends on database timing. Findings 3, 4, 5, 14, 20 and 21 were not in the requested list. They came from the earlier reproduction and are included because they lose or corrupt data.

## How the requirements were met

**Persistence.** Website, content script, `JobCoordinator`, IndexedDB, then the panel reads storage. Rows, job counters and checkpoint commit in one transaction, and the acknowledgement follows it. Fingerprints are computed first, because awaiting Web Crypto would end the transaction.

**Identity and cancellation.** Every extraction message carries job, project, dataset, run and generation; batches also carry a sequence. Checks happen inside the writing transaction, so cancellation and batch acceptance cannot interleave. Ending or resuming a job replaces its generation.

**Recovery.** One lifecycle in `extraction-machine.ts`. CREATED to RUNNING, and INTERRUPTED to RECOVERABLE, happen inside single transactions. Terminal states delete the checkpoint and write history together. Abandoned sessions expire after `retentionDays`.

**Records.** A missing value never removes a record. Only the explicit "Skip rows where this column is empty" option filters, and filtered rows are counted. Detected, kept, missing, filtered, failed and duplicate counts appear on progress, results and history.

**Deduplication.** Canonical record equality; SHA-256 only finds candidates. The algorithm version is stored per job.

**CSV.** Value-aware protection, in ADR-021. Documented transformation: formula-like text gets a `' ` prefix. Nothing else is changed.

**Module decisions.** ADR-020 lists each one.

## Production persistence matrix

See [storage-schema.md](architecture/storage-schema.md), section 2.

## Test results (final code)

| Gate | Result | Evidence |
| --- | --- | --- |
| Unit and integration | PASS | 670 tests in 64 files |
| TypeScript | PASS | `tsc --noEmit` on the final code |
| ESLint | PASS | `eslint .` on the final code |
| Production build | PASS | `wxt build` on the final code |
| ZIP package | NOT RE-RUN | Last made before the detection fix (310.8 kB; manifest and four icons inspected). Run `pnpm zip` before uploading. |
| Playwright in real Chromium | PASS | 33 of 33 on Windows and on Linux under `xvfb`, including tests A to K |
| Public practice sites | PASS | See the trial below |
| Actual installation | PASS | Unpacked load in Chromium with manifest and icon checks |
| Complete release gate as one run | PASS except the native check | [GitHub Actions run](https://github.com/Pawan-pv/pageharvest/actions/runs/41360888220) on Linux, commit `5888574`: 5 checks passed, native Chrome BLOCKED |
| Native toolbar side panel | BLOCKED | No desktop automation tool (pywinauto or AutoHotkey) is installed, and the manual procedure has not been run |

## Real-site trial

The built extension ran on two public sites made for scraping practice, using auto-detect with no manual selectors. The expected values were fetched separately from the pages.

| Site and mode | Rows stored | Expected values found | Columns found |
| --- | --- | --- | --- |
| books.toscrape.com, Next Button, 3 pages | 60 | 60 of 60 | Title, Link, Image, Price, Action |
| books.toscrape.com, URL Template, 3 pages | 60 | 60 of 60 | Title, Link, Image, Price, Action |
| quotes.toscrape.com, Next Button, 3 pages | 30 | 30 of 30 | Link, Text, Author |
| quotes.toscrape.com/scroll, 3 scrolls | 20 and 30 in two runs | All the page had loaded | Text, Author |
| books.toscrape.com, one category page | 11 | 11 of 11 | Title, Link, Image, Price, Action |

Scrolling loads different amounts between runs because each step moves 800 px and the site loads when near the bottom. In both runs the rows stored equaled the items on the page. Before the fix, the same trial stored navigation links and reported COMPLETED.

Real sites with logins, heavy scripts, or anti-bot measures have not been tried.

## Requested E2E scenarios

| Test | Status | Notes |
| --- | --- | --- |
| A Panel closure | PASS | Closed and reopened, and rows committed while closed. Also stops the real service worker mid-job. |
| B Cancelled job isolation | PASS | The late message comes from the real content-script world |
| C Interrupted recovery | PASS | Real browser close and relaunch on the same profile |
| D Settings | PASS | |
| E Recipes | PASS | |
| F History | PASS | |
| G Missing fields | PASS | |
| H Collisions | PASS, in two parts | A real FNV collision in the browser. A forced identical hash only in integration tests, because forcing it in the browser would need a production backdoor. |
| I CSV | PASS | Reads the downloaded file |
| J URL template | PASS | Through the UI, with interruption and recovery |
| K Scrolling | PASS | Counts actual `scrollBy` calls |
| 50,000 records | PASS | Real IndexedDB, batches delivered from the content-script world. The grid was not opened with 50,000 rows. |
| Two tabs simultaneously | PARTIAL | Concurrent in integration tests. The browser test overlaps the panels but runs the jobs one after the other. |
| Cancellation during persistence | Integration only | |
| Expected page never loads | Integration only | |

## TDD record

The brief asked for strict RED, GREEN, REFACTOR on every defect. That was followed where the code already existed, and not for the new coordinator:

- **RED first, observed failing on unmodified code:** CSV, record preservation, scroll limits, row order, closed shadow root, manifest assets, real hash collision, settings persistence, grid persistence. Pause, Finish, Cancel, Next Button and grid behavior were also reproduced first in the real extension.
- **Tests written after the code:** `JobCoordinator`, `runNavigationJob` and the library views were written first, because their contracts had to exist before tests could compile. These tests were not seen failing against a real defect, so they prove less than the list above.

## Test changes

No assertion was weakened to pass. These changed, and each is a deliberate decision to review:

| Change | Why |
| --- | --- |
| `tests/unit/platform-recovery.test.ts` removed | Tested the removed snapshot. Replaced by `job-recovery.test.ts`. |
| `tests/unit/url-pagination-session.test.ts` removed | Tested the removed store. Replaced by `job-pagination.test.ts` and `job-recovery.test.ts`. |
| `state-machine.test.ts` rewritten | Lifecycle states replace UI states. Inspection states are gone from the machine because they are not job states. |
| `navigation.test.ts` | Step helpers with no caller were removed; the same behavior is tested through the engine. |
| `duplicate-detection.test.ts` | **Behavior change:** rows differing only by letter case are now distinct. |
| `detection.test.ts`, `content-workflow.test.ts` | **Behavior change:** the first field is no longer required. |
| `platform-permissions.test.ts` | `requestPermission` removed; it had no caller. |
| `dom.test.ts` | The FNV helper was removed. |
| `storage-enterprise.test.ts` | The `theme` setting was removed; the same persistence is asserted on a setting that exists. |
| E2E 5, 6 and E | Now run through real jobs, because the direct messages no longer exist. |

Also removed: `vitest.setup.ts`, which nothing referenced.

## Behavior changes to confirm

1. "Cancel & Discard" is now "Cancel Job", and keeps saved rows, as this brief requires. Delete the dataset to remove them.
2. Single-page jobs keep identical rows, because each element is its own row. Multi-page jobs remove them and count them.
3. Letter case now makes rows distinct.

## Remaining issues

**Blocking a release candidate**

- The native toolbar and real side panel are untested. Follow `docs/TEST_RUNBOOK.md`, section 10.
- Independent review, and a trial on real commercial websites.

**Known limitations**

- The panel follows one job at a time. Another running job continues, and its results appear in Datasets, but there is no switcher.
- A recovered infinite-scroll job scrolls again from the top, because the feed reloads.
- An HTTP 404 page with HTML is treated as an empty page, so the job completes with `empty_page` rather than failing.
- The page-load check uses a timer in the service worker. If the worker stops first, the check happens when the panel next opens.
- Auto-detect shows only its top choice, with no list of alternatives. If it picks wrong, use the element picker.
- Items that are bare text with no child elements get no automatic column, so add one by hand.
- Each scroll moves 800 px, so a set number of scrolls can load different amounts on sites that load near the bottom.
- The CSV is built as one string, so very large exports use memory proportional to their size.
- Each picker hover and each page load wakes the service worker.
- The initial side panel chunk is 496.65 kB, just under the 500 kB warning.
- NFR performance targets have not been measured.

**For the Chrome Web Store**

The package meets the icon requirement. `store-assets/screenshot-1280x800.png` is a draft of the required screenshot: it shows test data and `127.0.0.1` links, so replace it with a real example before submitting. A 440x280 promotional image and a 1400x560 marquee are optional and were not created.
