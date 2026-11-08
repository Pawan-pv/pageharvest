import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  hooks: {
    'config:resolved': (wxt) => {
      wxt.config.alias['@'] = path.resolve(__dirname, 'src');
      wxt.config.alias['~'] = path.resolve(__dirname, '.');
    }
  },
  vite: () => ({
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 550,
      rollupOptions: {
        // Zod v4 ships @__PURE__ annotations Rollup cannot interpret; the comments
        // are stripped and output is unaffected. Silence only these, by file.
        onwarn(warning, warn) {
          const id = (warning.id ?? '').replace(/\\/g, '/');
          const fromZod = id.endsWith('zod/v4/core/util.js') || id.endsWith('zod/v4/core/regexes.js');
          if (fromZod && warning.message.includes('contains an annotation that Rollup cannot interpret')) {
            return;
          }
          warn(warning);
        }
      }
    }
  }),
  manifest: {
    name: 'PageHarvest',
    // The Chrome Web Store short description: 132 characters at most.
    description:
      'Extract lists and tables from web pages into a spreadsheet, then export CSV, JSON or Excel. Runs locally; nothing is uploaded.',
    version: '1.0.0',
    version_name: '1.0.0',
    // chrome.sidePanel requires Chrome 114; 116 adds the open behavior this extension relies on.
    minimum_chrome_version: '116',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png'
    },
    // No `scripting`: the content script is declared below, and nothing injects one (ADR-034).
    permissions: [
      'activeTab',
      'sidePanel',
      'storage',
      'downloads'
    ],
    action: {
      default_title: 'Open PageHarvest',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png'
      }
    },
    side_panel: {
      default_path: 'sidepanel.html'
    }
  }
});
