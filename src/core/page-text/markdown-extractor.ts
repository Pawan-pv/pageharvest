/**
 * Pure-TypeScript HTML-to-Markdown cleaner and article content extractor.
 * Zero external dependencies. Operates seamlessly in Chrome MV3 service workers and web tabs.
 */

export interface PageTextExtractionResult {
  url: string;
  title: string;
  author: string;
  siteName: string;
  publishedTime: string;
  excerpt: string;
  markdown: string;
  plainText: string;
  wordCount: number;
  charCount: number;
  estimatedTokens: number;
}

export interface MarkdownExtractorOptions {
  includeMetadata?: boolean;
  includeMarkdown?: boolean;
  includePlainText?: boolean;
}

function unescapeHtml(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Strips script, style, navigation, footer, and boilerplate chrome from raw HTML.
 */
function cleanBoilerplate(rawHtml: string): string {
  let cleaned = rawHtml;

  // 1. Strip script, style, noscript, svg, iframe, nav, header, footer, aside
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  cleaned = cleaned.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
  cleaned = cleaned.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  cleaned = cleaned.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');
  cleaned = cleaned.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '');
  cleaned = cleaned.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');
  cleaned = cleaned.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '');

  // 2. Remove comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

  return cleaned;
}

/**
 * Locates the main content area (<article> or <main> if substantial, otherwise body).
 */
function extractMainContentArea(cleanedHtml: string): string {
  // Check for <article>
  const articleMatch = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(cleanedHtml);
  if (articleMatch && articleMatch[1] && articleMatch[1].replace(/<[^>]+>/g, '').trim().length > 200) {
    return articleMatch[1];
  }

  // Check for <main>
  const mainMatch = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(cleanedHtml);
  if (mainMatch && mainMatch[1] && mainMatch[1].replace(/<[^>]+>/g, '').trim().length > 200) {
    return mainMatch[1];
  }

  // Fallback: extract inside <body>
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(cleanedHtml);
  if (bodyMatch && bodyMatch[1]) {
    return bodyMatch[1];
  }

  return cleanedHtml;
}

/**
 * Converts cleaned HTML content into well-formatted Markdown.
 */
export function htmlToMarkdown(htmlFragment: string): string {
  let md = htmlFragment;

  // Headings
  md = md.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  md = md.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  md = md.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  md = md.replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n');
  md = md.replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, '\n\n##### $1\n\n');
  md = md.replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, '\n\n###### $1\n\n');

  // Preformatted code
  md = md.replace(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n\n```\n$1\n```\n\n');
  md = md.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, '\n\n```\n$1\n```\n\n');
  md = md.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, ' `$1` ');

  // Blockquotes
  md = md.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content: string) => {
    const lines = content.replace(/<[^>]+>/g, '').trim().split('\n');
    return '\n\n' + lines.map((l) => `> ${l.trim()}`).join('\n') + '\n\n';
  });

  // Lists
  md = md.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  md = md.replace(/<\/(?:ul|ol)>/gi, '\n\n');
  md = md.replace(/<(?:ul|ol)\b[^>]*>/gi, '\n');

  // Paragraphs & Breaks
  md = md.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // Bold & Italic
  md = md.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
  md = md.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');

  // Links: <a href="url">text</a>
  md = md.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
    const cleanText = text.replace(/<[^>]+>/g, '').trim();
    if (!cleanText) return '';
    return `[${cleanText}](${href})`;
  });

  // Strip remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Unescape entities
  md = unescapeHtml(md);

  // Normalize excessive whitespaces and blank lines
  md = md.replace(/\r\n/g, '\n');
  md = md.replace(/[ \t]+\n/g, '\n');
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

/**
 * Strips Markdown formatting to produce clean plaintext.
 */
export function markdownToPlainText(markdown: string): string {
  let text = markdown;
  // Strip code blocks
  text = text.replace(/```[\s\S]*?```/g, '');
  // Strip inline code
  text = text.replace(/`([^`]+)`/g, '$1');
  // Strip links [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Strip images ![alt](url) -> ''
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  // Strip headings (#, ##, ...)
  text = text.replace(/^#{1,6}\s+/gm, '');
  // Strip blockquotes
  text = text.replace(/^>\s+/gm, '');
  // Strip list bullets
  text = text.replace(/^[-*+]\s+/gm, '');
  text = text.replace(/^\d+\.\s+/gm, '');
  // Strip bold/italic
  text = text.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1');

  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/**
 * Extracts metadata and converts page HTML into Markdown and Plaintext.
 */
export function extractPageText(
  html: string,
  url: string,
  options: MarkdownExtractorOptions = {}
): PageTextExtractionResult {
  // 1. Extract metadata
  const getMeta = (nameOrProp: string): string => {
    const pattern = new RegExp(
      `<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${nameOrProp}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
      'i'
    );
    const m = pattern.exec(html);
    if (m && m[1]) return unescapeHtml(m[1].trim());

    const patternReversed = new RegExp(
      `<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:name|property)\\s*=\\s*["']${nameOrProp}["']`,
      'i'
    );
    const mRev = patternReversed.exec(html);
    return mRev && mRev[1] ? unescapeHtml(mRev[1].trim()) : '';
  };

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
  const title = getMeta('og:title') || getMeta('twitter:title') || unescapeHtml(rawTitle);

  const author = getMeta('author') || getMeta('article:author') || getMeta('twitter:creator');
  const siteName = getMeta('og:site_name');
  const publishedTime = getMeta('article:published_time') || getMeta('publication_date');

  // 2. Clean content and generate markdown
  const cleaned = cleanBoilerplate(html);
  const contentArea = extractMainContentArea(cleaned);
  const markdown = options.includeMarkdown !== false ? htmlToMarkdown(contentArea) : '';
  const plainText = options.includePlainText !== false ? markdownToPlainText(markdown || htmlToMarkdown(contentArea)) : '';

  const wordCount = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
  const charCount = plainText.length;
  const estimatedTokens = Math.ceil(charCount / 4);

  const excerpt = plainText.slice(0, 200).replace(/\s+/g, ' ').trim();

  return {
    url,
    title: options.includeMetadata !== false ? title : '',
    author: options.includeMetadata !== false ? author : '',
    siteName: options.includeMetadata !== false ? siteName : '',
    publishedTime: options.includeMetadata !== false ? publishedTime : '',
    excerpt,
    markdown,
    plainText,
    wordCount,
    charCount,
    estimatedTokens,
  };
}
