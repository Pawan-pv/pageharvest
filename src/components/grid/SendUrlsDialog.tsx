import React, { useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Dialog } from '@/components/common/Dialog';
import { columnValues } from './grid-features';
import { TOOL_OPTIONS } from './tool-catalog';
import { dedupeUrls } from '@/platform/url-handoff';
import type { ToolType } from '@/shared/contracts/tool-job';
import type { ExtractedRecord } from '@/types';

export interface SendUrlsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  records: ExtractedRecord[];
  /** The URL columns found in this table. */
  columns: string[];
  datasetId?: string;
  onSend: (tool: ToolType, urls: string[], column: string) => Promise<void>;
}

/** Hands one URL column to a tool workspace, with a count of what will be sent. */
export const SendUrlsDialog: React.FC<SendUrlsDialogProps> = ({
  isOpen,
  onClose,
  records,
  columns,
  datasetId,
  onSend,
}) => {
  const [tool, setTool] = useState<ToolType>('page');
  const [column, setColumn] = useState<string>(columns[0] ?? '');
  const [isSending, setIsSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTool('page');
    setColumn(columns[0] ?? '');
    setIsSending(false);
    setProblem(null);
  }, [isOpen, columns]);

  const urls = useMemo(
    () => (column ? dedupeUrls(columnValues(records, column)) : []),
    [records, column]
  );

  const send = async () => {
    if (urls.length === 0) {
      setProblem('This column has no web addresses to send.');
      return;
    }
    setIsSending(true);
    setProblem(null);
    try {
      await onSend(tool, urls, column);
      onClose();
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Send URLs to a tool"
      description={
        datasetId
          ? 'The addresses are handed to the tool workspace in this browser. Nothing leaves your computer.'
          : 'The addresses are handed to the tool workspace in this browser.'
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Send aria-hidden="true" className="w-3.5 h-3.5" />}
            isLoading={isSending}
            disabled={urls.length === 0}
            onClick={() => void send()}
          >
            Send {urls.length} {urls.length === 1 ? 'URL' : 'URLs'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {columns.length > 1 && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-fg-muted">
            Column with the addresses
            <select
              aria-label="URL column"
              value={column}
              onChange={(event) => setColumn(event.target.value)}
              className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-xs text-fg-muted focus:outline-none"
            >
              {columns.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-fg-muted">Tool</span>
          <div className="max-h-52 overflow-y-auto rounded-lg border border-line p-1.5 flex flex-col gap-0.5">
            {TOOL_OPTIONS.map((option) => (
              <label
                key={option.id}
                className="flex items-start gap-2 rounded px-1.5 py-1 text-xs text-fg-muted hover:bg-surface-sunken cursor-pointer"
              >
                <input
                  type="radio"
                  name="tool"
                  checked={tool === option.id}
                  onChange={() => setTool(option.id)}
                  className="mt-0.5 w-3.5 h-3.5 border-line-strong text-brand-fg focus:ring-focus"
                />
                <span className="flex flex-col">
                  <span className="font-medium text-fg">{option.label}</span>
                  <span className="text-fg-subtle">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <p className="text-xs text-fg-muted" role="status">
          {urls.length === 0
            ? 'No web addresses found in this column.'
            : `${urls.length} ${urls.length === 1 ? 'address' : 'addresses'} will be sent.`}
        </p>

        {problem && (
          <p role="alert" className="text-xs text-danger-fg">
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  );
};
