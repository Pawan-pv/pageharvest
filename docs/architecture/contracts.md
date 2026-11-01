> The runtime protocol is `src/shared/contracts/message.ts`. Job, checkpoint and identity contracts are in `src/shared/contracts/job.ts`. The sections below describe the field and record shapes; for job messages see [ARCHITECTURE.md](../ARCHITECTURE.md), section 3.3.

# Shared TypeScript Contracts & Message Protocol

All inter-module communication, storage entities, and state machines are governed by strictly typed interfaces and Zod schemas in `src/types/` and `src/contracts/`.

## 1. Domain Entities

### 1.1 FieldDefinition
Defines how an individual column/field is extracted from a container element:
```typescript
export type FieldExtractorType =
  | 'text'          // innerText / textContent trimmed
  | 'attribute'     // Custom HTML attribute
  | 'href'          // Anchor link resolved to absolute URL
  | 'src'           // Image/media source resolved to absolute URL
  | 'html'          // innerHTML
  | 'number'        // Parsed numeric value (e.g. price $19.99 -> 19.99)
  | 'regex';        // Regular expression match on text

export interface FieldDefinition {
  id: string;
  name: string;
  selector: string; // Relative CSS selector from container element
  extractor: FieldExtractorType;
  attributeName?: string; // If extractor === 'attribute'
  regexPattern?: string;  // If extractor === 'regex'
  regexGroup?: number;    // Regex capture group index (default: 0)
  defaultValue?: string;
  required?: boolean;
}
```

### 1.2 ExtractionRecipe / Schema
```typescript
export interface ExtractionRecipe {
  id: string;
  name: string;
  urlPattern: string;
  containerSelector: string; // CSS selector for repeated items
  fields: FieldDefinition[];
  pagination?: {
    type: 'none' | 'next_button' | 'infinite_scroll';
    nextButtonSelector?: string;
    maxPages?: number;
    delayMs?: number;
    scrollCount?: number;
    scrollDelayMs?: number;
  };
  createdAt: number;
  updatedAt: number;
}
```

### 1.3 ExtractedRecord & Dataset
```typescript
export interface ExtractedRecord {
  _id: string;              // Unique record ID (hash of content or UUID)
  _page: number;            // Page or scroll batch where record was found
  _extractedAt: number;     // Timestamp
  [fieldName: string]: string | number | null | undefined;
}

export interface Dataset {
  id: string;
  name: string;
  url: string;
  recipeId?: string;
  recordsCount: number;
  fields: FieldDefinition[];
  createdAt: number;
  updatedAt: number;
}
```

## 2. Runtime Messages (SidePanel <-> ContentScript <-> Background)

Messages follow a discriminated union pattern:
- `PING` / `PONG`
- `START_PICKER` / `STOP_PICKER`
- `ELEMENT_SELECTED`
- `DETECT_REPEATED_ELEMENTS`
- `DETECT_FIELDS`
- `EXTRACT_RECORDS`
- `EXECUTE_PAGINATION_STEP`
- `EXECUTE_SCROLL_STEP`
- `EXTRACTION_PROGRESS`
- `EXTRACTION_ERROR`
