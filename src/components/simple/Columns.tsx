import React, { useId, useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import { Button } from '@/components/common/Button';
import type { DetectedList } from '@/hooks/useExtractionWorkflow';
import type { ExtractionPaginationConfig, FieldDefinition } from '@/types';
import {
  SIMPLE_DEFAULT_PAGES,
  SIMPLE_DEFAULT_SCROLLS,
  SIMPLE_MAX_PAGES,
  answerFor,
  listContinues,
  settingsForAnswer,
  type MorePagesAnswer,
} from './more-pages';

export interface SimpleColumnsProps {
  detectedList: DetectedList;
  /** Every column found for the list, ticked or not. */
  fields: FieldDefinition[];
  selectedFieldIds: Set<string>;
  pagination: ExtractionPaginationConfig;
  onToggleField: (id: string) => void;
  onRenameField: (id: string, name: string) => void;
  onPaginationChange: (updates: Partial<ExtractionPaginationConfig>) => void;
  onBack: () => void;
  onStart: () => void;
}

/** A name no other column has, so two columns can never write into one. */
function uniqueName(wanted: string, taken: string[]): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()));
  if (!lower.has(wanted.toLowerCase())) return wanted;
  for (let n = 2; ; n += 1) {
    const candidate = `${wanted} ${n}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

const ColumnRow: React.FC<{
  field: FieldDefinition;
  ticked: boolean;
  otherNames: string[];
  onToggle: () => void;
  onRename: (name: string) => void;
}> = ({ field, ticked, otherNames, onToggle, onRename }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const example = field.discovery?.sampleValue;

  // The name is kept while typing and written when the user leaves the box, so a half-typed
  // name is never a column name, and an emptied box goes back to the name it had.
  const commit = () => {
    if (draft === null) return;
    const wanted = draft.trim();
    setDraft(null);
    if (!wanted || wanted === field.name) return;
    onRename(uniqueName(wanted, otherNames));
  };

  return (
    <li
      className={`flex items-start gap-2.5 p-2.5 rounded-card border ${
        ticked ? 'bg-surface border-line' : 'bg-surface-sunken border-line-subtle'
      }`}
    >
      <input
        type="checkbox"
        checked={ticked}
        onChange={onToggle}
        aria-label={`Keep the column ${field.name}`}
        className="mt-1.5 w-5 h-5 shrink-0 rounded border-line-strong accent-brand cursor-pointer"
      />
      <div className="min-w-0 flex-1">
        <input
          type="text"
          value={draft ?? field.name}
          disabled={!ticked}
          aria-label={`Name of the column ${field.name}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setDraft(null);
          }}
          className="w-full min-h-8 rounded-control border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-fg hover:border-line-strong focus:border-focus focus:bg-surface focus:outline-none focus:ring-1 focus:ring-focus disabled:text-fg-subtle disabled:hover:border-transparent"
        />
        <p className="px-1.5 text-body text-fg-muted truncate">
          {ticked ? (example ? `For example: ${example}` : 'No example on this page') : 'Left out'}
        </p>
      </div>
    </li>
  );
};

const AnswerOption: React.FC<{
  name: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
}> = ({ name, label, checked, onSelect, children }) => {
  const id = useId();
  return (
    <div
      className={`rounded-card border p-2.5 ${checked ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong'}`}
    >
      <div className="flex items-center gap-2.5">
        <input
          id={id}
          type="radio"
          name={name}
          checked={checked}
          onChange={onSelect}
          className="h-5 w-5 shrink-0 accent-brand cursor-pointer"
        />
        <label htmlFor={id} className="flex-1 min-h-6 flex items-center text-sm font-medium text-fg cursor-pointer">
          {label}
        </label>
      </div>
      {checked && children}
    </div>
  );
};

/**
 * Simple mode's second step (ADR-039): keep or leave out each column, change a name by
 * typing over it, and answer one question about more pages. What each column reads, and how
 * the pages are followed, were worked out when the list was found; the detailed controls for
 * both are under Advanced options.
 */
