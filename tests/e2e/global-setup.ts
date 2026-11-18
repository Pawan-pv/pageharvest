import { prepareTestExtension } from '../../scripts/testing/test-extension.mjs';

/**
 * Every spec loads the test copy of the production build. The manifest holds site
 * access from install (ADR-040), so no spec meets a permission bubble.
 */
export default function globalSetup(): void {
  prepareTestExtension();
}
