# Storage Layer Architecture (Dexie / IndexedDB)

PageHarvest uses Dexie over IndexedDB, in the extension's origin, for completely offline, local-first storage. Production code reaches it through the repositories in `src/storage/repositories/`.

## 1. Current Schema (version 3)

```typescript
datasets:    'id, name, url, projectId, jobId, createdAt, updatedAt'
records:     '_id, datasetId, _jobId, _projectId, _page, _extractedAt, _hash, [datasetId+_hash]'
recipes:     'id, name, urlPattern, schemaId, projectId, createdAt, updatedAt'
history:     'id, datasetId, jobId, projectId, recipeId, status, startedAt, finishedAt'
projects:    'id, name, status, createdAt, updatedAt'
jobs:        'id, projectId, datasetId, status, tabId, startedAt, finishedAt'
schemas:     'id, name, urlPattern, projectId, createdAt, updatedAt'
settings:    'id, updatedAt'
checkpoints: 'jobId, tabId, updatedAt, expiresAt'
```

## 2. Production Persistence Matrix

Every operation listed has a production caller, not only a test.

| Entity/table | Create | Read | Update | Delete | Production wired |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Projects | Automatically per website when a job starts; Library > Projects | Library, job start, field panel | Library rename | Library, cascading in one transaction; refused while a job runs | Yes |
| Jobs | Coordinator on `START_JOB` | Panel, recovery banner, coordinator | Coordinator, in the transaction of each event | With their project | Yes |
| Records | Coordinator on `RECORD_BATCH` only | Grid, exports | Grid cell edit and cleaning | Grid, dataset and project delete | Yes |
| Schemas | Coordinator on job start, one per distinct configuration | Library > Schemas | Library edit | Library; refused while a recipe uses it | Yes |
| Recipes | Save Recipe in the field panel | Library > Recipes, Run | Library edit | Library | Yes |
| Settings | Written with defaults on first read | Settings view, new extractions, export dialog, coordinator retention | Settings view, validated | Never deleted; "Clear All Saved Data" keeps preferences | Yes |
| History | Coordinator, in the transaction of each terminal state | Library > Run History | Never rewritten | With their project | Yes |
| Pagination sessions (`checkpoints`) | Coordinator on job start | Coordinator on resume, navigation and expiry | Coordinator on each batch | In the transaction of each terminal state | Yes |
| Datasets | Coordinator on job start | Datasets, grid | Grid edits, counts on each batch | Datasets, project delete | Yes |

## 3. Associations

- Every job has a project, a dataset and a schema. Every dataset and record has its job and project.
- Deleting a project removes its datasets, records, jobs, checkpoints and history in one transaction. Recipes and schemas outlive it with the link cleared.
- A job and a dataset keep their own copy of the fields they used, so history stays accurate if a schema is edited or deleted.

## 4. Record Order

`_order` is `sequence * 1,000,000 + index`, assigned when a batch commits. `compareRecordOrder` is the single definition of display order. Rows from before version 3 are given an `_order` by the migration.

## 5. Migrations

| Version | Change |
| :--- | :--- |
| 1 | Initial tables |
| 2 | Foreign key indexes; recipes copied into schemas |
| 3 | `checkpoints`; associations; `[datasetId+_hash]`; job and history statuses mapped to the lifecycle; settings upgraded; `_order` assigned |

A migration failure aborts the upgrade and leaves the previous version intact. Jobs that were running before version 3 become FAILED, because they have no checkpoint and cannot resume.
