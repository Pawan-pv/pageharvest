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
