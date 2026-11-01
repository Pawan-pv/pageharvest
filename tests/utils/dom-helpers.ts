import fs from 'fs';
import path from 'path';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/pages');

/**
 * Loads an HTML fixture file and replaces current document body with its contents.
 */
export function loadFixtureHtml(fixtureFilename: string): HTMLElement {
  const filePath = path.join(FIXTURES_DIR, fixtureFilename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture file not found: ${filePath}`);
  }
  const html = fs.readFileSync(filePath, 'utf-8');
  document.documentElement.innerHTML = html;
  return document.body;
}

/**
 * Creates a sandbox container in JSDOM document body.
 */
export function createSandbox(htmlSnippet: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'test-sandbox';
  container.innerHTML = htmlSnippet;
  document.body.appendChild(container);
  return container;
}

/**
 * Clears document body and removes any sandboxes.
 */
export function cleanupSandbox(): void {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
}
