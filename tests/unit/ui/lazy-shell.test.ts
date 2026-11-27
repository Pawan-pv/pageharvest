import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The side panel chunk has a hard size cap (scripts/check-bundle-budget.mjs). Banners that
 * only appear after an interruption or an error must not be part of the chunk every panel
 * open pays for, so the shell loads them on demand (ADR-014).
 */
const app = readFileSync(path.resolve(__dirname, '../../../entrypoints/sidepanel/App.tsx'), 'utf8');

function staticImports(source: string): string[] {
  return [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)';/gms)].map((match) => match[1]);
}

describe('side panel shell: rarely shown banners are lazy', () => {
  it.each(['@/components/shell/RecoveryBanner', '@/components/common/ErrorBanner'])(
    'does not import %s statically',
    (module) => {
      expect(staticImports(app)).not.toContain(module);
      expect(app).toContain(`import('${module}')`);
    }
  );

  it('still imports the dashboard statically, so the panel opens without a second request', () => {
    expect(staticImports(app)).toContain('@/components/dashboard/MainDashboard');
  });
});
