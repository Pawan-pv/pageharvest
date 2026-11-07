# PageHarvest Test Runbook

This runbook provides step-by-step instructions for running, debugging, and maintaining the PageHarvest automated test suite.

---

## 1. Prerequisites & Environment Setup

Ensure Node.js and pnpm are installed:
```powershell
node -v   # Expected: v20+ or v24+
pnpm -v   # Expected: v9+
```

Install workspace dependencies:
```powershell
pnpm install
```

---

## 2. Standard Test Execution

### 2.1 Run All Tests (Single Pass)
Executes all unit, contract, and integration tests:
```powershell
pnpm test
```
*Expected Output:*
```text
✓ tests/contracts/canonical-contracts.spec.ts (12 tests)
✓ tests/unit/contracts.test.ts (11 tests)
✓ tests/unit/navigation.test.ts (7 tests)
✓ tests/unit/exporter.test.ts (6 tests)
✓ tests/unit/selector.test.ts (5 tests)
✓ tests/unit/detection.test.ts (5 tests)
✓ tests/unit/dom.test.ts (4 tests)
...
```

### 2.2 Run Tests in Watch Mode (Active TDD Development)
Automatically re-runs affected tests on file save:
```powershell
pnpm test:watch
```

### 2.3 Run a Specific Test Suite
Target individual subsystems when working on a specific feature:
```powershell
# Run only canonical contracts
pnpm vitest run tests/contracts/canonical-contracts.spec.ts

# Run only extraction engine tests
pnpm vitest run tests/unit/extractor.test.ts

# Run only navigation & pagination tests
pnpm vitest run tests/unit/navigation.test.ts

# Run only storage & Dexie tests
pnpm vitest run tests/unit/storage.test.ts

# Run only exporter tests
pnpm vitest run tests/unit/exporter.test.ts
```

---

## 3. Coverage Analysis & Reporting

Generate coverage metrics via Vitest v8 provider:
```powershell
pnpm test:coverage
```
*Artifacts Generated:*
- Text table in console.
- Interactive HTML report at `./coverage/index.html`.
To view coverage in browser:
```powershell
Start-Process ./coverage/index.html
```

---

## 4. TypeScript Strict Compilation Gate

Verify strict typing across all files without emitting JavaScript:
```powershell
pnpm typecheck
```
*Criteria:* 0 errors.

---

## 5. Extension Build & Packaging Verification

Verify that WXT can cleanly compile the extension bundle:
```powershell
pnpm build
```
*Expected Output Directory:* `.output/chrome-mv3/` containing `manifest.json`, `background.js`, `content-scripts/`, and `sidepanel/`.

---

## 6. Debugging & Troubleshooting Guide

### Issue: "Cannot find package 'fake-indexeddb'"
- **Cause**: Node modules out of sync.
- **Fix**: Run `pnpm install` with `.npmrc` configured with `shamefully-hoist=true`.

### Issue: "Timeout of 5000ms exceeded"
- **Cause**: Asynchronous test did not resolve or await a Dexie/MutationObserver promise.
- **Fix**: Ensure test functions are marked `async` and use `await db.table.toArray()`.

### Issue: "Element is not in the document"
- **Cause**: DOM elements created in JSDOM were not attached to `document.body`.
- **Fix**: Always call `document.body.appendChild(element)` or set `document.body.innerHTML` in `beforeEach`.

## 7. Lint and sequential browser verification

Run the repository ESLint configuration:

```powershell
pnpm lint
```

The command must finish with 0 errors and 0 warnings. Generated `.wxt/` declarations and build output are excluded; source, entrypoints, and tests remain covered.

Build first, then run the browser suite in a separate command. Running both concurrently can race while WXT replaces `.output/chrome-mv3/` and produce `ERR_FILE_NOT_FOUND` for extension pages.

```powershell
pnpm build
pnpm test:e2e
```

The production suite is `tests/e2e/production-workflows.spec.ts`. It opens visible browser windows, restarts a browser profile, and commits 50,000 rows through real IndexedDB, so allow several minutes.

The URL-pagination E2E starts on `url-page-1.html`, moves through `url-page-2.html` as a real page load, and completes on the empty `url-page-3.html`. The background coordinator resumes each page from its stored checkpoint when the new content script sends `CONTENT_READY`, and the test reads the rows back from IndexedDB.

---

## 8. Automated release-candidate verification

The release runner is the reproducible gate for a release candidate. It preserves each command's output and writes a machine-readable plus Markdown summary:

```powershell
# Complete layered gate (typecheck, lint, Vitest, build, Playwright, native probe)
pnpm test:release

# Individual layers
pnpm test:release:unit
pnpm test:release:e2e
pnpm test:release:chrome
pnpm test:release:report
```

