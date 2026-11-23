# PageHarvest

PageHarvest is a 100% local-first Manifest V3 Chrome extension providing a complete 10-tool data extraction and web harvesting suite. It extracts web content directly in your browser without external servers, user accounts, tracking, or telemetry. All extracted data is stored privately in local IndexedDB.

## The 10-Tool Extraction Suite

PageHarvest includes 10 purpose-built tools accessible via the OLED ToolHub and the Full-Tab Workbench (`table.html`):

1. **List Extractor**: AI/heuristic auto-detection of repetitive card grids, product lists, and search results on the active page.
2. **Table Extractor**: Captures structured HTML tables into spreadsheets with header detection.
3. **Links Extractor**: Collects all internal and external URLs, anchors, and protocols.
4. **Page Extractor**: Batch-extracts OpenGraph metadata, meta tags, and JSON-LD schemas across multiple URLs.
5. **Sitemap Explorer**: Recursively parses XML sitemaps to explore, filter, and extract site URLs.
6. **Shopify Extractor**: Extracts public store catalogs and variants with native Shopify CSV format parity.
7. **Email Extractor**: Collects publicly visible contact emails with pattern verification.
8. **Social Link Extractor**: Discovers verified social media profiles (Twitter/X, LinkedIn, GitHub, YouTube, etc.).
9. **Page Text Extractor**: Extracts clean, readable article and post content without clutter.
10. **Bulk Image Downloader**: Discovers all images, previews sizes, and downloads selected assets with custom naming templates.

## Architecture & Privacy Guarantees

- **Zero Remote Servers & Zero Telemetry**: The extension runs strictly in-browser. No analytics, tracking, or telemetry.
- **Local IndexedDB**: All datasets, jobs, and checkpoints are persisted locally on your device via Dexie.
- **Single-Writer Background Pipeline**: Extracted batches commit cleanly to IndexedDB before acknowledgment, preventing data corruption across tab restarts.
- **Full-Tab Workbench**: Inspect, edit, clean (Smart Clean, dedup, regex), and export datasets with full keyboard shortcuts and Image Gallery view.
- **User-Initiated Downloads**: Spreadsheet exports (Excel XLSX, CSV, JSON, NDJSON) and bulk image downloads are saved directly to your local Downloads folder using Chrome's `downloads` API.

## Current validation

Status: **v1.0 Release Candidate**. Extraction, pagination across real page loads, crash recovery, single-writer background persistence, blocking first-run consent gate, and export pipelines are 100% verified through the production path, including in real Chromium and native Chrome for Testing. All bundle budgets (sidepanel <= 540 kB, content <= 280 kB, background <= 289 kB) are strictly enforced. See [CRITICAL_REMEDIATION_PLAN.md](docs/CRITICAL_REMEDIATION_PLAN.md) and [REAL_WORLD_TEST_BENCHMARK.md](docs/REAL_WORLD_TEST_BENCHMARK.md) for measured accuracy and architectural invariants.

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

## Releasing

[docs/STORE_LISTING.md](docs/STORE_LISTING.md) has what to enter in the Chrome Web Store dashboard (permission justifications, data disclosures) and the checklist to finish before submitting. The public privacy policy is [PRIVACY.md](PRIVACY.md). Both must stay true of the code: a unit test fails when a manifest permission has no justification in either (ADR-041).

`pnpm build` and `pnpm zip` first write `public/THIRD_PARTY_NOTICES.txt`, the licence texts of the open-source packages inside the package; commit it when it changes. `node scripts/generate-screenshots.mjs` makes the store screenshots from the built extension collecting a public practice site.

## Support

Questions or support: email `pawan.kumar.developer@gmail.com` or open an issue at <https://github.com/Pawan-pv/pageharvest/issues>.

## Architecture

Read [ARCHITECTURE.md](docs/ARCHITECTURE.md), [INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md), and [FILE_OWNERSHIP.md](docs/FILE_OWNERSHIP.md) before changing a subsystem. Canonical runtime contracts live under `src/shared/contracts/`. The background `JobCoordinator` owns all job state and is the only writer of extraction data; a batch is acknowledged only after its IndexedDB transaction commits. The side panel is a view of stored state, so it can close at any time. Extraction and detection run locally in the page content script, and overlays use a closed Shadow DOM.
