import React, { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Banner } from './Banner';
import { Button } from './Button';
import { showInFolder, waitForSavedFile, type SavedFile } from '@/platform/downloads';

export interface SavedFileNoticeProps {
  /** The download Chrome accepted. */
  downloadId: number;
  onDismiss?: () => void;
  className?: string;
}

/**
 * What became of a download. It says "saved" only once Chrome reports the file complete, and
 * then with the name the file really has, because Chrome adds a number when the name is
 * taken. "Show in folder" opens the folder with the file selected.
 */
export const SavedFileNotice: React.FC<SavedFileNoticeProps> = ({ downloadId, onDismiss, className }) => {
  const [answer, setAnswer] = useState<{ id: number; file: SavedFile } | null>(null);
  const [folderFailed, setFolderFailed] = useState(false);

  useEffect(() => {
    let current = true;
    void waitForSavedFile(downloadId).then((file) => {
      if (current) setAnswer({ id: downloadId, file });
    });
    return () => {
      current = false;
    };
  }, [downloadId]);

  // An answer about an earlier download says nothing about this one.
  const saved = answer?.id === downloadId ? answer.file : null;

  if (saved === null) {
    return (
      <Banner tone="info" className={className}>
        Saving the file…
      </Banner>
    );
  }

  if (saved.state === 'interrupted') {
    return (
      <Banner
        tone="danger"
        title="The file was not saved"
        dataSafety="Your rows are still saved in PageHarvest."
        nextStep="Press the download button again."
        onDismiss={onDismiss}
        className={className}
      >
        {saved.reason}
      </Banner>
    );
  }

  if (saved.state === 'in_progress') {
    return (
      <Banner tone="info" onDismiss={onDismiss} className={className}>
        Chrome is still saving the file. You will find it in Chrome's downloads (press Ctrl+J) when it is ready.
      </Banner>
    );
  }

  return (
    <Banner
      tone="success"
      title="File saved"
      onDismiss={onDismiss}
      className={className}
      actions={
        <Button
          variant="outline"
          size="sm"
          iconLeft={<FolderOpen aria-hidden="true" className="w-3.5 h-3.5" />}
          onClick={() => setFolderFailed(!showInFolder(downloadId))}
        >
          Show in folder
        </Button>
      }
    >
      It is in your Downloads folder, named <span className="font-semibold break-all">{saved.fileName}</span>.
      {folderFailed && <span className="block mt-1">The folder could not be opened. Look in your Downloads folder.</span>}
    </Banner>
  );
};
