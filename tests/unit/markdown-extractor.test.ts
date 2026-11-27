import { describe, it, expect } from 'vitest';
import { extractPageText, htmlToMarkdown } from '@/core/page-text/markdown-extractor';

describe('Markdown and Page Text Extractor', () => {
  it('converts common HTML elements to markdown formatting', () => {
    const html = `
      <h1>Main Title</h1>
      <p>Introductory paragraph with a <a href="https://example.com">link</a> and <strong>bold text</strong>.</p>
      <h2>Subheading</h2>
      <ul>
        <li>First bullet point</li>
        <li>Second bullet point</li>
      </ul>
      <pre><code>console.log('hello');</code></pre>
    `;

    const md = htmlToMarkdown(html);
    expect(md).toContain('# Main Title');
    expect(md).toContain('[link](https://example.com)');
    expect(md).toContain('**bold text**');
    expect(md).toContain('## Subheading');
    expect(md).toContain('- First bullet point');
    expect(md).toContain("```\nconsole.log('hello');\n```");
  });

  it('strips scripts, styles, navigation, and boilerplate while extracting metadata and counts', () => {
    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Engineering Blog Post</title>
        <meta name="author" content="Alice Dev">
        <meta property="og:site_name" content="TechCo">
        <style>body { background: #fff; }</style>
        <script>console.log('tracker');</script>
      </head>
      <body>
        <nav><a href="/">Home</a><a href="/about">About</a></nav>
        <article>
          <h1>Building Fast MV3 Extensions</h1>
          <p>Chrome Manifest V3 requires background service workers and zero DOMParser in background scripts. This ensures peak performance and lean memory footprints across the whole browsing session.</p>
          <p>By using pure-TypeScript parsers and streaming tab worker pools, developers can handle thousands of pages without running out of memory or leaking browser tabs.</p>
        </article>
        <footer>Copyright 2026 TechCo</footer>
      </body>
      </html>
    `;

    const res = extractPageText(fullHtml, 'https://techco.com/blog/mv3');
    expect(res.url).toBe('https://techco.com/blog/mv3');
    expect(res.title).toBe('Engineering Blog Post');
    expect(res.author).toBe('Alice Dev');
    expect(res.siteName).toBe('TechCo');
    expect(res.markdown).not.toContain('<script');
    expect(res.markdown).not.toContain('<style');
    expect(res.markdown).not.toContain('Copyright 2026 TechCo');
    expect(res.markdown).toContain('# Building Fast MV3 Extensions');
    expect(res.wordCount).toBeGreaterThan(30);
    expect(res.charCount).toBeGreaterThan(150);
    expect(res.estimatedTokens).toBe(Math.ceil(res.charCount / 4));
  });
});
