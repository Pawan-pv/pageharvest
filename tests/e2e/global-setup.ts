import { prepareTestExtension } from '../../scripts/testing/test-extension.mjs';

/**
 * Every spec loads the test copy of the production build, which already holds the
 * fixture site's grant (ADR-037): Playwright cannot answer Chrome's permission bubble.
 */
export default function globalSetup(): void {
  prepareTestExtension();
}
