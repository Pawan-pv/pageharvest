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
- **Responsibilities**: Provide the database and the repositories. Production code uses repositories, not the database singleton.
- **Contract Compliance**:
  - Database operations must be transactional (`db.transaction('rw', ...)`).
  - Only the background `JobCoordinator` writes extraction records. The side panel never does.
- **Example Usage by Other Agents**:
  ```typescript
  import { RecipeRepository } from '@/storage/repositories';
  await new RecipeRepository().saveRecipe(recipe);
  ```

---

### 2.2 Agent 3 (DOM Inspector & Element Picker) Integration
- **Directory**: `src/content/picker/`
- **Overlay Boundary**: Must create a closed Shadow DOM rooted at `div#pageharvest-inspector-host`.
- **Selector Contract**: When an element is clicked, dispatch `ELEMENT_SELECTED`:
  ```typescript
  import { BrowserMessage } from '@/shared/contracts';

  const message: BrowserMessage = {
    id: messageId,
    timestamp: Date.now(),
    type: 'ELEMENT_SELECTED',
    payload: { selector, tagName, classList, textSnippet },
  };
  ```
  `PickerMessenger` validates every message against the protocol before sending.

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
  - `runNavigationJob` takes the recipe saved on the job, and reads limits only from it.
  - Every batch goes through `commitBatch`, and the runner does not move on until it resolves.
  - A checkpoint is committed before any action that can unload the document.
  - Aborts immediately when the job is cancelled.

---

### 2.6 Agent 7 (Side Panel UI & Tab Lifecycle) Integration
- **Directory**: `entrypoints/sidepanel/`
- **Responsibilities**: Render the user workflow. For extraction the panel is a view of stored state: it sends job commands to the background through `messagingService`, and reads jobs and records from IndexedDB. It must not write records or decide job state.

---

### 2.7 Agent 8 (Data Grid & Table UI) Integration
- **Directory**: `src/components/grid/`
- **Responsibilities**: Consume records from Dexie / state and render in TanStack Table.
- **Editing**: Grid changes persist through `onUpdateCell`, `onDeleteRecord` and `onRecordsChange`. Success is announced only after the save completes, and a failed save rolls the change back with the reason on screen.

---

### 2.8 Agent 9 (Export Engine & Data Pipeline) Integration
- **Directory**: `src/core/export/`
- **Responsibilities**: Serialize records into CSV, JSON, or NDJSON.
- **Contract**: Serializers take records and options. Downloads go through `triggerDownload` in `src/platform/downloads.ts`, the only download path.

---

### 2.9 Agent 10 (Resilience, Error Recovery & Integration) Integration
- **Directory**: `src/core/resilience/` and `tests/integration/`
- **Responsibilities**: Intercept unhandled exceptions, wrap them into `ExtractionErrorSchema`, and log them to storage and side panel UI.

---

## 3. Current Workflow Wiring

`entrypoints/content.ts` creates a `MessageRouter`, a `PickerMessenger`, and the coordinator from `src/content/workflow-coordinator.ts`, which handles detection and runs jobs through `runNavigationJob`. `EXTRACT_RECORDS` replies at once; a job's progress reaches the background only as acknowledged batches, because navigating closes any response channel. Failures become `EXTRACTION_ERROR` or `JOB_FAILED`, and are never replaced with sample data.

`entrypoints/background.ts` creates the `JobCoordinator`, connects it to the router with `registerJobHandlers`, and feeds it tab and startup events. It is the only writer of extraction data.

`src/hooks/useExtractionWorkflow.ts` sends job commands, and reads jobs and rows from storage. A running or finished job looks the same whether or not the panel was open while it ran.
