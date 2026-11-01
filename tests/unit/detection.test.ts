import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectRepeatedFromAnchor,
  autoDetectRepeatedPatterns,
  getElementSignature,
} from '@/core/detection/repeated';
import {
  detectFieldsInContainer,
  suggestionsToFieldDefinitions,
} from '@/core/detection/fields';

describe('Repeated Element & Field Detection', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="main-wrapper">
        <ul class="product-grid">
          <li class="product-card">
            <h3 class="product-title">Wireless Mouse</h3>
            <a class="product-link" href="/item/1">View details</a>
            <img class="product-thumb" src="/images/mouse.jpg" alt="Mouse" />
            <span class="product-price">$29.99</span>
            <span class="product-rating">4.5 out of 5 stars</span>
            <p class="product-desc">Ergonomic 2.4G wireless optical mouse with quiet click buttons.</p>
            <span class="badge">Electronics</span>
          </li>
          <li class="product-card">
            <h3 class="product-title">Mechanical Keyboard</h3>
            <a class="product-link" href="/item/2">View details</a>
            <img class="product-thumb" src="/images/keyboard.jpg" alt="Keyboard" />
            <span class="product-price">$89.99</span>
            <span class="product-rating">4.8 out of 5 stars</span>
            <p class="product-desc">RGB backlit mechanical gaming keyboard with blue tactile switches.</p>
            <span class="badge">Gaming</span>
          </li>
          <li class="product-card">
            <h3 class="product-title">USB-C Hub</h3>
            <a class="product-link" href="/item/3">View details</a>
            <img class="product-thumb" src="/images/hub.jpg" alt="Hub" />
            <span class="product-price">$39.99</span>
            <span class="product-rating">4.2 out of 5 stars</span>
            <p class="product-desc">7-in-1 multi-port adapter with 4K HDMI, 100W PD charging, and SD reader.</p>
            <span class="badge">Accessories</span>
          </li>
        </ul>
      </div>
    `;
  });

  it('computes consistent element signatures', () => {
    const cards = document.querySelectorAll('.product-card');
    const sig1 = getElementSignature(cards[0]);
    const sig2 = getElementSignature(cards[1]);
    expect(sig1).toBe(sig2);
  });

  it('detects repeated items starting from an anchor element inside the card', () => {
    const title = document.querySelector('.product-title')!;
    const candidates = detectRepeatedFromAnchor(title);

    expect(candidates.length).toBeGreaterThan(0);
    const topCandidate = candidates[0];
    expect(topCandidate.count).toBe(3);
    expect(topCandidate.sampleElements).toHaveLength(3);
    expect(topCandidate.containerSelector).toContain('.product-card');
  });

  it('auto-detects repeated items across the document', () => {
    const candidates = autoDetectRepeatedPatterns(document);
    expect(candidates.length).toBeGreaterThan(0);
    const match = candidates.find((c) => c.containerSelector.includes('.product-card'));
    expect(match).toBeDefined();
    expect(match?.count).toBe(3);
  });

  it('detects fields automatically inside a card container', () => {
    const card = document.querySelector('.product-card')!;
    const fields = detectFieldsInContainer(card);

    const titleField = fields.find((f) => f.name === 'Title');
    const linkField = fields.find((f) => f.name === 'Link');
    const priceField = fields.find((f) => f.name === 'Price');
    const imageField = fields.find((f) => f.name === 'Image');
    const descField = fields.find((f) => f.name === 'Description');

    expect(titleField).toBeDefined();
    expect(titleField?.sampleValue).toBe('Wireless Mouse');
    expect(titleField?.extractor).toBe('text');

    expect(linkField).toBeDefined();
    expect(linkField?.extractor).toBe('href');
    expect(linkField?.sampleValue).toContain('/item/1');

    expect(priceField).toBeDefined();
    expect(priceField?.extractor).toBe('number');
    expect(priceField?.sampleValue).toBe('29.99');

    expect(imageField).toBeDefined();
    expect(imageField?.extractor).toBe('src');

    expect(descField).toBeDefined();
    expect(descField?.extractor).toBe('text');
  });

  it('converts suggestions to FieldDefinitions with unique IDs and selectors', () => {
    const card = document.querySelector('.product-card')!;
    const suggestions = detectFieldsInContainer(card);
    const fieldDefs = suggestionsToFieldDefinitions(suggestions);

    expect(fieldDefs.length).toBe(suggestions.length);
    expect(fieldDefs.every((field) => field.required === false)).toBe(true);
    expect(fieldDefs[0].id).toBeDefined();
    expect(fieldDefs[0].selector).toBe(suggestions[0].selector);
  });
});
