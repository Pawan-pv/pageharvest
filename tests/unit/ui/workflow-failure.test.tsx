import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useExtractionWorkflow } from '@/hooks/useExtractionWorkflow';
import { messagingService, TabInfo } from '@/services/messaging';
import { db } from '@/storage/db';

const tab: TabInfo = {
  id: 101,
  url: 'http://127.0.0.1:3456/simple-grid.html',
  title: 'Simple Product Grid',
  isInjectable: true,
};

function WorkflowProbe() {
  const workflow = useExtractionWorkflow(tab);
  return (
    <>
      <button onClick={() => void workflow.startVisualPicker()}>Start picker</button>
      <output data-testid="workflow-state">
        {workflow.view}:{workflow.detectedList?.containerSelector ?? 'no-list'}
      </output>
      <output data-testid="workflow-error">{workflow.operationError?.message ?? 'no-error'}</output>
    </>
  );
}

describe('useExtractionWorkflow communication failures', () => {
  beforeEach(async () => {
    await db.clearAllData();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not invent a detected list when the page cannot be reached', async () => {
    vi.spyOn(messagingService, 'startElementPicker').mockRejectedValue(
      new Error('Could not communicate with the page content script.')
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<WorkflowProbe />);
    fireEvent.click(screen.getByRole('button', { name: 'Start picker' }));

    await waitFor(() => {
      expect(screen.getByTestId('workflow-state')).toHaveTextContent('dashboard:no-list');
    });
    expect(screen.getByTestId('workflow-error')).toHaveTextContent(/Could not communicate/);
    expect(warnSpy).toHaveBeenCalledWith(
      'PageHarvest operation failed:',
      expect.stringContaining('Could not communicate with the page content script.')
    );
  });
});
