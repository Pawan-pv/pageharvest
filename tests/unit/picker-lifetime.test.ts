import { describe, expect, it, vi } from 'vitest';
import { holdPickerOpen, PICKER_PORT_NAME, stopPickerWhenPanelGoes } from '@/platform/picker-lifetime';

/** A chrome.runtime.Port the test can disconnect, as Chrome does when the panel closes. */
function fakePort(name: string) {
  const listeners = new Set<() => void>();
  return {
    name,
    disconnect: vi.fn(() => listeners.forEach((listener) => listener())),
    onDisconnect: {
      addListener: (listener: () => void) => listeners.add(listener),
      removeListener: (listener: () => void) => listeners.delete(listener),
    },
    /** What Chrome does when the other end goes away: only this side's listeners hear it. */
    drop: () => listeners.forEach((listener) => listener()),
  };
}

describe('The picker lives only as long as the panel that started it', () => {
  it('connects to the picking tab, and lets go on release', () => {
    const port = fakePort(PICKER_PORT_NAME);
    const connect = vi.fn(() => port);
    Object.assign(chrome.tabs, { connect });

    const release = holdPickerOpen(101);
    expect(connect).toHaveBeenCalledWith(101, { name: PICKER_PORT_NAME });

    release();
    expect(port.disconnect).toHaveBeenCalledTimes(1);
    release();
    expect(port.disconnect).toHaveBeenCalledTimes(1);
  });

  it('holds nothing when Chrome cannot connect', () => {
    Object.assign(chrome.tabs, { connect: undefined });
    expect(() => holdPickerOpen(101)()).not.toThrow();
  });

  it('stops the picker in the page when the panel goes away', () => {
    let onConnect: ((port: ReturnType<typeof fakePort>) => void) | undefined;
    const runtime = { onConnect: { addListener: (listener: typeof onConnect) => (onConnect = listener) } };
    const stop = vi.fn();
    stopPickerWhenPanelGoes(stop, runtime as never);

    const port = fakePort(PICKER_PORT_NAME);
    onConnect?.(port);
    expect(stop).not.toHaveBeenCalled();
    port.drop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer picker when an older panel connection ends late', () => {
    let onConnect: ((port: ReturnType<typeof fakePort>) => void) | undefined;
    const runtime = { onConnect: { addListener: (listener: typeof onConnect) => (onConnect = listener) } };
    const stop = vi.fn();
    stopPickerWhenPanelGoes(stop, runtime as never);

    const older = fakePort(PICKER_PORT_NAME);
    const newer = fakePort(PICKER_PORT_NAME);
    onConnect?.(older);
    onConnect?.(newer);
    older.drop();
    expect(stop).not.toHaveBeenCalled();
    newer.drop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('ignores connections that are not the picker', () => {
    let onConnect: ((port: ReturnType<typeof fakePort>) => void) | undefined;
    const runtime = { onConnect: { addListener: (listener: typeof onConnect) => (onConnect = listener) } };
    const stop = vi.fn();
    stopPickerWhenPanelGoes(stop, runtime as never);

    const other = fakePort('something-else');
    onConnect?.(other);
    other.drop();
    expect(stop).not.toHaveBeenCalled();
  });
});
