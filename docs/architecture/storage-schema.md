# Storage Layer Architecture (Dexie / IndexedDB)

PageHarvest utilizes Dexie (IndexedDB) for completely offline, local-first storage.

## 1. Database Schema (`PageHarvestDB`)

```typescript
export class PageHarvestDB extends Dexie {
  datasets!: Table<DatasetEntity, string>;
  records!: Table<RecordEntity, string>;
  recipes!: Table<RecipeEntity, string>;
  history!: Table<ExtractionRunHistory, string>;

  constructor() {
    super('PageHarvestDB');
    this.version(1).stores({
      datasets: 'id, name, url, createdAt, updatedAt',
      records: '_id, datasetId, _page, _extractedAt',
      recipes: 'id, name, urlPattern, createdAt',
      history: 'id, datasetId, recipeId, status, startedAt, finishedAt'
    });
  }
}
```

## 2. Table Specifications

### `datasets` Table
- `id`: Primary key (UUID).
- `name`: Human-readable dataset name (e.g. "Amazon Laptops - 2026-11-01").
- `url`: Source URL where extraction started.
- `fields`: Serialized list of `FieldDefinition`.
- `recordsCount`: Total count of extracted rows.
- `createdAt` / `updatedAt`: Timestamps.

### `records` Table
- `_id`: Primary key (UUID or hash-based ID).
- `datasetId`: Indexed foreign key to `datasets`.
- `_page`: Page number where record was discovered.
- `_extractedAt`: Timestamp.
- Key-value pairs for all extracted fields.

### `recipes` Table
- Reusable extraction recipes so users don't have to re-pick selectors when revisiting a site.
- Includes container selector, field list, and pagination configuration.

### `history` Table
- Audit log of extraction runs.
- Tracks started timestamp, finished timestamp, total extracted, duplicates skipped, error messages.
