import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPageHarvestOverlayNode } from '@/utils/dom';
import { waitForDOMStability, waitForNewElementsOrMutation } from '@/core/navigation/stability';
import { ElementPicker } from '@/content/picker/picker';
import { PickerOverlay } from '@/content/picker/overlay';
import { loadFixtureHtml } from '../utils/dom-helpers';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mountExtractionHost(): HTMLElement {
  const host = document.createElement('div');
  host.id = 'pageharvest-extraction-overlay-host';
  host.setAttribute('data-pageharvest-ignore', 'true');
  document.body.appendChild(host);
  return host;
}

describe('PageHarvest overlay mutation guard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('isPageHarvestOverlayNode', () => {
    it('identifies overlay hosts, their descendants, and nothing else', () => {
      const host = mountExtractionHost();
      const child = document.createElement('span');
      host.appendChild(child);

      const ordinary = document.createElement('p');
      document.body.appendChild(ordinary);

      const textNode = document.createTextNode('hello');

      expect(isPageHarvestOverlayNode(host)).toBe(true);
      expect(isPageHarvestOverlayNode(child)).toBe(true);
      expect(isPageHarvestOverlayNode(ordinary)).toBe(false);
      expect(isPageHarvestOverlayNode(document.body)).toBe(false);
      // Non-element nodes are only overlay nodes when nested inside an overlay host.
      expect(isPageHarvestOverlayNode(textNode)).toBe(false);
    });
  });

  describe('waitForDOMStability', () => {
    it('becomes stable while only PageHarvest overlay elements are being mutated', async () => {
      const host = mountExtractionHost();
      const noisemaker = setInterval(() => {
        const pulse = document.createElement('span');
        host.appendChild(pulse);
      }, 20);

      const startedAt = Date.now();
      const stable = await waitForDOMStability(document.body, {
        quietPeriodMs: 120,
        pollIntervalMs: 30,
        timeoutMs: 2000,
      });
      clearInterval(noisemaker);
      const elapsed = Date.now() - startedAt;

      expect(stable).toBe(true);
      expect(elapsed).toBeLessThan(1500);
    });

    it('still waits when an ordinary page element keeps mutating', async () => {
      const noisemaker = setInterval(() => {
        const ordinary = document.createElement('span');
        ordinary.className = 'feed-update';
        document.body.appendChild(ordinary);
      }, 20);

      const startedAt = Date.now();
      const stable = await waitForDOMStability(document.body, {
        quietPeriodMs: 120,
        pollIntervalMs: 30,
        timeoutMs: 1200,
      });
      clearInterval(noisemaker);
      const elapsed = Date.now() - startedAt;

      expect(stable).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('waitForNewElementsOrMutation', () => {
    it('does not resolve from overlay mutations but still resolves from a real match', async () => {
      document.body.innerHTML =
        '<ul class="feed"><li class="item">first</li></ul>';
      const host = mountExtractionHost();

      const noiseWaiter = waitForNewElementsOrMutation('.item', 1, {
        timeoutMs: 350,
        pollIntervalMs: 40,
      });
      await sleep(60);
      const child = document.createElement('span');
      host.appendChild(child);
      const noiseResult = await noiseWaiter;
      expect(noiseResult).toMatchObject({
        success: false,
        mutated: false,
        timedOut: true,
      });

      const realWaiter = waitForNewElementsOrMutation('.item', 1, {
        timeoutMs: 1000,
        pollIntervalMs: 40,
      });
      await sleep(40);
      const second = document.createElement('li');
      second.className = 'item';
      second.textContent = 'second';
      document.querySelector('.feed')!.appendChild(second);
      const realResult = await realWaiter;
      expect(realResult).toMatchObject({ success: true, mutated: true });
    });
  });

  describe('picker mutation observer immunity', () => {
    it('ignores overlay-caused mutations while still recalculating for real ones', async () => {
      loadFixtureHtml('simple-grid.html');

      const updateSelectionSpy = vi.spyOn(PickerOverlay.prototype, 'updateSelection');
      const picker = new ElementPicker({ showSimilar: true });
      picker.start();

      const link = document.querySelector('.product-link') as HTMLElement;
      vi.spyOn(link, 'getBoundingClientRect').mockReturnValue({
        top: 200,
        left: 50,
        width: 100,
        height: 20,
        bottom: 220,
        right: 150,
        x: 50,
        y: 200,
        toJSON: () => {},
      });
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(picker.getMode()).toBe('selected');

      const callsAfterSelection = updateSelectionSpy.mock.calls.length;

      const host = mountExtractionHost();
      for (let i = 0; i < 3; i++) {
        host.appendChild(document.createElement('span'));
        await sleep(20);
      }
      expect(updateSelectionSpy.mock.calls.length).toBe(callsAfterSelection);

      const ordinary = document.createElement('div');
      ordinary.className = 'page-update';
      document.body.appendChild(ordinary);
      await sleep(30);
      expect(updateSelectionSpy.mock.calls.length).toBeGreaterThan(callsAfterSelection);

      picker.cancel();
    });
  });
});
