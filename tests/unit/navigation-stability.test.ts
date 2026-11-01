import { describe, it, expect, beforeEach } from 'vitest';
import {
  waitForDOMStability,
  waitForNewElements,
  waitForCondition,
} from '@/core/navigation/stability';

describe('DOM Stability & Page Load Waiting', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves immediately when DOM is already stable and quiet', async () => {
    document.body.innerHTML = '<div id="container"><p>Existing content</p></div>';
    const container = document.getElementById('container')!;

    const startTime = Date.now();
    const isStable = await waitForDOMStability(container, {
      timeoutMs: 1000,
      quietPeriodMs: 100,
      pollIntervalMs: 25,
    });
    const elapsed = Date.now() - startTime;

    expect(isStable).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(500);
  });

  it('waits for delayed rendering mutations to complete before declaring stability', async () => {
    document.body.innerHTML = '<div id="container"><div class="skeleton">Loading...</div></div>';
    const container = document.getElementById('container')!;

    // Trigger delayed render after 100ms
    setTimeout(() => {
      container.innerHTML = `
        <div class="card">Loaded Card 1</div>
        <div class="card">Loaded Card 2</div>
      `;
    }, 100);

    const isStable = await waitForDOMStability(container, {
      timeoutMs: 2000,
      minWaitMs: 150,
      quietPeriodMs: 100,
      pollIntervalMs: 25,
    });

    expect(isStable).toBe(true);
    expect(container.querySelectorAll('.card').length).toBe(2);
  });

  it('waits until new container elements appear in the DOM', async () => {
    document.body.innerHTML = `
      <div id="list">
        <div class="item">Item 1</div>
        <div class="item">Item 2</div>
      </div>
    `;

    // Simulate AJAX Load More after 80ms
    setTimeout(() => {
      const list = document.getElementById('list')!;
      const item3 = document.createElement('div');
      item3.className = 'item';
      item3.textContent = 'Item 3';
      const item4 = document.createElement('div');
      item4.className = 'item';
      item4.textContent = 'Item 4';
      list.appendChild(item3);
      list.appendChild(item4);
    }, 80);

    const result = await waitForNewElements('.item', 2, {
      timeoutMs: 1500,
      minNewCount: 1,
      pollIntervalMs: 20,
    });

    expect(result.success).toBe(true);
    expect(result.newCount).toBe(4);
    expect(result.diff).toBe(2);
  });

  it('times out gracefully when new elements never appear', async () => {
    document.body.innerHTML = `
      <div id="list">
        <div class="item">Item 1</div>
      </div>
    `;

    const result = await waitForNewElements('.item', 1, {
      timeoutMs: 150,
      minNewCount: 1,
      pollIntervalMs: 30,
    });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.newCount).toBe(1);
  });

  it('respects AbortSignal cancellation immediately', async () => {
    const controller = new AbortController();
    document.body.innerHTML = '<div id="container"></div>';

    setTimeout(() => {
      controller.abort();
    }, 50);

    await expect(
      waitForCondition(() => false, {
        timeoutMs: 2000,
        pollIntervalMs: 20,
        signal: controller.signal,
      })
    ).rejects.toThrow('Aborted');
  });
});
