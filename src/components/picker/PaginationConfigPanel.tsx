import React from 'react';
import { ArrowRightCircle, MoveDown, Compass, Clock, Sliders } from 'lucide-react';
import { Card, CardHeader } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { ExtractionPaginationConfig, PaginationType } from '@/types';

export interface PaginationConfigPanelProps {
  config: ExtractionPaginationConfig;
  onChange: (updated: Partial<ExtractionPaginationConfig>) => void;
}

export const PaginationConfigPanel: React.FC<PaginationConfigPanelProps> = ({
  config,
  onChange,
}) => {
  const modes: { type: PaginationType; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      type: 'none',
      label: 'Single Page',
      icon: <Compass className="w-3.5 h-3.5" />,
      desc: 'Extract only visible items on the current page',
    },
    {
      type: 'next_button',
      label: 'Next Button',
      icon: <ArrowRightCircle className="w-3.5 h-3.5" />,
      desc: 'Click "Next" button across multiple pages',
    },
    {
      type: 'infinite_scroll',
      label: 'Infinite Scroll',
      icon: <MoveDown className="w-3.5 h-3.5" />,
      desc: 'Scroll down to load lazy/infinite content',
    },
  ];

  return (
    <Card variant="flat" className="text-left bg-slate-50/70 p-3.5 border-slate-200/80">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Sliders className="w-3.5 h-3.5 text-slate-700" />
        <h4 className="text-xs font-semibold text-slate-800">
          Navigation & Pagination Strategy
        </h4>
      </div>

      {/* Mode selection buttons */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {modes.map((mode) => (
          <button
            key={mode.type}
            type="button"
            onClick={() => onChange({ type: mode.type })}
            className={`flex flex-col items-start p-2 rounded-lg border text-left transition-all ${
              config.type === mode.type
                ? 'bg-white border-emerald-600 text-emerald-900 shadow-xs ring-1 ring-emerald-600'
                : 'bg-white/70 border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-1 mb-1">
              <span className={config.type === mode.type ? 'text-emerald-700' : 'text-slate-500'}>
                {mode.icon}
              </span>
              <span className="text-xs font-semibold">{mode.label}</span>
            </div>
            <span className="text-[10px] text-slate-500 leading-tight">
              {mode.desc}
            </span>
          </button>
        ))}
      </div>

      {/* Mode specific parameters */}
      {config.type === 'next_button' && (
        <div className="flex flex-col gap-2.5 pt-2 border-t border-slate-200/60">
          <Input
            label="Next Button Selector"
            placeholder="e.g. a.next, [rel='next'], button:has-text('Next')"
            value={config.nextButtonSelector || ''}
            onChange={(e) => onChange({ nextButtonSelector: e.target.value })}
            helperText="CSS selector identifying the pagination button"
          />

          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              label="Max Pages to Crawl"
              min={1}
              max={100}
              value={config.maxPages || 10}
              onChange={(e) => onChange({ maxPages: parseInt(e.target.value, 10) || 1 })}
            />
            <Input
              type="number"
              label="Delay Between Pages (ms)"
              min={500}
              max={10000}
              step={250}
              value={config.delayMs || 1500}
              onChange={(e) => onChange({ delayMs: parseInt(e.target.value, 10) || 1500 })}
            />
          </div>
        </div>
      )}

      {config.type === 'infinite_scroll' && (
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/60">
          <Input
            type="number"
            label="Max Scrolls"
            min={1}
            max={200}
            value={config.scrollCount || 20}
            onChange={(e) => onChange({ scrollCount: parseInt(e.target.value, 10) || 1 })}
          />
          <Input
            type="number"
            label="Scroll Delay (ms)"
            min={500}
            max={5000}
            step={250}
            value={config.scrollDelayMs || 1000}
            onChange={(e) => onChange({ scrollDelayMs: parseInt(e.target.value, 10) || 1000 })}
          />
        </div>
      )}
    </Card>
  );
};
