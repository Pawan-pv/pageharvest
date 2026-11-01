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

## 3. Data Extraction & Normalization
1. **Relative Traversal**: For each container matching `containerSelector`, query relative selectors: `container.querySelector(field.selector)`.
2. **Extraction Types**:
   - `text`: Read `textContent` or `innerText`, strip redundant whitespace (`\s+` -> ` `), trim.
   - `attribute`: Read `getAttribute(field.attributeName)`.
   - `href` / `src`: Resolve relative paths into absolute URLs using `new URL(attr, window.location.href).href`.
   - `number`: Strip non-numeric characters (retaining negative sign and decimal point) and parse as float.
   - `regex`: Apply regex pattern to text content and extract matching group.
3. **Duplicate Detection**:
   - Compute hash of normalized field values.
   - If hash exists in the current session's seen set, increment duplicate counter and skip or flag the record.
