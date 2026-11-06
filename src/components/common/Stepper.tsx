import React from 'react';

export interface StepperStep {
  id: string;
  label: string;
  optional?: boolean;
}

export interface StepperProps {
  steps: StepperStep[];
  currentId: string;
  className?: string;
}

/** Where the user is in a multi-step flow. State is spoken as text, not only shown as colour. */
export const Stepper: React.FC<StepperProps> = ({ steps, currentId, className = '' }) => {
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === currentId)
  );
  const current = steps[currentIndex];

  return (
    <nav aria-label="Extraction steps" className={`text-left ${className}`}>
      <p className="text-2xs text-fg-subtle mb-1.5">
        Step {currentIndex + 1} of {steps.length}:{' '}
        <span className="font-semibold text-fg">{current.label}</span>
        {current.optional && ' (optional)'}
      </p>
      <ol className="flex items-start gap-1">
        {steps.map((step, index) => {
          const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
          return (
            <li
              key={step.id}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex-1 min-w-0 flex flex-col gap-1"
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-full rounded-pill ${
                  state === 'upcoming' ? 'bg-surface-strong' : state === 'current' ? 'bg-brand' : 'bg-brand/60'
                }`}
              />
              <span
                className={`text-2xs truncate ${
                  state === 'current' ? 'font-semibold text-fg' : state === 'done' ? 'text-fg-muted' : 'text-fg-subtle'
                }`}
              >
                {step.label}
                {state === 'done' && <span className="sr-only"> (done)</span>}
                {step.optional && <span className="sr-only"> (optional)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
