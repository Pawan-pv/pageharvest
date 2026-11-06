import React, { useMemo, useState, useEffect } from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { Card, CardHeader } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Dialog } from '@/components/common/Dialog';
import { Banner } from '@/components/common/Banner';
import { Select } from '@/components/common/Select';
import { UserSettingsSchema } from '@/shared/contracts/settings';
import { db } from '@/storage/db';
import { SettingsRepository } from '@/storage/repositories/settings-repository';
import { CsvDelimiter, DEFAULT_USER_SETTINGS, ExportFormat, UserSettings } from '@/types/settings';

export interface SettingsViewProps {
  onBackToDashboard: () => void;
}

const FIELD_LABELS: Partial<Record<keyof UserSettings, string>> = {
  defaultDelayMs: 'Default page delay must be between 200 and 30000 ms.',
  defaultMaxPages: 'Default max pages must be between 1 and 500.',
  defaultMaxScrolls: 'Default max scrolls must be between 1 and 200.',
  defaultScrollDelayMs: 'Default scroll delay must be between 300 and 10000 ms.',
  retentionDays: 'Interrupted sessions can be kept for 1 to 365 days.',
  maxRecordsWarningThreshold: 'The large dataset warning must be at least 100 rows.',
};

export const SettingsView: React.FC<SettingsViewProps> = ({ onBackToDashboard }) => {
  const repository = useMemo(() => new SettingsRepository(), []);
  const [draft, setDraft] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [datasetCount, setDatasetCount] = useState<number>(0);
  const [recordCount, setRecordCount] = useState<number>(0);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [settings, datasets, records] = await Promise.all([
          repository.getSettings(),
          db.datasets.count(),
          db.records.count(),
        ]);
        if (cancelled) return;
        setDraft(settings);
        setDatasetCount(datasets);
        setRecordCount(records);
      } catch (err) {
        if (!cancelled) {
          setSettingsError(`Could not load settings: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const update = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSavedFeedback(false);
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSavePreferences = async () => {
    setSavedFeedback(false);
    setSettingsError(null);

    const validation = UserSettingsSchema.safeParse(draft);
    if (!validation.success) {
      const field = validation.error.issues[0]?.path[0] as keyof UserSettings | undefined;
      setSettingsError((field && FIELD_LABELS[field]) ?? validation.error.issues[0]?.message ?? 'These settings are not valid.');
      return;
    }

    setIsSaving(true);
    try {
      await repository.updateSettings(validation.data);
      // Show what storage actually holds, and only then report success.
      setDraft(await repository.getSettings());
      setSavedFeedback(true);
    } catch (err) {
      setSettingsError(`Settings were not saved: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearAllData = async () => {
    setIsClearing(true);
    setSettingsError(null);
    try {
      await db.clearUserData();
      setDatasetCount(0);
      setRecordCount(0);
      setIsClearModalOpen(false);
    } catch (err) {
      setIsClearModalOpen(false);
      setSettingsError(`Saved data was not cleared: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-left h-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-fg leading-tight">
            Settings & Preferences
          </h2>
          <p className="text-xs text-fg-subtle mt-0.5">
            Configure default extraction throttling and storage
          </p>
        </div>

        <Button variant="outline" size="xs" onClick={onBackToDashboard}>
          Done
        </Button>
      </div>

      {savedFeedback && (
        <Banner tone="success" onDismiss={() => setSavedFeedback(false)}>
          Settings saved successfully.
        </Banner>
      )}

      {settingsError && (
        <Banner tone="danger" onDismiss={() => setSettingsError(null)}>
          {settingsError}
        </Banner>
      )}

      {/* Crawl & Extraction Defaults */}
      <Card variant="default">
        <CardHeader
          title="Extraction & Throttling"
          subtitle="Starting values for new extractions. You can still change them for each job."
        />

        <div className="flex flex-col gap-3">
          <Input
            type="number"
            label="Default Page Delay (ms)"
            min={200}
            max={30000}
            step={250}
            value={draft.defaultDelayMs}
            onChange={(e) => update('defaultDelayMs', Number(e.target.value))}
            helperText="Polite interval between page requests to avoid overwhelming servers."
          />

          <Input
            type="number"
            label="Default Max Pages Limit"
            min={1}
            max={500}
            value={draft.defaultMaxPages}
            onChange={(e) => update('defaultMaxPages', Number(e.target.value))}
            helperText="Circuit breaker to prevent unintentional infinite scraping loops."
          />

          <Input
            type="number"
            label="Default Max Scrolls"
            min={1}
            max={200}
            value={draft.defaultMaxScrolls}
            onChange={(e) => update('defaultMaxScrolls', Number(e.target.value))}
            helperText="How many times an infinite-scroll job scrolls before stopping."
          />

          <Input
            type="number"
            label="Default Scroll Delay (ms)"
            min={300}
            max={10000}
            step={250}
            value={draft.defaultScrollDelayMs}
            onChange={(e) => update('defaultScrollDelayMs', Number(e.target.value))}
          />

          <Input
            type="number"
            label="Keep Interrupted Sessions (days)"
            min={1}
            max={365}
            value={draft.retentionDays}
            onChange={(e) => update('retentionDays', Number(e.target.value))}
            helperText="An interrupted job can be resumed for this long. Its saved rows are always kept."
          />

          <Input
            type="number"
            label="Large Dataset Warning (rows)"
            min={100}
            value={draft.maxRecordsWarningThreshold}
            onChange={(e) => update('maxRecordsWarningThreshold', Number(e.target.value))}
          />
        </div>
      </Card>

      {/* Export Defaults */}
      <Card variant="default">
        <CardHeader
          title="Export Defaults"
          subtitle="Starting values for the export dialog."
        />

        <div className="flex flex-col gap-3">
          <Select
            label="Default Export Format"
            value={draft.defaultExportFormat}
            options={[
              { value: 'csv', label: 'CSV' },
              { value: 'json', label: 'JSON' },
              { value: 'ndjson', label: 'NDJSON' },
            ]}
            onChange={(e) => update('defaultExportFormat', e.target.value as ExportFormat)}
          />

          <Select
            label="CSV Delimiter"
            value={draft.csvDelimiter}
            options={[
              { value: ',', label: 'Comma (,)' },
              { value: ';', label: 'Semicolon (;)' },
              { value: '\t', label: 'Tab' },
            ]}
            onChange={(e) => update('csvDelimiter', e.target.value as CsvDelimiter)}
          />

          <Input
            type="number"
            label="JSON Indentation"
            min={0}
            max={8}
            value={draft.jsonIndent}
            onChange={(e) => update('jsonIndent', Number(e.target.value))}
          />

          <label className="flex items-center gap-2 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.csvIncludeBom}
              onChange={(e) => update('csvIncludeBom', e.target.checked)}
              className="w-4 h-4 rounded border-line-strong text-brand-fg focus:ring-focus"
            />
            <span className="text-xs text-fg-muted">
              Include UTF-8 BOM in CSV exports (recommended for Microsoft Excel)
            </span>
          </label>
        </div>
      </Card>

      <div>
        <Button
          variant="primary"
          size="sm"
          disabled={!isLoaded}
          isLoading={isSaving}
          onClick={() => void handleSavePreferences()}
        >
          Save Preferences
        </Button>
      </div>

      {/* Storage Management */}
      <Card variant="default">
        <CardHeader
          title="IndexedDB Storage"
          subtitle="All extracted tables and dataset runs are stored locally on your machine."
        />

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-surface-sunken border border-line">
              <span className="text-fg-subtle block text-2xs">Saved Datasets</span>
              <strong className="text-sm text-fg font-semibold">{datasetCount}</strong>
            </div>

            <div className="p-2.5 rounded-lg bg-surface-sunken border border-line">
              <span className="text-fg-subtle block text-2xs">Total Rows</span>
              <strong className="text-sm text-fg font-semibold">{recordCount}</strong>
            </div>
          </div>

          <div className="pt-1">
            <Button
              variant="danger"
              size="sm"
              iconLeft={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => setIsClearModalOpen(true)}
              disabled={datasetCount === 0 && recordCount === 0}
            >
              Clear All Saved Data
            </Button>
          </div>
        </div>
      </Card>

      {/* Privacy Notice */}
      <Card variant="flat" className="p-3.5 bg-surface-sunken/80 border-line/80">
        <div className="flex items-center gap-2 mb-1.5">
          <ShieldCheck className="w-4 h-4 text-brand-fg" />
          <h4 className="text-xs font-semibold text-fg">
            Privacy & Browser Safety
          </h4>
        </div>
        <p className="text-2xs text-fg-muted leading-relaxed">
          PageHarvest is 100% client-side. No remote AI endpoints, telemetry, or third-party servers receive your data.
        </p>
      </Card>

      {/* Clear Storage Modal */}
      <Dialog
        isOpen={isClearModalOpen}
        onClose={() => setIsClearModalOpen(false)}
        title="Clear All Saved Data?"
        description="This will permanently delete all datasets, projects, recipes, schemas, and history from IndexedDB. Your preferences are kept."
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsClearModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={isClearing}
              onClick={() => void handleClearAllData()}
            >
              Confirm Clear
            </Button>
          </>
        }
      >
        <p className="text-xs text-fg-muted">
          This operation cannot be reversed. Make sure you have exported any needed CSV or JSON datasets first.
        </p>
      </Dialog>
    </div>
  );
};
