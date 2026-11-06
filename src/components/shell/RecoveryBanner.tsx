import React, { useState } from 'react';
import type { ExtractionJob } from '@/shared/contracts/job';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';
import { Dialog } from '@/components/common/Dialog';
import { HelpTip } from '@/components/common/Tooltip';
import { describeProgress, formatRows } from '@/components/dashboard/progress-copy';

export interface RecoveryBannerProps {
  job: ExtractionJob;
  onResume: (jobId: string) => void;
  onDiscard: (jobId: string) => void;
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * A stored job that stopped before finishing and can continue. Discarding ends the job but
 * keeps its rows: the background's discard touches the job, checkpoint and history only.
 */
export const RecoveryBanner: React.FC<RecoveryBannerProps> = ({ job, onResume, onDiscard }) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const progress = describeProgress({
    kind: job.progressKind,
    step: job.progressKind === 'scrolls' ? job.scrollsCompleted : job.pagesVisited,
    total: job.targetSteps,
    rows: job.totalExtracted,
  });
  const where = progress.stepLabel.charAt(0).toLowerCase() + progress.stepLabel.slice(1);
  const rows = formatRows(job.totalExtracted);

  return (
    <>
      <Banner
        tone="warning"
        title={
          <span className="inline-flex items-center gap-1">
            Extraction interrupted
            <HelpTip tipId="recovery" />
          </span>
        }
        dataSafety={
          job.totalExtracted > 0 ? `${rows} saved and safe.` : 'Nothing had been saved yet, so nothing is lost.'
        }
        nextStep="Resume to continue where it stopped, or discard to end this job."
        actions={
          <>
            <Button size="sm" onClick={() => onResume(job.id)}>
              Resume
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIsConfirming(true)}>
              Discard
            </Button>
          </>
        }
      >
        The extraction on {siteOf(job.targetUrl)} stopped at {where}. {job.interruptedReason}
      </Banner>

      <Dialog
        isOpen={isConfirming}
        onClose={() => setIsConfirming(false)}
        title="Discard this interrupted job?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setIsConfirming(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setIsConfirming(false);
                onDiscard(job.id);
              }}
            >
              Discard job
            </Button>
          </>
        }
      >
        Its {job.totalExtracted.toLocaleString('en-US')} saved {job.totalExtracted === 1 ? 'row stays' : 'rows stay'}{' '}
        in Datasets. The job itself ends and can no longer be resumed.
      </Dialog>
    </>
  );
};
