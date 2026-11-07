import React, { useRef, useState } from 'react';
import { Wheat, Sparkles, Columns3, Download, ShieldCheck } from 'lucide-react';
import { Dialog } from '@/components/common/Dialog';
import { Button } from '@/components/common/Button';

export interface OnboardingStep {
  title: string;
  body: string;
  icon: React.ReactNode;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: 'Welcome to PageHarvest',
    body: 'PageHarvest turns lists on websites, such as products, search results or articles, into a table you can save as a spreadsheet.',
    icon: <Wheat className="w-5 h-5" />,
  },
  {
    title: 'Find or pick your data',
    body: 'Open a website and press "Find data automatically". If it chooses the wrong thing, press "Pick items myself" and click one item on the page.',
    icon: <Sparkles className="w-5 h-5" />,
  },
  {
    title: 'Review the columns',
    body: 'Each item becomes a row. Keep the columns you want, rename them, and choose what each one collects: text, a link, an image, a number and more.',
    icon: <Columns3 className="w-5 h-5" />,
  },
  {
    title: 'Run it, then export',
    body: 'PageHarvest can follow Next buttons or scroll for more. You can close the panel while it works. When it is done, export a CSV for Excel or Google Sheets.',
    icon: <Download className="w-5 h-5" />,
  },
  {
    title: 'Your data stays on your computer',
    body: 'Everything is stored in this browser. Nothing is uploaded, there is no account, and no tracking. You can reopen this tour from Help at any time.',
    icon: <ShieldCheck className="w-5 h-5" />,
  },
];

export interface OnboardingProps {
  /** Called when the tour is finished, skipped or closed. */
  onFinish: () => void;
}

/** The first-run tour. Skip, Escape and the close button all end it. */
export const Onboarding: React.FC<OnboardingProps> = ({ onFinish }) => {
  const [index, setIndex] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = ONBOARDING_STEPS[index];
  const isLast = index === ONBOARDING_STEPS.length - 1;

  return (
    <Dialog
      isOpen
      onClose={onFinish}
      title={step.title}
      description={`Step ${index + 1} of ${ONBOARDING_STEPS.length}`}
      size="sm"
      initialFocusRef={nextRef}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onFinish}>
            Skip tour
          </Button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button variant="outline" size="sm" onClick={() => setIndex((i) => i - 1)}>
                Back
              </Button>
            )}
            <Button
              ref={nextRef}
              size="sm"
              onClick={() => {
                if (isLast) {
                  onFinish();
                } else {
                  setIndex((i) => i + 1);
                  nextRef.current?.focus();
                }
              }}
            >
              {isLast ? 'Get started' : 'Next'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col items-start gap-3">
        <span
          aria-hidden="true"
          className="w-10 h-10 rounded-control bg-brand-soft text-brand-fg flex items-center justify-center"
        >
          {step.icon}
        </span>
        <p className="text-sm text-fg-muted leading-relaxed">{step.body}</p>
        <div aria-hidden="true" className="flex gap-1">
          {ONBOARDING_STEPS.map((item, i) => (
            <span key={item.title} className={`h-1.5 w-6 rounded-pill ${i <= index ? 'bg-brand' : 'bg-surface-strong'}`} />
          ))}
        </div>
      </div>
    </Dialog>
  );
};
