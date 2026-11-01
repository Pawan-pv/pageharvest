# Repeated Element Detection & Extraction Engine

## 1. Repeated Element Detection Algorithm

When extracting data from a web page (e.g. search results, e-commerce listings, articles), items follow a recurring structural pattern.

### Structural Similarity Clustering
1. When a user clicks an element (or requests auto-detect):
   - Find candidate container candidates by ascending up the DOM tree (`element.parentElement`).
   - For each parent, inspect its children (`parent.children`).
   - Compute a structural fingerprint for each child:
     - Tag name + Class list + Child tag sequence.
   - If a parent has $N \ge 2$ children with matching or highly similar fingerprints, that parent is a repeated container candidate.
2. Generate a robust CSS selector for the repeated item (e.g., `ul.product-list > li`, `.card-item`, `table > tbody > tr`).
3. Return candidate count, selector, and sample elements to the side panel for preview and confirmation.

## 2. Automatic Field Detection Heuristics

For any selected container item, automatically propose field definitions by analyzing internal DOM nodes:
1. **Title / Name**: Search for `h1, h2, h3, h4, h5, [class*="title"], [class*="name"]`. Extract text.
2. **Link / URL**: Search for `a[href]`. Extract absolute `href`.
3. **Image / Thumbnail**: Search for `img[src], img[data-src]`. Extract absolute `src`.
4. **Price / Number**: Search for currency symbols (`$`, `€`, `£`, `¥`) or numbers with decimal points.
5. **Description / Text**: Search for `p, [class*="desc"], [class*="detail"]`. Extract text.
6. **Badge / Category / Tag**: Search for `span, [class*="badge"], [class*="category"], [class*="tag"]`.

## 3. Data Extraction & Normalization Engine

The core extraction engine (`src/core/extraction/`) is completely deterministic and runs local-first without LLM reliance.

### 3.1 Supported Data Types
1. **Text**: Extracted from `textContent` or `innerText`, whitespace and linebreaks collapsed, HTML entities decoded (named, decimal `&#...;`, hex `&#x...;`), non-breaking and zero-width spaces normalized.
2. **Links**: Anchor tags and custom link attributes resolved to absolute URLs against `baseUrl`. Filters out `javascript:` pseudo-protocols.
3. **Images**: Resolves `src`, `data-src`, `data-lazy-src`, `data-original`, `srcset` candidates, and CSS `background-image: url(...)` to absolute URLs.
4. **Attributes**: Extracts any custom attribute (e.g., `data-sku`, `title`, `aria-label`).
5. **Prices**: Parses multi-locale formats (`$129.00`, `129,00 €`, `€ 1.299,99`, `1 299,50 €`, `£49.99`, `¥1500`), discounts (`-15%`), negative values, and free items (`"FREE"` $\to$ `0`). Returns formatted strings or numbers.
6. **Dates**: Parses ISO-8601, `YYYY-MM-DD`, `MM/DD/YYYY`, `DD/MM/YYYY`, standard month strings (`October 15, 2026`), and relative dates (`today`, `yesterday`, `X days ago`).
7. **Numeric Values**: Extracts integers, floating points, percentages, and ratings (e.g. `"4.8 out of 5 stars"` $\to$ `4.8`).
8. **Boolean Values**: Evaluates DOM state (`input.checked`, `button.disabled`, `aria-checked`, semantic classes `.in-stock`, `.active`) and string booleans (`true`/`false`, `in stock`/`out of stock`).
9. **Metadata**: Injects record provenance (`_id`, `_page`, `_extractedAt`, `_sourceUrl`, `_hash`) and execution context.
10. **HTML**: Raw sanitized innerHTML strings.
11. **Regex**: Regex capture groups extracted safely with pattern verification.

### 3.2 Input Contract (`ExtractionInput`)
- `schema?: ExtractionRecipe | ExtractionSchema`
- `root?: Document | Element` (DOM context, defaults to `document`)
- `rootSelector?: string` (Optional sub-tree container)
- `repeatedItemSelector?: string` (CSS selector for repeated items)
- `fieldSelectors?: Record<string, string>` (Shorthand mapping of name $\to$ selector)
- `fieldTypes?: Record<string, ExtendedFieldExtractorType>` (Shorthand mapping of name $\to$ type)
- `fields?: ExtractionFieldConfig[]` (Explicit field definitions)
- `baseUrl?: string` (Context URL for relative links)
- `pageNumber?: number` (Pagination index)
- `deduplication?: { enabled?: boolean; fields?: string[]; seenHashes?: Set<string> }`

### 3.3 Output Contract (`ExtractionOutput`)
- `records: ExtractedRecord[]` (Normalized, validated, deduplicated records)
- `metadata: ExtractionMetadata` (Execution ID, timestamp, page, container selector, field count)
- `errors: ExtractionJobError[]` (Diagnostic error log with severity, field, containerIndex, selector)
- `statistics: ExtractionStatistics` (Total parsed, valid count, duplicate count, failed count, durationMs, fieldCoverage map)

### 3.4 Reliability Guarantees
- **Non-Fatal Element Missing**: Missing optional fields receive `defaultValue` or `null` without crashing the job.
- **Record Isolation**: If an individual record fails required field validation, it is collected into `errors` and skipped without corrupting remaining records.
- **Malformed Selector Safety**: Invalid CSS selectors in fields or root trigger `INVALID_SELECTOR` diagnostic errors rather than uncaught DOMExceptions.
- **Large Dataset Scalability**: Fast 32-bit FNV-1a hashing guarantees sub-second deduplication across 1,000+ item batches.
- **Zero LLM Dependency**: Deterministic DOM parsing and regular expression heuristics ensure high throughput and zero token costs.
