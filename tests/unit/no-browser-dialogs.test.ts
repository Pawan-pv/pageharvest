import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** A call to the browser's own alert, confirm or prompt: not a method on something else. */
const BROWSER_DIALOG = /(^|[^.\w])(?:window\.|globalThis\.)?(alert|confirm|prompt)\s*\(/;
/** A method or function that happens to be called confirm, such as the picker's. */
const DECLARATION = /^\s*(public|private|protected|static|async|function|export)\b/;

/**
 * The panel asks its questions in its own dialogs. A browser dialog is not reliably shown
 * for a side panel, names the extension by its address, and blocks every other event while
 * it is open. The grid used confirm() until ADR-042; this keeps it from coming back.
 */
describe('No browser alert, confirm or prompt in the extension', () => {
  const files = [...sourceFiles(resolve(ROOT, 'src')), ...sourceFiles(resolve(ROOT, 'entrypoints'))];

  it('reads the source files it means to', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => file.endsWith('DataTable.tsx'))).toBe(true);
  });

  it('finds none', () => {
    const found: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, index) => {
          const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
          if (BROWSER_DIALOG.test(code) && !DECLARATION.test(code)) {
            found.push(`${file.slice(ROOT.length + 1)}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(found).toEqual([]);
  });

  it('would catch one', () => {
    expect(BROWSER_DIALOG.test("if (!confirm('Delete?')) return;")).toBe(true);
    expect(BROWSER_DIALOG.test("window.alert('Saved');")).toBe(true);
    expect(BROWSER_DIALOG.test('onConfirm: () => this.confirm(),')).toBe(false);
    expect(BROWSER_DIALOG.test('await workflow.confirmListCandidate(list);')).toBe(false);
  });
});
