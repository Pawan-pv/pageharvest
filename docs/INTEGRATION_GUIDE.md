# PageHarvest Multi-Agent Integration Guide

This guide provides technical instructions for all AI engineering agents implementing feature modules within PageHarvest.

---

## 1. Consuming Shared Contracts

All subsystem interfaces, message payloads, and data entities must be imported from:
```typescript
import {
  ExtractionProject,
  ExtractionJob,
  ExtractionSchema,
  ExtractionField,
  ExtractionRecord,
  DetectedList,
  PaginationConfig,
  ExtractionProgress,
  ExtractionError,
  BrowserMessage,
  ExportConfig,
  // Zod Schemas:
  ExtractionProjectSchema,
  ExtractionFieldSchema,
  BrowserMessageSchema,
  // ...
} from '@/shared/contracts';
```

> [!WARNING]
> **Never Invent Local Types**: Do not declare ad-hoc interfaces like `interface MyField` or `type ScrapedData`. Always consume the canonical types above.

---

## 2. Agent Integration Protocols

### 2.1 Agent 2 (Storage & Persistence) Integration
- **Directory**: `src/storage/`
- **Responsibilities**: Provide a singleton database instance and repository helpers.
- **Contract Compliance**:
  - `projects` table must store entities validated against `ExtractionProjectSchema`.
  - `records` table must store objects conforming to `ExtractionRecordSchema`.
  - Database operations must be transactional (`db.transaction('rw', ...)`).
- **Example Usage by Other Agents**:
  ```typescript
  import { db } from '@/storage/db';
  // Insert extracted records
  await db.records.bulkAdd(extractedRecords);
  ```

---

### 2.2 Agent 3 (DOM Inspector & Element Picker) Integration
- **Directory**: `src/content/picker/`
- **Overlay Boundary**: Must create a closed Shadow DOM rooted at `div#pageharvest-inspector-host`.
- **Selector Contract**: When an element is clicked, dispatch `ELEMENT_SELECTED`:
  ```typescript
  import { BrowserMessage } from '@/shared/contracts';

  const message: BrowserMessage = {
    type: 'ELEMENT_SELECTED',
    selector: generatedSelector,
    tagName: target.tagName,
    previewText: target.textContent?.trim().slice(0, 100) || '',
    attributes: extractAttributes(target),
    boundingBox: target.getBoundingClientRect(),
  };
  chrome.runtime.sendMessage(message);
  ```

---

### 2.3 Agent 4 (Pattern Detection Engine) Integration
- **Directory**: `src/core/detection/`
- **Input**: Target DOM element or seed selector.
- **Output**: Returns `DetectedList[]` validated against `DetectedListSchema`.
- **Example Signature**:
  ```typescript
  import { DetectedList } from '@/shared/contracts';

  export function detectRepeatedContainers(
    seedElement: Element,
    root: Document | Element = document
  ): DetectedList[];
  ```

---

### 2.4 Agent 5 (Extraction Engine & Data Normalization) Integration
- **Directory**: `src/core/extraction/`
- **Input**: `containerSelector: string`, `fields: ExtractionField[]`, `pageNumber: number`.
- **Output**: `ExtractionRecord[]` with metadata (`_id`, `_page`, `_extractedAt`, `_hash`).
- **Example Signature**:
  ```typescript
  import { ExtractionField, ExtractionRecord } from '@/shared/contracts';

  export function extractRecordsFromContainers(
    containers: Element[],
    fields: ExtractionField[],
    pageNumber: number,
    seenHashes: Set<string>
  ): { records: ExtractionRecord[]; duplicatesSkipped: number; totalParsed: number };
  ```

---

### 2.5 Agent 6 (Navigation & Pagination) Integration
- **Directory**: `src/core/navigation/`
- **Responsibilities**: Execute multi-page step transitions.
- **Contract**:
  - Accepts `PaginationConfig`.
  - Emits `ExtractionProgress` updates after every page step.
  - Aborts immediately if user calls `STOP_JOB` or circuit breaker triggers.

---

### 2.6 Agent 7 (Side Panel UI & Tab Lifecycle) Integration
- **Directory**: `entrypoints/sidepanel/`
- **Responsibilities**: Render the user workflow and dispatch typed messages to active tab content script:
  ```typescript
  import { BrowserMessage, BrowserMessageSchema } from '@/shared/contracts';

  export async function sendTabMessage(tabId: number, message: BrowserMessage): Promise<unknown> {
    const validated = BrowserMessageSchema.parse(message);
    return chrome.tabs.sendMessage(tabId, validated);
  }
  ```

---

### 2.7 Agent 8 (Data Grid & Table UI) Integration
- **Directory**: `src/components/grid/`
- **Responsibilities**: Consume records from Dexie / state and render in TanStack Table.
- **Inline Editing**: Modifying a cell triggers `db.records.update(recordId, { [fieldName]: newValue })`.

---

### 2.8 Agent 9 (Export Engine & Data Pipeline) Integration
- **Directory**: `src/core/export/`
- **Responsibilities**: Serialize records into CSV, JSON, or NDJSON.
- **Contract**: Accepts `ExportConfig` and `ExtractionRecord[]`.
  ```typescript
  import { ExportConfig, ExtractionRecord } from '@/shared/contracts';

  export function serializeToCsv(
    records: ExtractionRecord[],
    config: ExportConfig
  ): string;
  ```

---

### 2.9 Agent 10 (Resilience, Error Recovery & Integration) Integration
- **Directory**: `src/core/resilience/` and `tests/integration/`
- **Responsibilities**: Intercept unhandled exceptions, wrap them into `ExtractionErrorSchema`, and log them to storage and side panel UI.
