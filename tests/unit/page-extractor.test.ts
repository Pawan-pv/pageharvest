import { describe, it, expect } from 'vitest';
import { parsePageMetadata } from '@/core/page-extract/metadata-parser';
import { parseJsonLd } from '@/core/page-extract/jsonld-parser';
import { buildPageRecord } from '@/core/page-extract/extractor';
import { executeDomExtraction } from '@/core/page-extract/dom-extractor';

describe('Page Metadata Parser', () => {
  it('extracts all standard and OpenGraph metadata fields', () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en-US">
      <head>
        <title> Acme Super Widget 2026 </title>
        <meta name="description" content="The best super widget on the market.">
        <link rel="canonical" href="https://example.com/widget">
        <meta property="og:title" content="Acme Widget">
        <meta property="og:description" content="OG description of widget">
        <meta property="og:image" content="https://example.com/images/widget.jpg">
        <meta name="author" content="Jane Doe">
        <meta property="article:published_time" content="2026-11-01T12:00:00Z">
      </head>
      <body><h1>Content</h1></body>
      </html>
    `;

    const meta = parsePageMetadata(html, 'https://example.com/widget');
    expect(meta.sourceUrl).toBe('https://example.com/widget');
    expect(meta.title).toBe('Acme Super Widget 2026');
    expect(meta.description).toBe('The best super widget on the market.');
    expect(meta.canonical).toBe('https://example.com/widget');
    expect(meta.ogTitle).toBe('Acme Widget');
    expect(meta.ogDescription).toBe('OG description of widget');
    expect(meta.ogImage).toBe('https://example.com/images/widget.jpg');
    expect(meta.author).toBe('Jane Doe');
    expect(meta.publishedTime).toBe('2026-11-01T12:00:00Z');
    expect(meta.language).toBe('en-US');
  });
});

describe('JSON-LD Parser', () => {
  it('extracts Product schema with offers and aggregate ratings', () => {
    const html = `
      <script type="application/ld+json">
      {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": "Mechanical Keyboard Pro",
        "image": "https://example.com/keyboard.jpg",
        "sku": "KB-PRO-100",
        "brand": {
          "@type": "Brand",
          "name": "KeyTech"
        },
        "offers": {
          "@type": "Offer",
          "price": "149.99",
          "priceCurrency": "USD",
          "availability": "https://schema.org/InStock"
        },
        "aggregateRating": {
          "@type": "AggregateRating",
          "ratingValue": "4.8",
          "reviewCount": "124"
        }
      }
      </script>
    `;

    const data = parseJsonLd(html);
    expect(data.schemaType).toBe('Product');
    expect(data.name).toBe('Mechanical Keyboard Pro');
    expect(data.price).toBe('149.99');
    expect(data.priceCurrency).toBe('USD');
    expect(data.availability).toBe('https://schema.org/InStock');
    expect(data.sku).toBe('KB-PRO-100');
    expect(data.brand).toBe('KeyTech');
    expect(data.ratingValue).toBe('4.8');
    expect(data.reviewCount).toBe('124');
    expect(data.schemaImage).toBe('https://example.com/keyboard.jpg');
  });

  it('handles @graph arrays containing multiple schema entities', () => {
    const html = `
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebSite",
            "name": "Example Tech Store",
            "url": "https://example.com"
          },
          {
            "@type": "Product",
            "name": "Graph Wireless Earbuds",
            "sku": "EAR-001",
            "offers": [
              {
                "price": "89.00",
                "priceCurrency": "EUR"
              }
            ]
          }
        ]
      }
      </script>
    `;

    const data = parseJsonLd(html);
    expect(data.schemaType).toBe('Product');
    expect(data.name).toBe('Graph Wireless Earbuds');
    expect(data.price).toBe('89.00');
    expect(data.priceCurrency).toBe('EUR');
    expect(data.sku).toBe('EAR-001');
  });

  it('handles Article schema when no Product is present', () => {
    const html = `
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": "Breakthrough in Renewable Energy",
        "image": ["https://example.com/news.jpg"]
      }
      </script>
    `;

    const data = parseJsonLd(html);
    expect(data.schemaType).toBe('NewsArticle');
    expect(data.name).toBe('Breakthrough in Renewable Energy');
    expect(data.schemaImage).toBe('https://example.com/news.jpg');
  });
});

describe('Page Extractor Combined Record', () => {
  it('combines metadata and JSON-LD into a flat record', () => {
    const html = `
      <title>Smart Watch</title>
      <meta name="description" content="Feature-packed watch.">
      <script type="application/ld+json">
      {
        "@type": "Product",
        "name": "Smart Watch Ultra",
        "price": "299"
      }
      </script>
    `;

    const record = buildPageRecord(html, 'https://example.com/watch', {
      extractMetadata: true,
      extractJsonLd: true,
    });

    expect(record.URL).toBe('https://example.com/watch');
    expect(record['Title']).toBe('Smart Watch');
    expect(record['Description']).toBe('Feature-packed watch.');
    expect(record['Schema Name']).toBe('Smart Watch Ultra');
    expect(record['Price']).toBe('299');
  });
});

describe('DOM Extractor', () => {
  it('extracts custom CSS fields from DOM', async () => {
    document.body.innerHTML = `
      <div class="custom-badge">In Stock</div>
      <a class="source-link" href="https://example.com/source">Download</a>
      <img class="hero-img" src="https://example.com/hero.png" />
    `;

    const result = await executeDomExtraction({
      extractMetadata: false,
      extractJsonLd: false,
      customFields: [
        { name: 'StockStatus', selector: '.custom-badge', attribute: 'text' },
        { name: 'SourceUrl', selector: '.source-link', attribute: 'href' },
        { name: 'HeroImage', selector: '.hero-img', attribute: 'src' },
      ],
    });

    expect(result['StockStatus']).toBe('In Stock');
    expect(result['SourceUrl']).toBe('https://example.com/source');
    expect(result['HeroImage']).toBe('https://example.com/hero.png');
  });
});
