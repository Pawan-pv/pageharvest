import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ElementPicker } from '@/content/picker/picker';
import { PickerMessenger } from '@/content/picker/messenger';
import { PickerOverlay } from '@/content/picker/overlay';
import { assessTargetElementFrame, assessCurrentFrame } from '@/content/picker/frame-assessor';
import { loadFixtureHtml } from '../utils/dom-helpers';

describe('Interactive Element Picker', () => {
  let picker: ElementPicker;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  afterEach(() => {
    if (picker) {
      picker.stop();
    }
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  describe('Hover State', () => {
    it('activates inspecting mode and displays hover overlay on mousemove', () => {
      loadFixtureHtml('simple-grid.html');
      const onHover = vi.fn();
      picker = new ElementPicker({ onHover });
      picker.start();

      expect(picker.getMode()).toBe('inspecting');

      const card = document.querySelector('.product-card')!;
      // Mock getBoundingClientRect
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 50,
        width: 200,
        height: 150,
        bottom: 250,
        right: 250,
        x: 50,
        y: 100,
        toJSON: () => {}
      });

      // Dispatch mousemove on card
      card.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

      expect(onHover).toHaveBeenCalledTimes(1);
      const hoverInfo = onHover.mock.calls[0][0];
      expect(hoverInfo.element).toBe(card);
      expect(hoverInfo.tagName).toBe('div');
      expect(hoverInfo.classList).toContain('product-card');

      // Verify overlay in Shadow DOM
      const host = document.getElementById('pageharvest-picker-overlay-host')!;
      expect(host).not.toBeNull();
      const shadowRoot = host.shadowRoot!;
      const hoverBox = shadowRoot.querySelector('.ph-hover-box')!;
      expect(hoverBox.classList.contains('ph-hidden')).toBe(false);
      expect(hoverBox.getAttribute('style')).toContain('top: 100px');
      expect(hoverBox.getAttribute('style')).toContain('left: 50px');
    });

    it('updates hover position when moving between different elements', () => {
      loadFixtureHtml('simple-grid.html');
      picker = new ElementPicker();
      picker.start();

      const title = document.querySelector('.product-title')!;
      const price = document.querySelector('.product-price')!;

      vi.spyOn(title, 'getBoundingClientRect').mockReturnValue({
        top: 120,
        left: 60,
        width: 180,
        height: 30,
        bottom: 150,
        right: 240,
        x: 60,
        y: 120,
        toJSON: () => {}
      });

      title.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

      const host = document.getElementById('pageharvest-picker-overlay-host')!;
      const shadowRoot = host.shadowRoot!;
      const hoverBox = shadowRoot.querySelector('.ph-hover-box')!;
      expect(hoverBox.getAttribute('style')).toContain('top: 120px');

      vi.spyOn(price, 'getBoundingClientRect').mockReturnValue({
        top: 160,
        left: 60,
        width: 80,
        height: 25,
        bottom: 185,
        right: 140,
        x: 60,
        y: 160,
        toJSON: () => {}
      });

      price.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      expect(hoverBox.getAttribute('style')).toContain('top: 160px');
    });

    it('clears hover highlight when leaving target element', () => {
      loadFixtureHtml('simple-grid.html');
      picker = new ElementPicker();
      picker.start();

      const card = document.querySelector('.product-card')!;
      card.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

      // Move mouse over null / body root
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

      const host = document.getElementById('pageharvest-picker-overlay-host')!;
      const shadowRoot = host.shadowRoot!;
      const hoverBox = shadowRoot.querySelector('.ph-hover-box')!;
      expect(hoverBox.classList.contains('ph-hidden')).toBe(true);
    });
  });

  describe('Element Selection', () => {
    it('selects an element on click, prevents default host action, and shows selection box', () => {
      loadFixtureHtml('simple-grid.html');
      const onSelect = vi.fn();
      picker = new ElementPicker({ onSelect });
      picker.start();

      const link = document.querySelector('.product-link') as HTMLAnchorElement;
      vi.spyOn(link, 'getBoundingClientRect').mockReturnValue({
        top: 200,
        left: 50,
        width: 100,
        height: 20,
        bottom: 220,
        right: 150,
        x: 50,
        y: 200,
        toJSON: () => {}
      });

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      const defaultPrevented = !link.dispatchEvent(clickEvent);

      // Verify click was intercepted
      expect(defaultPrevented).toBe(true);
      expect(picker.getMode()).toBe('selected');
      expect(onSelect).toHaveBeenCalledTimes(1);

      const selectedInfo = onSelect.mock.calls[0][0];
      expect(selectedInfo.element).toBe(link);
      expect(selectedInfo.tagName).toBe('a');
      expect(selectedInfo.selector).toBeDefined();

      // Check Shadow DOM selection box
      const host = document.getElementById('pageharvest-picker-overlay-host')!;
      const shadowRoot = host.shadowRoot!;
      const selectionBox = shadowRoot.querySelector('.ph-selection-box')!;
      expect(selectionBox.classList.contains('ph-hidden')).toBe(false);
      expect(selectionBox.getAttribute('style')).toContain('top: 200px');
    });

    it('highlights similar elements matching the selected element selector', () => {
      loadFixtureHtml('simple-grid.html');
      picker = new ElementPicker({ showSimilar: true });
      picker.start();

      const firstTitle = document.querySelectorAll('.product-title')[0] as HTMLElement;
      vi.spyOn(firstTitle, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 50,
        width: 150,
        height: 30,
        bottom: 130,
        right: 200,
        x: 50,
        y: 100,
        toJSON: () => {}
      });

      firstTitle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      const host = document.getElementById('pageharvest-picker-overlay-host')!;
      const shadowRoot = host.shadowRoot!;

      // Check toolbar rendered
      const toolbar = shadowRoot.querySelector('.ph-toolbar')!;
      expect(toolbar.classList.contains('ph-hidden')).toBe(false);

      // Check similar match boxes created for other matching titles
      const similarBoxes = shadowRoot.querySelectorAll('.ph-similar-box');
      // 3 items in simple-grid, 1 is selected, so 2 similar boxes should exist
      expect(similarBoxes.length).toBe(2);
    });
  });

  describe('Parent Selection & Hierarchy Navigation', () => {
    it('allows ascending to parent element via selectParent()', () => {
      loadFixtureHtml('simple-grid.html');
      picker = new ElementPicker();
      picker.start();

      const title = document.querySelector('.product-title')!;
      const card = title.closest('.product-card')!;

      // Click title
      title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(picker.getSelectedInfo()?.element).toBe(title);

      // Ascend to parent
      picker.selectParent();
      expect(picker.getSelectedInfo()?.element).toBe(card);
      expect(picker.getSelectedInfo()?.classList).toContain('product-card');
    });

    it('navigates via breadcrumb buttons inside the toolbar', () => {
      loadFixtureHtml('simple-grid.html');
      picker = new ElementPicker();
      picker.start();

      const title = document.querySelector('.product-title')!;
      title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      const host = document.getElementById('pageharvest-picker-overlay-host')!;
      const shadowRoot = host.shadowRoot!;

      // Find breadcrumb items in Shadow DOM
      const breadcrumbs = shadowRoot.querySelectorAll<HTMLButtonElement>('.ph-breadcrumb-item');
      expect(breadcrumbs.length).toBeGreaterThan(1);

      // Find the breadcrumb corresponding to .product-card
      const cardBreadcrumb = Array.from(breadcrumbs).find((b) =>
        b.textContent?.includes('product-card')
      );
      expect(cardBreadcrumb).toBeDefined();

      cardBreadcrumb!.click();
      expect(picker.getSelectedInfo()?.classList).toContain('product-card');
    });
  });

  describe('Selector Accuracy', () => {
    it('produces stable test attribute selector when available', () => {
      document.body.innerHTML = `
        <div class="p-4 flex" data-testid="cart-container">
          <button data-testid="checkout-btn">Checkout</button>
        </div>
      `;
      picker = new ElementPicker();
      picker.start();

      const btn = document.querySelector('[data-testid="checkout-btn"]')!;
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      const info = picker.getSelectedInfo()!;
      expect(info.selector).toBe('[data-testid="checkout-btn"]');
      expect(document.querySelector(info.selector)).toBe(btn);
    });

    it('avoids dynamic framework IDs and presentation classes', () => {
      document.body.innerHTML = `
        <div id="ember9872" class="flex p-4 items-center">
          <h1 id=":r4:" class="text-xl font-bold header-title">Storefront</h1>
        </div>
      `;
      picker = new ElementPicker();
      picker.start();

      const header = document.querySelector('.header-title')!;
      header.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      const info = picker.getSelectedInfo()!;
      expect(info.selector).not.toContain('ember9872');
      expect(info.selector).not.toContain(':r4:');
      expect(info.selector).not.toContain('flex');
      expect(info.selector).toContain('header-title');
      expect(document.querySelector(info.selector)).toBe(header);
    });
  });

  describe('Dynamic DOM Changes', () => {
    it('reacts to DOM mutations and updates match count for similar elements', async () => {
      loadFixtureHtml('simple-grid.html');
      picker = new ElementPicker();
      picker.start();

      const firstTitle = document.querySelector('.product-title')!;
      firstTitle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(picker.getSelectedInfo()?.matchCount).toBe(3);

      // Dynamically insert a 4th card
      const grid = document.querySelector('.product-grid')!;
      const newCard = document.createElement('div');
      newCard.className = 'product-card';
      newCard.innerHTML = `<h2 class="product-title">New Item 4</h2>`;
      grid.appendChild(newCard);

      // Wait for MutationObserver callback
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(picker.getSelectedInfo()?.matchCount).toBe(4);
    });
  });

  describe('Cancellation and Cleanup', () => {
    it('cancels selection and closes picker on Escape key', () => {
      loadFixtureHtml('simple-grid.html');
      const onCancel = vi.fn();
      picker = new ElementPicker({ onCancel });
      picker.start();

      const card = document.querySelector('.product-card')!;
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(picker.getMode()).toBe('selected');

      // Press Escape
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(picker.getMode()).toBe('inactive');
      expect(document.getElementById('pageharvest-picker-overlay-host')).toBeNull();
    });

    it('cancels selection when clicking toolbar Cancel button', () => {
      loadFixtureHtml('simple-grid.html');
      const onCancel = vi.fn();
      picker = new ElementPicker({ onCancel });
      picker.start();

      const card = document.querySelector('.product-card')!;
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      const host = document.getElementById('pageharvest-picker-overlay-host')!;
      const shadowRoot = host.shadowRoot!;
      const cancelBtn = shadowRoot.querySelector<HTMLButtonElement>('.ph-btn-cancel')!;

      cancelBtn.click();

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(picker.getMode()).toBe('inactive');
      expect(document.getElementById('pageharvest-picker-overlay-host')).toBeNull();
    });

    it('confirms selection when clicking toolbar Confirm button', () => {
      loadFixtureHtml('simple-grid.html');
      const onConfirm = vi.fn();
      picker = new ElementPicker({ onConfirm });
      picker.start();

      const card = document.querySelector('.product-card')!;
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      const host = document.getElementById('pageharvest-picker-overlay-host')!;
      const shadowRoot = host.shadowRoot!;
      const confirmBtn = shadowRoot.querySelector<HTMLButtonElement>('.ph-btn-confirm')!;

      confirmBtn.click();

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(picker.getMode()).toBe('inactive');
      expect(document.getElementById('pageharvest-picker-overlay-host')).toBeNull();
    });

    it('leaves target website DOM completely pristine after stop()', () => {
      loadFixtureHtml('simple-grid.html');
      const initialHtml = document.body.innerHTML;

      picker = new ElementPicker();
      picker.start();

      const card = document.querySelector('.product-card')!;
      card.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      picker.stop();

      // Original HTML must be 100% untouched
      expect(document.body.innerHTML).toBe(initialHtml);
    });

    it('completely removes all event listeners and allows normal page clicks after stop()', () => {
      loadFixtureHtml('simple-grid.html');
      picker = new ElementPicker();
      picker.start();

      const btnClickHandler = vi.fn((e: MouseEvent) => e.preventDefault());
      const link = document.querySelector('.product-link') as HTMLAnchorElement;
      link.addEventListener('click', btnClickHandler);

      // Stop picker
      picker.stop();

      // Clicking link now must fire the host handler normally
      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(clickEvent);

      expect(btnClickHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Website CSS Interference Protection', () => {
    it('renders inside Shadow DOM immune to hostile host page styles', () => {
      loadFixtureHtml('simple-grid.html');

      // Inject hostile CSS attempting to break overlays
      const hostileStyle = document.createElement('style');
      hostileStyle.textContent = `
        * {
          display: none !important;
          color: rgb(255, 0, 0) !important;
          font-size: 0px !important;
        }
      `;
      document.head.appendChild(hostileStyle);

      picker = new ElementPicker();
      picker.start();

      const host = document.getElementById('pageharvest-picker-overlay-host')!;
      expect(host).not.toBeNull();
      const shadowRoot = host.shadowRoot!;

      // Verify shadow DOM isolation
      expect(shadowRoot).toBeDefined();
      const styleTag = shadowRoot.querySelector('style')!;
      expect(styleTag.textContent).toContain(':host');
      expect(styleTag.textContent).toContain('all: initial !important');

      const card = document.querySelector('.product-card')!;
      picker.selectElement(card);

      const toolbar = shadowRoot.querySelector('.ph-toolbar')!;
      expect(toolbar).not.toBeNull();
      expect(toolbar.classList.contains('ph-hidden')).toBe(false);
    });
  });

  describe('Cross-Frame Behavior Assessment', () => {
    it('assesses non-iframe standard top-level window correctly', () => {
      const assessment = assessCurrentFrame();
      expect(assessment.isIframe).toBe(false);
      expect(assessment.isCrossOrigin).toBe(false);
      expect(assessment.frameDepth).toBe(0);
    });

    it('assesses iframe elements and handles cross-origin boundaries gracefully', () => {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://example.com/embed';
      document.body.appendChild(iframe);

      const assessment = assessTargetElementFrame(iframe);
      expect(assessment.isIframe).toBe(true);
      expect(assessment.frameDepth).toBe(1);
    });
  });

  describe('Platform Communication Layer (Messenger)', () => {
    it('responds to START_PICKER and STOP_PICKER messages from extension runtime', () => {
      const onStart = vi.fn();
      const onStop = vi.fn();
      const messenger = new PickerMessenger({ onStart, onStop });
      messenger.init();

      messenger.startPicker();
      expect(onStart).toHaveBeenCalledTimes(1);
      expect(messenger.getPicker()?.getMode()).toBe('inspecting');

      messenger.stopPicker();
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(messenger.getPicker()).toBeNull();

      messenger.destroy();
    });
  });
});
