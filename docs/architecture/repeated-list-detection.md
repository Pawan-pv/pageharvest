# Repeated List Detection & Field Discovery Engine

**Owner:** Agent 4 (Repeated Element & Pattern Detection Engine)  
**Location:** `src/core/detection/`  
**Status:** Implemented & Verified  

---

## 1. System Overview

The **Repeated List Detection & Field Discovery Engine** identifies repeated structures on any website—such as product grids, job listings, search results, directory entries, table rows, and article cards—without requiring the user to write CSS or XPath selectors.

When a user hovers or clicks on any element (or a child element inside an item):
1. The engine inspects the selected element context and ascends the DOM tree.
2. At each ancestor level, sibling elements are analyzed and grouped into structural clusters.
3. DOM tree fingerprints and Dice-coefficient structural similarity algorithms identify repeating candidate cards.
4. Fields within the candidate cards (text, links, images, prices, ratings, dates, buttons, metadata) are discovered using configurable heuristics.
5. A deterministic, documented confidence score is computed, weighting structural consistency, repetition frequency, semantic tags/ARIA roles, field richness, and attribute uniformity.
6. The enclosing list and its similar cards are returned for instant preview in the side panel.

---

## 2. Detection Pipeline

```
Selected Element Context
           │
           ▼
[Bounded DOM Ancestry Traversal] (depth <= 8)
           │
           ▼
[Sibling Clustering & Fingerprinting] (Tag multiset + Class vector + Child count)
           │
           ▼
[Repeated Pattern Candidate Formulation]
           │
           ▼
[Field Extraction Discovery] (Text, Links, Images, Prices, Ratings, Dates, Actions)
           │
           ▼
[Deterministic Confidence Scoring] (Weighted Multi-Factor Formula)
           │
           ▼
[Friendly List Name Inference & Selection] (Product Cards, Job Listings, Table Rows, etc.)
```

---

## 3. Documented Confidence Scoring Algorithm

Confidence scores are computed deterministically from structural DOM metrics rather than arbitrary numbers.

### Composite Score Formula

The overall confidence score $C \in [0.0, 1.0]$ (and percentage $0\text{--}100\%$) is defined as:

$$C = \min\left(1.0, \max\left(0.0, w_1 \cdot S_{\text{struct}} + w_2 \cdot S_{\text{freq}} + w_3 \cdot S_{\text{semantic}} + w_4 \cdot S_{\text{fields}} + w_5 \cdot S_{\text{attr}} - P_{\text{penalties}}\right)\right)$$

### Factor Weights

| Component | Weight | Metric |
| :--- | :--- | :--- |
| **$S_{\text{struct}}$ (Structural Consistency)** | $0.30$ | Mean pairwise Dice-coefficient tree similarity across sampled items |
| **$S_{\text{freq}}$ (Repetition Frequency)** | $0.20$ | Scaling factor: $0.60$ base for $N \ge 2$, up to $1.00$ for $N \ge 16$ |
| **$S_{\text{semantic}}$ (Semantic HTML & ARIA)** | $0.20$ | Semantic bonuses for `li`, `tr`, `article`, `role="listitem"`, `feed`, `grid` |
| **$S_{\text{fields}}$ (Field Pattern Richness)** | $0.20$ | Diversity of distinct field types $\times$ average field coverage |
| **$S_{\text{attr}}$ (Attribute Uniformity)** | $0.10$ | Class consistency ratio and shared `data-*` attributes |
| **$P_{\text{penalties}}$ (Noise Penalties)** | Variable | Penalties for empty items ($0.30$) or severe sibling disparity ($0.15$) |

### Factor Breakdown Output

Every detection result includes the transparent factor breakdown in `confidenceFactors`:
```typescript
export interface ConfidenceFactors {
  structural: number;          // e.g. 0.95
  frequency: number;           // e.g. 0.85
  semantic: number;            // e.g. 0.90
  fieldPatterns: number;       // e.g. 0.92
  attributeUniformity: number; // e.g. 0.88
  penalties: number;           // e.g. 0.00
  total: number;               // Composite e.g. 0.92 (92%)
}
```

---

## 4. Field Discovery Engine

The discovery engine extracts and categorizes 8 distinct field types:

1. **Title / Name**: Headings (`h1-h6`), `[class*="title" i]`, `[class*="name" i]`, `[class*="headline" i]`. Extractor: `text`.
2. **Link / URL**: `a[href]`, extracting title and resolving absolute `href`. Extractor: `href`.
3. **Image / Media**: `img[src]`, `img[data-src]`, `picture > source[srcset]`, CSS `background-image`. Extractor: `src`.
4. **Price**: Currency symbols (`$`, `€`, `£`, `¥`, `₹`, `C$`, `A$`, `USD`, `EUR`, `GBP`, `INR`). Parses numeric floats. Extractor: `number`.
5. **Rating**: Star ratings (`4.5 out of 5`, `4.8/5`, `★` character counts, `[aria-label*="rating"]`, `[data-rating]`). Extractor: `number`.
6. **Date**: `<time datetime="...">`, ISO timestamps, formatted strings, and relative dates (`"2 days ago"`, `"yesterday"`). Extractor: `attribute` or `text`.
7. **Buttons / Actions**: Action triggers (`button`, `a.btn`, `[role="button"]`) with intent detection (`"Add to Cart"`, `"Apply Now"`, `"Book a Table"`). Extractor: `text`.
8. **Metadata**: Custom `data-*` attributes, Schema.org `[itemprop]`, OpenGraph tags. Extractor: `attribute`.

### Configurable Heuristics

Developers and users can supply custom rules via `DetectionOptions.heuristics`:
```typescript
const options: DetectionOptions = {
  heuristics: {
    customRules: [
      {
        name: 'Crypto Ticker',
        type: 'text',
        extractor: 'text',
        selectors: ['.coin-symbol'],
        weight: 0.9
      }
    ]
  }
};
```

Users can also customize discovered field names and selector mappings via `updateFieldMapping()`:
```typescript
const updated = updateFieldMapping(detectedList, 'field_price_1', {
  name: 'Discounted Price',
  selector: '.sale-price'
});
```

---

## 5. Performance & Scalability Design

To prevent UI lockups and expensive traversals on every hover:
- **Bounded Ancestry**: Scanning stops after climbing 8 levels or reaching document root boundaries.
- **WeakMap Fingerprint Cache**: Fingerprints and element shapes are cached in `DetectionCache` with automatic GC cleanup.
- **Direct Child Index Traversal**: Containers with thousands of elements avoid allocating intermediate arrays via native index loops.
- **Sampled Field Coverage**: Field occurrence and coverage validation samples up to 8 elements for large clusters, executing in $< 20\text{ms}$.
- **Sub-100ms Target**: Verified in performance tests against 1,000-element DOM structures.

---

## 6. Verification & Test Coverage

- `tests/unit/repeated-list-detector.test.ts`: 14 comprehensive unit tests covering product grids, job listings, article feeds, business directories, tables, nested cards, missing fields, unrelated element isolation, large DOMs, and custom heuristics.
- `tests/integration/detection-fixtures.test.ts`: 8 fixture integration tests testing real HTML pages in `tests/fixtures/pages/`.
- `tests/unit/detection.test.ts`: 5 backwards-compatibility unit tests.
