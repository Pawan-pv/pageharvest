import React, { useState } from 'react';
import { Check, Copy, Images, X } from 'lucide-react';
import { Button } from '@/components/common/Button';

export interface GalleryImage {
  url: string;
  /** The row's readable name, shown under the picture. */
  label: string;
}

export interface ImageGalleryProps {
  images: GalleryImage[];
}

/**
 * A picture view of an image column. Clicking a picture opens it at full size, where its
 * address can be copied. Nothing is uploaded: the browser loads the same address the page did.
 */
export const ImageGallery: React.FC<ImageGalleryProps> = ({ images }) => {
  const [zoomed, setZoomed] = useState<GalleryImage | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const copy = async (url: string) => {
    setProblem(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl((current) => (current === url ? null : current)), 2000);
    } catch (error: unknown) {
      setProblem(`The address was not copied: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-line bg-surface p-10 text-center">
        <Images aria-hidden="true" className="w-8 h-8 text-fg-subtle" />
        <p className="text-sm font-semibold text-fg">No images in this table</p>
        <p className="text-xs text-fg-muted">An image column needs addresses ending in .jpg, .png, .webp and similar.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {problem && (
        <p role="alert" className="text-xs text-danger-fg">
          {problem}
        </p>
      )}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {images.map((image, index) => (
          <li key={`${image.url}-${index}`} className="min-w-0">
            <div className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
              <button
                type="button"
                aria-label={`Open image ${image.label || index + 1}`}
                onClick={() => setZoomed(image)}
                className="relative block aspect-square w-full overflow-hidden bg-surface-sunken"
              >
                <img
                  src={image.url}
                  alt={image.label}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
              </button>
              <div className="flex min-w-0 items-center justify-between gap-1 px-2 py-1.5">
                <span className="truncate text-2xs text-fg-muted" title={image.label}>
                  {image.label || 'Untitled row'}
                </span>
                <button
                  type="button"
                  aria-label={`Copy image address for ${image.label || index + 1}`}
                  title="Copy the image address"
                  onClick={() => void copy(image.url)}
                  className="shrink-0 rounded p-0.5 text-fg-faint hover:text-brand-fg"
                >
                  {copiedUrl === image.url ? (
                    <Check aria-hidden="true" className="w-3.5 h-3.5 text-brand-fg" />
                  ) : (
                    <Copy aria-hidden="true" className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Image: ${zoomed.label || 'preview'}`}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-scrim/80 p-4 backdrop-blur-xs"
          onClick={() => setZoomed(null)}
        >
          <div className="flex w-full max-w-3xl items-center justify-between gap-2" onClick={(event) => event.stopPropagation()}>
            <span className="truncate text-sm font-semibold text-on-strong">{zoomed.label || 'Image'}</span>
            <button
              type="button"
              aria-label="Close image"
              onClick={() => setZoomed(null)}
              className="rounded-full bg-surface/10 p-1.5 text-on-strong hover:bg-surface/20"
            >
              <X aria-hidden="true" className="w-4 h-4" />
            </button>
          </div>
          <img
            src={zoomed.url}
            alt={zoomed.label}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[70vh] max-w-3xl rounded-lg bg-surface object-contain shadow-2xl"
          />
          <div
            className="flex w-full max-w-3xl flex-wrap items-center gap-2"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="min-w-0 flex-1 truncate rounded bg-surface/10 px-2 py-1 text-2xs text-on-strong">
              {zoomed.url}
            </span>
            <Button
              variant="outline"
              size="xs"
              iconLeft={
                copiedUrl === zoomed.url ? (
                  <Check aria-hidden="true" className="w-3.5 h-3.5" />
                ) : (
                  <Copy aria-hidden="true" className="w-3.5 h-3.5" />
                )
              }
              onClick={() => void copy(zoomed.url)}
            >
              {copiedUrl === zoomed.url ? 'Copied' : 'Copy address'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
