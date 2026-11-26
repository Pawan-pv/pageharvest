import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DatasetRepository } from '@/storage/repositories';
import { messagingService } from '@/services/messaging';
import { Dataset, ExtractedRecord } from '@/types';

export function useDatasets() {
  const repository = useMemo(() => new DatasetRepository(), []);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const loadDatasets = useCallback(async (options?: { silent?: boolean }) => {
    if (!isMountedRef.current) return;
    if (!options?.silent) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const all = await repository.getAllDatasets();
      if (!isMountedRef.current) return;
      setDatasets(all);
    } catch (err) {
      console.error('Failed to load datasets:', err);
      if (!isMountedRef.current) return;
      setError('Could not load saved datasets from local storage.');
    } finally {
      if (isMountedRef.current && !options?.silent) {
        setIsLoading(false);
      }
    }
  }, [repository]);

  useEffect(() => {
    isMountedRef.current = true;
    loadDatasets();
    return () => {
      isMountedRef.current = false;
    };
  }, [loadDatasets]);

  const deleteDataset = useCallback(
    async (datasetId: string) => {
      try {
        // The background is the only writer. A list a job can still write to is refused
        // there; the error keeps its name and its message says what to do.
        await messagingService.deleteDataset(datasetId);
        setDatasets((prev) => prev.filter((d) => d.id !== datasetId));
      } catch (err) {
        console.error('Failed to delete dataset:', err);
        throw err;
      }
    },
    []
  );

  const renameDataset = useCallback(
    async (datasetId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('A saved list needs a name.');
      await messagingService.renameDataset(datasetId, trimmed);
      setDatasets((prev) =>
        prev.map((dataset) =>
          dataset.id === datasetId ? { ...dataset, name: trimmed, updatedAt: Date.now() } : dataset
        )
      );
    },
    []
  );

  const getDatasetRecords = useCallback(
    async (datasetId: string): Promise<ExtractedRecord[]> => {
      return await repository.getRecordsByDataset(datasetId);
    },
    [repository]
  );

  return {
    datasets,
    isLoading,
    error,
    refreshDatasets: loadDatasets,
    deleteDataset,
    renameDataset,
    getDatasetRecords,
  };
}
