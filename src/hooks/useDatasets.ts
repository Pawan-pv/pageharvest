import { useState, useEffect, useCallback } from 'react';
import { db } from '@/storage/db';
import { Dataset, ExtractedRecord } from '@/types';

export function useDatasets() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadDatasets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const all = await db.datasets.orderBy('createdAt').reverse().toArray();
      setDatasets(all);
    } catch (err) {
      console.error('Failed to load datasets:', err);
      setError('Could not load saved datasets from local storage.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  const deleteDataset = useCallback(
    async (datasetId: string) => {
      try {
        await db.deleteDatasetWithRecords(datasetId);
        setDatasets((prev) => prev.filter((d) => d.id !== datasetId));
      } catch (err) {
        console.error('Failed to delete dataset:', err);
        throw new Error('Failed to delete dataset.');
      }
    },
    []
  );

  const getDatasetRecords = useCallback(
    async (datasetId: string): Promise<ExtractedRecord[]> => {
      return await db.getDatasetRecords(datasetId);
    },
    []
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
