/**
 * Self-contained image discovery script executed in page contexts via chrome.scripting.executeScript.
 * Must NOT import or depend on outer closures or modules.
 */

export interface ScannedImageResult {
  url: string;
  alt: string;
  width: number;
  height: number;
  pageUrl: string;
}

export async function executePageImageScan(autoScroll = false): Promise<ScannedImageResult[]> {
  if (autoScroll) {
    // Smooth step scroll down to trigger lazy loading
    const totalHeight = Math.min(document.body.scrollHeight, 12000);
    const step = 400;
    for (let pos = 0; pos < totalHeight; pos += step) {
      window.scrollTo(0, pos);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 100));
  }

  const seen = new Set<string>();
  const results: ScannedImageResult[] = [];
  const pageUrl = window.location.href;

  function addImage(rawUrl: string, alt = '', width = 0, height = 0) {
    if (!rawUrl || rawUrl.startsWith('data:image/svg+xml;base64') || rawUrl.startsWith('blob:')) return;
    let absolute: string;
    try {
      absolute = new URL(rawUrl, window.location.href).href;
    } catch {
      return;
    }

    if (!seen.has(absolute)) {
      seen.add(absolute);
      results.push({
        url: absolute,
        alt: (alt || '').slice(0, 150).trim(),
        width: Math.max(0, width),
        height: Math.max(0, height),
        pageUrl,
      });
    }
  }

  // 1. <img> elements
  const imgs = document.querySelectorAll('img');
  imgs.forEach((img) => {
    const src = img.currentSrc || img.getAttribute('src') || '';
    const alt = img.getAttribute('alt') || '';
    const width = img.naturalWidth || img.clientWidth || 0;
    const height = img.naturalHeight || img.clientHeight || 0;
    if (src) addImage(src, alt, width, height);

    // Also check srcset
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      const candidates = srcset.split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
      for (const cand of candidates) {
        addImage(cand, alt, width, height);
      }
    }
  });

  // 2. <picture><source> elements
  const sources = document.querySelectorAll('picture source');
  sources.forEach((srcEl) => {
    const srcset = srcEl.getAttribute('srcset');
    if (srcset) {
      const candidates = srcset.split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
      for (const cand of candidates) {
        addImage(cand, '', 0, 0);
      }
    }
  });

  // 3. Meta OpenGraph / Twitter images
  const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
  if (ogImg) addImage(ogImg, 'OG Image', 0, 0);

  const twImg = document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
  if (twImg) addImage(twImg, 'Twitter Image', 0, 0);

  // 4. Elements with inline style background-image
  const bgElements = document.querySelectorAll('[style*="background-image"]');
  bgElements.forEach((el) => {
    const style = (el as HTMLElement).style.backgroundImage || '';
    const match = /url\(["']?([^"')]+)["']?\)/i.exec(style);
    if (match && match[1]) {
      addImage(match[1], '', (el as HTMLElement).clientWidth, (el as HTMLElement).clientHeight);
    }
  });

  return results;
}
