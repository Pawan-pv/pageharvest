import React from 'react';
import { ShieldCheck, HardDrive, EyeOff, Scale, ExternalLink } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { PRIVACY_POLICY_URL } from '@/components/guide/links';

export interface ConsentGateProps {
  onAccept: () => void;
}

export const ConsentGate: React.FC<ConsentGateProps> = ({ onAccept }) => {
  return (
    <div className="flex flex-col h-full bg-surface text-fg p-5 justify-between select-none">
      <div className="space-y-5">
        {/* Brand & Badge */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand-fg shrink-0">
            <ShieldCheck className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h1 className="text-base font-bold text-fg tracking-tight">Before you start</h1>
            <p className="text-xs text-fg-muted">Transparent, local-first data extraction</p>
          </div>
        </div>

        {/* Introduction */}
        <p className="text-sm text-fg-muted leading-relaxed">
          PageHarvest helps you collect information you choose from web pages into clean tables you can save as spreadsheets.
        </p>

        {/* 3 Core Trust Principles */}
        <div className="space-y-3 pt-1">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-surface-muted border border-line/70">
            <HardDrive className="w-4 h-4 text-brand-fg mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed text-fg-muted">
              <span className="font-semibold text-fg block mb-0.5">100% local processing in your browser</span>
              Everything PageHarvest reads and extracts stays directly on your computer. Your data never leaves your device.
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-xl bg-surface-muted border border-line/70">
            <EyeOff className="w-4 h-4 text-brand-fg mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed text-fg-muted">
              <span className="font-semibold text-fg block mb-0.5">No accounts, analytics, or external servers</span>
              No sign-ups, tracking, advertising, or background telemetry. We cannot see or monetize what you collect.
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-xl bg-surface-muted border border-line/70">
            <Scale className="w-4 h-4 text-brand-fg mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed text-fg-muted">
              <span className="font-semibold text-fg block mb-0.5">Respect site terms & applicable laws</span>
              You are responsible for ensuring you have permission to extract data, and for respecting website terms, copyright, and privacy laws.
            </div>
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="pt-5 space-y-3 border-t border-line/60">
        <Button
          variant="primary"
          size="lg"
          className="w-full justify-center font-semibold text-sm shadow-sm"
          onClick={onAccept}
        >
          I understand, continue
        </Button>

        <div className="text-center">
          <a
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand hover:underline font-medium"
          >
            Read our full privacy policy
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};
