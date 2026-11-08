import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';
import { errorReporter } from '@/core/resilience/error-reporter';

/**
 * How browsers word a dynamic import that can no longer load. Chrome can update the extension
 * while a panel is open; the open panel then asks for chunk names that no longer exist.
 */
const STALE_CHUNK =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

export interface PanelErrorBoundaryProps {
  children: React.ReactNode;
  /** What "Reload panel" does. Defaults to reloading the panel document. */
  onReload?: () => void;
}

interface PanelErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches a render error anywhere in the side panel, which React would otherwise answer by
 * unmounting the whole panel and leaving it blank. Jobs and saved rows belong to the background
 * worker (ADR-016), so they survive; the panel only has to be reloaded.
 */
export class PanelErrorBoundary extends React.Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  public state: PanelErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: unknown): PanelErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  public componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // Kept in this panel's memory only; nothing is sent anywhere.
    errorReporter.report('UNKNOWN', error, {
      severity: 'FATAL',
      context: { componentStack: info.componentStack ?? '' },
    });
  }

  private readonly reload = (): void => {
    if (this.props.onReload) {
      this.props.onReload();
    } else {
      window.location.reload();
    }
  };

  public render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const updated = STALE_CHUNK.test(error.message);

    return (
      <main className="min-h-screen bg-surface p-4">
        <Banner
          tone="danger"
          title={
            <h1 className="text-sm font-semibold">
              {updated ? 'PageHarvest was updated' : 'Something went wrong in the panel'}
            </h1>
          }
          dataSafety={
            updated
              ? 'Rows already saved are safe.'
              : 'Rows already saved are safe, and a running job keeps going in the background.'
          }
          nextStep={
            updated
              ? 'This panel is still running the previous version. Reload it to use the new one.'
              : 'Reload the panel. If this keeps happening, note what you did just before it.'
          }
          details={error.message}
          actions={
            <Button variant="primary" size="sm" iconLeft={<RefreshCw className="w-3.5 h-3.5" />} onClick={this.reload}>
              Reload panel
            </Button>
          }
        />
      </main>
    );
  }
}