export const SimpleColumns: React.FC<SimpleColumnsProps> = ({
  detectedList,
  fields,
  selectedFieldIds,
  pagination,
  onToggleField,
  onRenameField,
  onPaginationChange,
  onBack,
  onStart,
}) => {
  const group = useId();
  const countId = useId();
  const legendId = useId();
  const ticked = fields.filter((field) => selectedFieldIds.has(field.id)).length;
  const continues = listContinues(detectedList.moreItems);
  const answer = answerFor(pagination);
  const count =
    answer === 'scroll'
      ? (pagination.scrollCount ?? SIMPLE_DEFAULT_SCROLLS)
      : (pagination.maxPages ?? SIMPLE_DEFAULT_PAGES);

  const choose = (next: MorePagesAnswer) =>
    onPaginationChange(
      settingsForAnswer(next, next === 'scroll' ? pagination.scrollCount : pagination.maxPages)
    );

  const countField = (label: string) => (
    <div className="mt-2 pl-7 flex flex-wrap items-center gap-2">
      <label htmlFor={countId} className="text-body text-fg-muted">
        {label}
      </label>
      <input
        id={countId}
        type="number"
        inputMode="numeric"
        min={1}
        max={SIMPLE_MAX_PAGES}
        value={count}
        onChange={(event) => {
          const typed = Number.parseInt(event.target.value, 10);
          if (Number.isFinite(typed)) onPaginationChange(settingsForAnswer(answer, typed));
        }}
        className="w-20 min-h-8 rounded-control border border-line-strong bg-surface px-2 py-1 text-sm text-fg focus:outline-none focus:border-focus focus:ring-1 focus:ring-focus"
      />
    </div>
  );

  const yesNext = (
    <AnswerOption
      name={group}
      label={continues ? 'Yes, get more pages' : 'Yes, it has a Next button or page numbers'}
      checked={answer === 'next'}
      onSelect={() => choose('next')}
    >
      {countField('Stop after this many pages:')}
    </AnswerOption>
  );
  const no = (
    <AnswerOption name={group} label="No, just this page" checked={answer === 'no'} onSelect={() => choose('no')} />
  );

  return (
    <div className="flex flex-col gap-4 p-4 text-left">
      <div>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<ArrowLeft aria-hidden="true" className="w-3.5 h-3.5" />}
          onClick={onBack}
        >
          Back
        </Button>
      </div>

      <section aria-labelledby={`${legendId}-columns`} className="flex flex-col gap-2">
        <div>
          <h2 id={`${legendId}-columns`} className="text-base font-semibold text-fg">
            Check your columns
          </h2>
          <p className="text-body text-fg-muted mt-1">
            Each ticked column goes into your spreadsheet. Untick the ones you do not need. To change a name, type
            over it.
          </p>
        </div>
        {fields.length === 0 ? (
          <p className="text-body text-fg-muted" role="status">
            Reading the columns from the page…
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {fields.map((field) => (
              <ColumnRow
                key={field.id}
                field={field}
                ticked={selectedFieldIds.has(field.id)}
                otherNames={fields.filter((other) => other.id !== field.id).map((other) => other.name)}
                onToggle={() => onToggleField(field.id)}
                onRename={(name) => onRenameField(field.id, name)}
              />
            ))}
          </ul>
        )}
      </section>

      <fieldset aria-labelledby={legendId} className="min-w-0 flex flex-col gap-1.5">
        <h2 id={legendId} className="text-base font-semibold text-fg">
          {continues ? 'This list continues on more pages. Get them too?' : 'Does this list continue on more pages?'}
        </h2>
        {continues ? (
          <>
            {yesNext}
            {no}
          </>
        ) : (
          <>
            {no}
            {yesNext}
            <AnswerOption
              name={group}
              label="Yes, more items appear when I scroll down"
              checked={answer === 'scroll'}
              onSelect={() => choose('scroll')}
            >
              {countField('Stop after scrolling this many times:')}
            </AnswerOption>
          </>
        )}
      </fieldset>

      <div>
        <Button
          size="lg"
          className="w-full justify-center font-semibold"
          iconLeft={<Play aria-hidden="true" className="w-4 h-4 fill-current" />}
          disabled={ticked === 0}
          onClick={onStart}
        >
          Start collecting
        </Button>
        {fields.length > 0 && ticked === 0 && (
          <p className="text-body text-danger-fg text-center mt-2" role="status">
            Tick at least one column to start.
          </p>
        )}
      </div>
    </div>
  );
};