The exit-code contract is deterministic: `0` means every requested check passed, `1` means at least one check failed, and `3` means no check failed but a requested capability is blocked by the host environment.

The Playwright release layer loads the production `.output/chrome-mv3` artifact into a dedicated temporary profile and exercises the real content script, side-panel UI, picker, extraction, persistence, exports, heterogeneous fixtures, error response, and infinite-scroll workflow. It captures trace-on-failure, screenshots/video-on-failure, console/page/request diagnostics, and export attachments.

Artifacts are written to:

- `artifacts/release-test-report.json` and `artifacts/release-test-report.md` — latest aggregate result.
- `artifacts/release-testing/<run>/logs/` — command logs.
- `artifacts/release-testing/playwright/` — browser traces, screenshots, videos, diagnostics, and export evidence.
- `artifacts/release-testing/<run>/native-chrome-diagnostics.json` — what the native check observed at each step, with `native-side-panel.png` and the toolbar control trees beside it.

Run `pnpm build` before a standalone `pnpm test:e2e`; do not run build and browser tests concurrently.

## 9. Remediation validation

Durable jobs, isolation, recovery and pagination:

```powershell
pnpm vitest run tests/integration/job-persistence.test.ts tests/integration/job-isolation.test.ts tests/integration/job-recovery.test.ts tests/integration/job-pagination.test.ts
```

Everything reachable from an entry point:

```powershell
pnpm vitest run tests/integration/production-wiring.test.ts
```

Browser scenarios, one at a time. The tests share a browser in serial mode, so a failure stops those after it; use `--grep` to run a later one alone:

```powershell
pnpm build
pnpm exec playwright test tests/e2e/production-workflows.spec.ts --grep "C: a browser restart"
```

Regenerate icons after changing their artwork:

```powershell
node scripts/generate-icons.mjs
```

### GitHub Actions

`.github/workflows/release-gate.yml` runs the complete gate on every push and pull request to `main`, and on demand. It has its own memory, and it runs the browser tests on a virtual display with `xvfb-run`. The report is on the run's summary page, and the report and failure evidence are in its `release-report` artifact.

The `release-gate` job runs on Linux with `pnpm test:release:automated`. The `native-side-panel` job runs on Windows with `pnpm test:release:chrome`, clicks the real toolbar, and uploads a screenshot and its evidence. BLOCKED fails that job, so a green run means the toolbar was verified, in Chrome for Testing.

### Low memory

The complete gate needs more free memory than the browser and test workers leave on an 8 GB machine with other applications open, and the system can stop it. Close other heavy applications first. If it still does not fit, run the layers one at a time, with fewer test workers:

```powershell
pnpm vitest run --pool=forks --poolOptions.forks.maxForks=2
pnpm test:release:e2e
```

A layered run is not the same evidence as one complete gate, so report it as such.

## 10. Accuracy and performance

```powershell
pnpm build
pnpm exec playwright test tests/e2e/extraction-accuracy.spec.ts
pnpm benchmark:sites
pnpm benchmark:performance
```

The site benchmark visits third-party practice sites, so run it occasionally, not in a loop. See [REAL_WORLD_TEST_BENCHMARK.md](REAL_WORLD_TEST_BENCHMARK.md) and [PERFORMANCE_AND_COVERAGE.md](PERFORMANCE_AND_COVERAGE.md). Coverage needs more memory than `pnpm test`, and may not finish on an 8 GB machine with other applications open. Pull requests measure it on GitHub.

## 11. Native Chrome side-panel verification

On Windows, this runs the real toolbar click locally. It takes over the mouse while it runs:

```powershell
pip install pywinauto==0.6.8 pillow==10.4.0
pnpm exec playwright install chromium
pnpm build
pnpm test:release:chrome
```

Without pywinauto, or off Windows, it reports BLOCKED. Set `PAGEHARVEST_CHROME_PATH` to test another build; branded Chrome did not load the unpacked extension.

The manual steps remain for branded Chrome.

Playwright opens the extension page directly and cannot reliably click the browser toolbar action. Do not treat that E2E as native user-gesture evidence. For the actual side-panel API path:

1. Run `pnpm build`.
2. Open `chrome://extensions`, enable Developer mode, and load unpacked `C:\myProject\extension\.output\chrome-mv3`.
3. Pin PageHarvest, open a fixture page, and click the PageHarvest toolbar icon.
4. Verify the side panel, active tab context, picker/detection/extraction communication, closing and reopening during a running job, tab switching, and URL-pagination resume.

Record this as a manual result; never mark it passed based only on `chrome.sidePanel` mocks or a direct `sidepanel.html` navigation.
