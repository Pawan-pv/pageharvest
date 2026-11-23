import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from '@/components/common/Dialog';
import { Banner } from '@/components/common/Banner';
import { IconButton } from '@/components/common/IconButton';
import { HelpTip, Tooltip } from '@/components/common/Tooltip';
import { Input } from '@/components/common/Input';
import { helpTips, type HelpTipId } from '@/components/guide/tips';

const DialogHarness: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      <Dialog
        isOpen={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Delete dataset?"
        description="This cannot be undone."
        footer={
          <>
            <button>Cancel</button>
            <button>Delete</button>
          </>
        }
      >
        <input aria-label="Confirm name" />
      </Dialog>
    </>
  );
};

describe('Dialog', () => {
  it('is a modal dialog named by its title and described by its description', async () => {
    render(<DialogHarness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open dialog' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete dataset?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
  });

  it('gives each open dialog its own title id', () => {
    render(
      <>
        <Dialog isOpen onClose={vi.fn()} title="First">a</Dialog>
        <Dialog isOpen onClose={vi.fn()} title="Second">b</Dialog>
      </>
    );
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument();
  });

  it('moves focus inside, keeps Tab inside, and returns focus to the opener on close', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);

    const close = screen.getByRole('button', { name: 'Close dialog' });
    expect(close).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText('Confirm name')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes from the close button and the backdrop', async () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('Banner', () => {
  it('announces danger as an alert and says what happened, whether data is safe, and what to do', () => {
    render(
      <Banner
        tone="danger"
        title="The page stopped responding"
        dataSafety="All 120 saved rows are safe."
        nextStep="Reload the tab, then press Resume."
      >
        PageHarvest lost contact with the tab.
      </Banner>
    );
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('The page stopped responding');
    expect(banner).toHaveTextContent('PageHarvest lost contact with the tab.');
    expect(banner).toHaveTextContent('Your data: All 120 saved rows are safe.');
    expect(banner).toHaveTextContent('What to do: Reload the tab, then press Resume.');
  });

  it('uses a polite status for other tones', () => {
    render(<Banner tone="success">Saved recipe.</Banner>);
    expect(screen.getByRole('status')).toHaveTextContent('Saved recipe.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps technical details behind a disclosure', async () => {
    render(
      <Banner tone="danger" details="TAB_DISCONNECTED: receiving end does not exist">
        Lost contact.
      </Banner>
    );
    const summary = screen.getByText('Technical details');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');
    await userEvent.click(summary);
    expect(details).toHaveAttribute('open');
  });

  it('can be dismissed with a labelled button', async () => {
    const onDismiss = vi.fn();
    render(<Banner tone="info" onDismiss={onDismiss}>Hello</Banner>);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('always has an accessible name and a matching hover title', () => {
    render(<IconButton label="Delete row" icon={<span />} />);
    const button = screen.getByRole('button', { name: 'Delete row' });
    expect(button).toHaveAttribute('title', 'Delete row');
    expect(button).toHaveAttribute('type', 'button');
  });
});

describe('Tooltip and HelpTip', () => {
  it('opens on keyboard focus, links itself to the trigger, and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Tooltip label="Required fields">Rows without a value are skipped.</Tooltip>);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Help: Required fields' });
    expect(trigger).toHaveFocus();
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Rows without a value are skipped.');
    expect(trigger).toHaveAccessibleDescription('Rows without a value are skipped.');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on hover and on tap, and closes when the pointer leaves', async () => {
    const user = userEvent.setup();
    render(<Tooltip label="Dedup">Repeated rows are skipped.</Tooltip>);
    const trigger = screen.getByRole('button', { name: 'Help: Dedup' });

    await user.hover(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.unhover(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('does not let Escape close a dialog it sits in', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog isOpen onClose={onClose} title="Fields">
        <Tooltip label="Regex">A pattern.</Tooltip>
      </Dialog>
    );
    act(() => screen.getByRole('button', { name: 'Help: Regex' }).focus());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders a tip from the typed registry', async () => {
    render(<HelpTip tipId="required-field" />);
    act(() => screen.getByRole('button', { name: `Help: ${helpTips['required-field'].topic}` }).focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent(helpTips['required-field'].text);
  });
});

describe('Help tip registry', () => {
  const ids = Object.keys(helpTips) as HelpTipId[];

  it('covers the controls the guide promises help for', () => {
    expect(ids).toEqual(
      expect.arrayContaining([
        'pagination-modes',
        'required-field',
        'dedup',
        'regex-extractor',
        'recovery',
      ])
    );
  });

  it.each(ids)('%s has a topic and one or two sentences of copy', (id) => {
    const tip = helpTips[id];
    expect(tip.topic.trim()).not.toBe('');
    const sentences = tip.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(sentences.length).toBeGreaterThanOrEqual(1);
    expect(sentences.length).toBeLessThanOrEqual(2);
  });
});

describe('Input accessibility', () => {
  it('links helper text to the input', () => {
    render(<Input label="Max pages" helperText="Stops after this many pages." />);
    expect(screen.getByLabelText('Max pages')).toHaveAccessibleDescription('Stops after this many pages.');
  });

  it('marks an invalid input and links its error', () => {
    render(<Input label="Delay" error="Use at least 0.2 seconds." />);
    const input = screen.getByLabelText('Delay');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Use at least 0.2 seconds.');
  });
});
