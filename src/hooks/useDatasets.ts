import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DatasetRepository } from '@/storage/repositories';
import { Dataset, ExtractedRecord } from '@/types';

export function useDatasets() {
  const repository = useMemo(() => new DatasetRepository(), []);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const loadDatasets = useCallback(async () => {
    if (!isMountedRef.current) return;
    setIsLoading(true);
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
      if (isMountedRef.current) {
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
        await repository.deleteDataset(datasetId);
        setDatasets((prev) => prev.filter((d) => d.id !== datasetId));
      } catch (err) {
        console.error('Failed to delete dataset:', err);
        throw new Error('Failed to delete dataset.', { cause: err });
      }
    },
    [repository]
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
    getDatasetRecords,
  };
}
