import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';
import path from 'path';
import type { OutputOptions } from 'rollup';

export default defineConfig({
  hooks: {
    'config:resolved': (wxt) => {
      wxt.config.alias['@'] = path.resolve(__dirname, 'src');
      wxt.config.alias['~'] = path.resolve(__dirname, '.');
    },
    'vite:build:extendConfig': (entrypoints, viteConfig) => {
      const isHtml = entrypoints.every((e) => e.type !== 'background' && e.type !== 'content-script');
      if (!isHtml) return;
      viteConfig.build = viteConfig.build || {};
      viteConfig.build.rollupOptions = viteConfig.build.rollupOptions || {};
      const current = viteConfig.build.rollupOptions.output;
      const output: OutputOptions = Array.isArray(current) ? current[0] ?? {} : current ?? {};
      viteConfig.build.rollupOptions.output = output;
      output.manualChunks = (id: string) => {
        if (!id.includes('node_modules')) return undefined;
        const p = id.replace(/\\/g, '/');
        if (p.includes('/react-dom/') || p.includes('/react/') || p.includes('/scheduler/')) {
          return 'vendor-react';
        }
        if (p.includes('/@tanstack/')) return 'vendor-table';
        if (p.includes('/dexie/')) return 'vendor-db';
        if (p.includes('/zod/')) return 'vendor-zod';
        if (p.includes('/lucide-react/')) return 'vendor-icons';
        return 'vendor';
      };
    },
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
    // Content script is injected on demand via scripting (ADR-037, supersedes ADR-034).
    permissions: [
      'activeTab',
      'sidePanel',
      'storage',
      'scripting',
      'downloads'
    ],
    // Site access is held from install, so Chrome never asks per site while in use (ADR-040).
    host_permissions: ['http://*/*', 'https://*/*'],
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
