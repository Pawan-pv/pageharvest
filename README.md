# PageHarvest

PageHarvest is a local-first Manifest V3 Chrome extension for selecting repeated page structures, extracting normalized records, editing them in a side-panel grid, and exporting CSV or JSON without sending page data to a remote service.

## Current validation

Status: **functional MVP**. Extraction, pagination across real page loads, recovery and export are tested through the production path, including in real Chromium. The real toolbar and side panel are verified automatically in Chrome for Testing. It is not yet a release candidate: no independent review has happened, and real-website testing covers only two scraping practice sites. The release gate runs on GitHub Actions. See [CRITICAL_REMEDIATION_PLAN.md](docs/CRITICAL_REMEDIATION_PLAN.md) for evidence and open items, and [REAL_WORLD_TEST_BENCHMARK.md](docs/REAL_WORLD_TEST_BENCHMARK.md) for measured accuracy.

## Development commands

```powershell
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e

# Complete release-candidate gate
pnpm test:release
```

The fixture server used by browser tests is started automatically by Playwright. Playwright intentionally does not claim toolbar coverage: `pnpm test:release:chrome` clicks the real toolbar on Windows, and the manual procedure for branded Chrome is in [FEATURE_AUDIT.md](docs/FEATURE_AUDIT.md).

`pnpm test:release` runs typecheck, lint, unit/integration tests, the production build, headed Chromium unpacked-extension workflows, and the isolated native-Chrome probe. Use `pnpm test:release:unit`, `pnpm test:release:e2e`, or `pnpm test:release:chrome` for one layer. Reports are written to [artifacts/release-test-report.md](artifacts/release-test-report.md) and [artifacts/release-test-report.json](artifacts/release-test-report.json), with detailed logs and browser diagnostics under `artifacts/release-testing/`. Exit code `0` means PASS, `1` means FAIL, and `3` means BLOCKED.

## Architecture

Read [ARCHITECTURE.md](docs/ARCHITECTURE.md), [INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md), and [FILE_OWNERSHIP.md](docs/FILE_OWNERSHIP.md) before changing a subsystem. Canonical runtime contracts live under `src/shared/contracts/`. The background `JobCoordinator` owns all job state and is the only writer of extraction data; a batch is acknowledged only after its IndexedDB transaction commits. The side panel is a view of stored state, so it can close at any time. Extraction and detection run locally in the page content script, and overlays use a closed Shadow DOM.
