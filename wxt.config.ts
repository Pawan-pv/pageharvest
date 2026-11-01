import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';

export default defineConfig({
  vite: () => ({
    plugins: [react()]
  }),
  manifest: {
    name: 'PageHarvest',
    description: 'Local-first website data extraction Chrome extension',
    version: '1.0.0',
    manifest_version: 3,
    permissions: [
      'activeTab',
      'scripting',
      'sidePanel',
      'storage',
      'downloads'
    ],
    action: {
      default_title: 'Open PageHarvest'
    },
    side_panel: {
      default_path: 'sidepanel.html'
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';"
    }
  }
});
