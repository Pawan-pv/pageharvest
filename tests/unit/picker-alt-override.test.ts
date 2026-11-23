import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ElementPicker } from '@/content/picker/picker';

const attachedRoots = new WeakMap<Element, ShadowRoot>();
const originalAttachShadow = Element.prototype.attachShadow;

function overlayRootOf(host: Element): ShadowRoot {
  const root = attachedRoots.get(host);
  if (!root) throw new Error('The overlay attached no shadow root.');
  return root;
}

describe('Picker Alt/Option Single Element Override', () => {
  let picker: ElementPicker;

  beforeEach(() => {
    Element.prototype.attachShadow = function attachAndRecord(this: Element, init: ShadowRootInit) {
      const root = originalAttachShadow.call(this, init);
      attachedRoots.set(this, root);
      return root;
    };
    document.body.innerHTML = `
      <div class="product-list">
        <div class="product-item" id="item-1">Item 1</div>
        <div class="product-item" id="item-2">Item 2</div>
        <div class="product-item" id="item-3">Item 3</div>
      </div>
    `;
  });

  afterEach(() => {
    Element.prototype.attachShadow = originalAttachShadow;
    if (picker) {
      picker.stop();
    }
    document.body.innerHTML = '';
  });

  it('selects multiple similar items by default', () => {
    picker = new ElementPicker();
    picker.start();

    const item = document.querySelector('#item-1')!;
    picker.selectElement(item);

    const info = picker.getSelectedInfo();
    expect(info).not.toBeNull();
    expect(info?.matchCount).toBe(3);
    expect(info?.isSingleOverride).toBeFalsy();

    const host = document.getElementById('pageharvest-picker-overlay-host')!;
    const root = overlayRootOf(host);
    const badge = root.querySelector('.ph-selection-badge');
    expect(badge?.textContent).toContain('3 matches');
  });

  it('overrides similar match heuristics to pin single element when Alt is held', () => {
    picker = new ElementPicker();
    picker.start();

    const item = document.querySelector('#item-1')!;
    picker.selectElement(item);

    // Toggle Alt override ON
    picker.setAltOverride(true);

    const overridden = picker.getSelectedInfo();
    expect(overridden?.matchCount).toBe(1);
    expect(overridden?.similarSelector).toBeUndefined();
    expect(overridden?.isSingleOverride).toBe(true);

    const host = document.getElementById('pageharvest-picker-overlay-host')!;
    const root = overlayRootOf(host);
    const badge = root.querySelector('.ph-selection-badge');
    expect(badge?.textContent).toContain('Single element (Alt)');

    // Toggle Alt override OFF
    picker.setAltOverride(false);

    const restored = picker.getSelectedInfo();
    expect(restored?.matchCount).toBe(3);
    expect(restored?.isSingleOverride).toBe(false);
    expect(badge?.textContent).toContain('3 matches');
  });
});
