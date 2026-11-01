import { afterEach, describe, expect, it, vi } from 'vitest';
import { PickerOverlay } from '@/content/picker/overlay';

const HOST_ID = 'pageharvest-picker-overlay-host';

describe('Picker overlay Shadow DOM isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.getElementById(HOST_ID)?.remove();
  });

  it('attaches a closed shadow root that page scripts cannot read', () => {
    const attachShadow = vi.spyOn(Element.prototype, 'attachShadow');
    const overlay = new PickerOverlay();

    overlay.attach();

    expect(attachShadow).toHaveBeenCalledWith({ mode: 'closed' });
    const host = document.getElementById(HOST_ID) as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.shadowRoot).toBeNull();

    overlay.destroy();
  });

  it('exposes no global or host property leading to the root', () => {
    const overlay = new PickerOverlay();
    overlay.attach();
    const host = document.getElementById(HOST_ID) as HTMLElement;

    expect(Object.keys(host)).toEqual([]);
    expect(Object.keys(window).filter((key) => /pageharvest|shadow/i.test(key))).toEqual([]);

    overlay.destroy();
  });

  it('keeps recognizing its own host after the root is closed', () => {
    const overlay = new PickerOverlay();
    overlay.attach();
    const host = document.getElementById(HOST_ID) as HTMLElement;

    expect(overlay.isPickerElement(host)).toBe(true);
    expect(overlay.isPickerElement(document.body)).toBe(false);

    overlay.destroy();
  });

  it('removes the host completely on destroy and can attach again', () => {
    const overlay = new PickerOverlay();
    overlay.attach();
    overlay.destroy();
    expect(document.getElementById(HOST_ID)).toBeNull();

    overlay.attach();
    expect(document.getElementById(HOST_ID)).not.toBeNull();
    overlay.destroy();
    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('survives a stale host left behind in the document', () => {
    const stale = document.createElement('div');
    stale.id = HOST_ID;
    stale.attachShadow({ mode: 'closed' });
    document.body.appendChild(stale);

    const overlay = new PickerOverlay();
    expect(() => overlay.attach()).not.toThrow();
    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1);

    overlay.destroy();
    expect(document.getElementById(HOST_ID)).toBeNull();
  });
});
