import React, { useId, useState } from 'react';
import { ArrowLeft, ExternalLink, PlayCircle, Search } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { GUIDE_SECTIONS, searchGuide, type GuideBlock, type GuideSection, type GuideSectionId } from './content';

export interface HelpViewProps {
  onClose: () => void;
  onRestartTour: () => void;
  /** A section to open first. */
  initialSection?: GuideSectionId;
}

const Block: React.FC<{ block: GuideBlock }> = ({ block }) => {
  switch (block.kind) {
    case 'text':
      return <p>{block.text}</p>;
    case 'steps':
      return (
        <ol className="list-decimal pl-5 flex flex-col gap-1">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    case 'list':
      return (
        <ul className="list-disc pl-5 flex flex-col gap-1">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case 'qa':
      return (
        <dl className="flex flex-col gap-2">
          {block.items.map((item) => (
            <div key={item.question}>
              <dt className="font-semibold text-fg">{item.question}</dt>
              <dd>{item.answer}</dd>
            </div>
          ))}
        </dl>
      );
    case 'link':
      return (
        <p>
          <a
            href={block.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-brand-fg underline underline-offset-2 hover:text-brand-emphasis"
          >
            {block.text}
            <ExternalLink aria-hidden="true" className="w-3 h-3" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <span className="block text-fg-subtle">{block.note}</span>
        </p>
      );
  }
};

const SectionArticle: React.FC<{ section: GuideSection }> = ({ section }) => (
  <article id={`guide-${section.id}`} className="flex flex-col gap-2 p-3 rounded-card border border-line bg-surface">
    <h3 className="text-sm font-semibold text-fg">{section.title}</h3>
    <p className="text-xs text-fg-subtle">{section.summary}</p>
    <div className="flex flex-col gap-2 text-xs text-fg-muted leading-relaxed">
      {section.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  </article>
);

/** The built-in guide: contents, search, and every section, shipped with the extension. */
export const HelpView: React.FC<HelpViewProps> = ({ onClose, onRestartTour, initialSection }) => {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<GuideSectionId | undefined>(initialSection);
  const trimmed = query.trim();
  const results = searchGuide(trimmed);
  const shown = trimmed ? results : GUIDE_SECTIONS.filter((section) => section.id === openId);

  return (
    <div className="flex flex-col gap-3 p-4 text-left">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="xs" iconLeft={<ArrowLeft aria-hidden="true" className="w-3.5 h-3.5" />} onClick={onClose}>
          Back
        </Button>
        <Button
          variant="outline"
          size="xs"
          iconLeft={<PlayCircle aria-hidden="true" className="w-3.5 h-3.5" />}
          onClick={onRestartTour}
        >
          Show the welcome tour again
        </Button>
      </div>

      <h2 className="text-base font-semibold text-fg">Help and guide</h2>

      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search the guide
        </label>
        <Search aria-hidden="true" className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search, for example: scroll, Excel, missing"
          className="w-full rounded-control border border-line-strong bg-surface pl-8 pr-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-focus focus:ring-1 focus:ring-focus"
        />
      </div>

      <p role="status" className="text-2xs text-fg-subtle min-h-4">
        {trimmed
          ? results.length === 0
            ? `No sections match "${trimmed}".`
            : `${results.length} ${results.length === 1 ? 'section matches' : 'sections match'} "${trimmed}".`
          : ''}
      </p>

      {trimmed && results.length === 0 && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setQuery('')}>
            Clear search
          </Button>
        </div>
      )}

      {!trimmed && (
        <nav aria-label="Guide sections">
          <ul className="flex flex-col gap-1">
            {GUIDE_SECTIONS.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  aria-label={section.title}
                  aria-describedby={`guide-summary-${section.id}`}
                  aria-expanded={openId === section.id}
                  onClick={() => setOpenId((current) => (current === section.id ? undefined : section.id))}
                  className={`w-full text-left px-3 py-2 rounded-control border text-xs ${
                    openId === section.id
                      ? 'border-brand bg-brand-soft text-brand-emphasis font-semibold'
                      : 'border-line bg-surface text-fg hover:border-line-strong'
                  }`}
                >
                  <span className="block font-semibold">{section.title}</span>
                  <span id={`guide-summary-${section.id}`} className="block text-2xs text-fg-subtle font-normal">
                    {section.summary}
                  </span>
                </button>
                {openId === section.id && (
                  <div className="mt-1">
                    <SectionArticle section={section} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}

      {trimmed && shown.map((section) => <SectionArticle key={section.id} section={section} />)}
    </div>
  );
};
