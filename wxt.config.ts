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
    plugins: [react()]
  }),
  manifest: {
    name: 'PageHarvest',
    description: 'Local-first website data extraction Chrome extension',
    version: '1.0.0',
    // chrome.sidePanel requires Chrome 114; 116 adds the open behavior this extension relies on.
    minimum_chrome_version: '116',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png'
    },
    permissions: [
      'activeTab',
      'scripting',
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
