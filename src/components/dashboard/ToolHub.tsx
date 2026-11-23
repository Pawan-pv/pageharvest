import React from 'react';
import {
  ArrowRight,
  Database,
  FileText,
  Globe,
  Image,
  Link2,
  List,
  Mail,
  Map,
  Table2,
  Zap,
} from 'lucide-react';

export type ToolAccent =
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'indigo'
  | 'violet'
  | 'green'
  | 'lime'
  | 'amber'
  | 'slate';

interface AccentClasses {
  border: string;
  icon: string;
  title: string;
  bar: string;
  wash: string;
  glow: string;
}

/**
 * Tailwind only generates classes it can see as complete strings, so every accent is a
 * static map. The card's colour is its identity: border, icon tile, title and underline
 * all share one token.
 */
const ACCENTS: Record<ToolAccent, AccentClasses> = {
  emerald: {
    border: 'border-tool-emerald/20 hover:border-tool-emerald/55',
    icon: 'bg-tool-emerald/15 border-tool-emerald/25 text-tool-emerald',
    title: 'text-tool-emerald',
    bar: 'bg-tool-emerald/50 group-hover:bg-tool-emerald',
    wash: 'hover:bg-gradient-to-b hover:from-tool-emerald/12 hover:to-transparent',
    glow: 'hover:shadow-glow-emerald',
  },
  teal: {
    border: 'border-tool-teal/20 hover:border-tool-teal/55',
    icon: 'bg-tool-teal/15 border-tool-teal/25 text-tool-teal',
    title: 'text-tool-teal',
    bar: 'bg-tool-teal/50 group-hover:bg-tool-teal',
    wash: 'hover:bg-gradient-to-b hover:from-tool-teal/12 hover:to-transparent',
    glow: 'hover:shadow-glow-teal',
  },
  cyan: {
    border: 'border-tool-cyan/20 hover:border-tool-cyan/55',
    icon: 'bg-tool-cyan/15 border-tool-cyan/25 text-tool-cyan',
    title: 'text-tool-cyan',
    bar: 'bg-tool-cyan/50 group-hover:bg-tool-cyan',
    wash: 'hover:bg-gradient-to-b hover:from-tool-cyan/12 hover:to-transparent',
    glow: 'hover:shadow-glow-cyan',
  },
  sky: {
    border: 'border-tool-sky/20 hover:border-tool-sky/55',
    icon: 'bg-tool-sky/15 border-tool-sky/25 text-tool-sky',
    title: 'text-tool-sky',
    bar: 'bg-tool-sky/50 group-hover:bg-tool-sky',
    wash: 'hover:bg-gradient-to-b hover:from-tool-sky/12 hover:to-transparent',
    glow: 'hover:shadow-glow-sky',
  },
  indigo: {
    border: 'border-tool-indigo/20 hover:border-tool-indigo/55',
    icon: 'bg-tool-indigo/15 border-tool-indigo/25 text-tool-indigo',
    title: 'text-tool-indigo',
    bar: 'bg-tool-indigo/50 group-hover:bg-tool-indigo',
    wash: 'hover:bg-gradient-to-b hover:from-tool-indigo/12 hover:to-transparent',
    glow: 'hover:shadow-glow-indigo',
  },
  violet: {
    border: 'border-tool-violet/20 hover:border-tool-violet/55',
    icon: 'bg-tool-violet/15 border-tool-violet/25 text-tool-violet',
    title: 'text-tool-violet',
    bar: 'bg-tool-violet/50 group-hover:bg-tool-violet',
    wash: 'hover:bg-gradient-to-b hover:from-tool-violet/12 hover:to-transparent',
    glow: 'hover:shadow-glow-violet',
  },
  green: {
    border: 'border-tool-green/20 hover:border-tool-green/55',
    icon: 'bg-tool-green/15 border-tool-green/25 text-tool-green',
    title: 'text-tool-green',
    bar: 'bg-tool-green/50 group-hover:bg-tool-green',
    wash: 'hover:bg-gradient-to-b hover:from-tool-green/12 hover:to-transparent',
    glow: 'hover:shadow-glow-green',
  },
  lime: {
    border: 'border-tool-lime/20 hover:border-tool-lime/55',
    icon: 'bg-tool-lime/15 border-tool-lime/25 text-tool-lime',
    title: 'text-tool-lime',
    bar: 'bg-tool-lime/50 group-hover:bg-tool-lime',
    wash: 'hover:bg-gradient-to-b hover:from-tool-lime/12 hover:to-transparent',
    glow: 'hover:shadow-glow-lime',
  },
  amber: {
    border: 'border-tool-amber/20 hover:border-tool-amber/55',
    icon: 'bg-tool-amber/15 border-tool-amber/25 text-tool-amber',
    title: 'text-tool-amber',
    bar: 'bg-tool-amber/50 group-hover:bg-tool-amber',
    wash: 'hover:bg-gradient-to-b hover:from-tool-amber/12 hover:to-transparent',
    glow: 'hover:shadow-glow-amber',
  },
  slate: {
    border: 'border-tool-slate/20 hover:border-tool-slate/55',
    icon: 'bg-tool-slate/15 border-tool-slate/25 text-tool-slate',
    title: 'text-tool-slate',
    bar: 'bg-tool-slate/50 group-hover:bg-tool-slate',
    wash: 'hover:bg-gradient-to-b hover:from-tool-slate/12 hover:to-transparent',
    glow: 'hover:shadow-glow-slate',
  },
};

export interface ToolCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  accent: ToolAccent;
  badge?: string;
  /** The action's plain-language name, read out instead of the styled card title. */
  ariaLabel?: string;
  disabled?: boolean;
  onClick?: () => void;
}

/**
 * One full-width tool. Live tools are buttons; roadmap tools keep the same shape but are
 * disabled and badged, so the suite reads as one plan rather than two designs.
 */
export const ToolCard: React.FC<ToolCardProps> = ({
  title,
  description,
  icon,
  accent,
  badge,
  ariaLabel,
  disabled = false,
  onClick,
}) => {
  const colour = ACCENTS[accent];
  const badgeTone =
    badge === 'Ready'
      ? 'border-tool-emerald/30 bg-tool-emerald/10 text-tool-emerald'
      : 'border-line bg-surface-muted text-fg-subtle';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? title}
      className={`group w-full rounded-2xl border bg-surface p-3.5 text-left transition-all duration-200 ${colour.border} ${colour.wash} ${colour.glow} disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none`}
    >
      <span className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${colour.icon}`}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`text-[13px] font-bold uppercase tracking-wide ${colour.title}`}>{title}</span>
            {badge && (
              <span
                className={`rounded-full border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide ${badgeTone}`}
              >
                {badge}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[12px] leading-snug text-fg-muted">{description}</span>
          <span
            aria-hidden="true"
            className={`mt-2 block h-0.5 w-6 rounded-full transition-all duration-200 group-hover:w-10 ${colour.bar}`}
          />
        </span>
      </span>
    </button>
  );
};

export interface ToolHubProps {
  datasetsCount: number;
  disabled?: boolean;
  onOpenListExtractor?: () => void;
  onAutoDetectLists: () => void;
  onExtractTable: () => void;
  onExtractLinks: () => void;
  onOpenPageExtractor?: () => void;
  onOpenSitemapExplorer?: () => void;
  onOpenShopifyExtractor?: () => void;
  onOpenEmailExtractor?: () => void;
  onOpenSocialExtractor?: () => void;
  onOpenPageTextExtractor?: () => void;
  onOpenImageDownloader?: () => void;
  onViewAllHistory: () => void;
}

/**
 * The home screen's tool hub: all 10 live extractors across in-page, multi-URL,
 * sitemap, store catalog, and asset workflows.
 */
export const ToolHub: React.FC<ToolHubProps> = ({
  datasetsCount,
  disabled = false,
  onOpenListExtractor: _onOpenListExtractor,
  onAutoDetectLists,
  onExtractTable,
  onExtractLinks,
  onOpenPageExtractor,
  onOpenSitemapExplorer,
  onOpenShopifyExtractor,
  onOpenEmailExtractor,
  onOpenSocialExtractor,
  onOpenPageTextExtractor,
  onOpenImageDownloader,
  onViewAllHistory,
}) => {
  return (
    <section aria-labelledby="tools-heading" className="flex flex-col gap-2.5 text-left">
      <div className="flex items-center justify-between gap-2">
        <h2 id="tools-heading" className="flex items-center gap-1.5 text-sm font-bold text-fg">
          <span
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-md border border-tool-emerald/25 bg-tool-emerald/10 text-tool-emerald"
          >
            <Zap className="h-3 w-3" />
          </span>
          Tools
        </h2>
        <button
          type="button"
          onClick={onViewAllHistory}
          className="flex min-h-8 items-center gap-1 rounded-control px-1.5 text-2xs font-semibold text-brand-fg transition-colors hover:text-brand-emphasis"
        >
          <span>My Recent ({datasetsCount})</span>
          <ArrowRight aria-hidden="true" className="h-3 w-3" />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <ToolCard
          title="List Extractor"
          description="Extract data from lists, tables, and paginated pages"
          icon={<List className="h-5 w-5" />}
          accent="emerald"
          badge="Ready"
          ariaLabel="Find Data on This Page"
          disabled={disabled}
          onClick={onAutoDetectLists}
        />
        <ToolCard
          title="Table Extractor"
          description="Capture any HTML table into a clean spreadsheet"
          icon={<Table2 className="h-5 w-5" />}
          accent="teal"
          badge="Ready"
          ariaLabel="Extract a table"
          disabled={disabled}
          onClick={onExtractTable}
        />
        <ToolCard
          title="Links Extractor"
          description="Collect all links and anchor text from this page"
          icon={<Link2 className="h-5 w-5" />}
          accent="cyan"
          badge="Ready"
          ariaLabel="Extract all links"
          disabled={disabled}
          onClick={onExtractLinks}
        />
        <ToolCard
          title="Page Extractor"
          description="Bulk-extract structured data from multiple URLs"
          icon={<Database className="h-5 w-5" />}
          accent="sky"
          badge="Ready"
          ariaLabel="Page Extractor"
          disabled={disabled}
          onClick={onOpenPageExtractor}
        />
        <ToolCard
          title="Sitemap Explorer"
          description="Parse XML sitemaps and filter site URLs"
          icon={<Map className="h-5 w-5" />}
          accent="indigo"
          badge="Ready"
          ariaLabel="Sitemap Explorer"
          disabled={disabled}
          onClick={onOpenSitemapExplorer}
        />
        <ToolCard
          title="Shopify Extractor"
          description="Extract a store's full catalog to Shopify CSV"
          icon={<Table2 className="h-5 w-5" />}
          accent="lime"
          badge="Ready"
          ariaLabel="Shopify Extractor"
          disabled={disabled}
          onClick={onOpenShopifyExtractor}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <h3 className="text-2xs font-bold uppercase tracking-widest text-fg-subtle">v2.0 suite</h3>
        <span className="rounded-full border border-tool-emerald/30 bg-tool-emerald/10 px-1.5 py-0.5 text-2xs font-semibold text-tool-emerald">
          10 Tools Live
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <ToolCard
          title="Image Downloader"
          description="Bulk download images with custom file naming"
          icon={<Image className="h-5 w-5" />}
          accent="violet"
          badge="Ready"
          ariaLabel="Image Downloader"
          disabled={disabled}
          onClick={onOpenImageDownloader}
        />
        <ToolCard
          title="Email Extractor"
          description="Find and extract email addresses across pages"
          icon={<Mail className="h-5 w-5" />}
          accent="green"
          badge="Ready"
          ariaLabel="Email Extractor"
          disabled={disabled}
          onClick={onOpenEmailExtractor}
        />
        <ToolCard
          title="Social Link Extractor"
          description="Find social media profiles across multiple pages"
          icon={<Globe className="h-5 w-5" />}
          accent="amber"
          badge="Ready"
          ariaLabel="Social Link Extractor"
          disabled={disabled}
          onClick={onOpenSocialExtractor}
        />
        <ToolCard
          title="Page Text Extractor"
          description="Extract clean AI-ready Markdown and metadata"
          icon={<FileText className="h-5 w-5" />}
          accent="slate"
          badge="Ready"
          ariaLabel="Page Text Extractor"
          disabled={disabled}
          onClick={onOpenPageTextExtractor}
        />
      </div>
    </section>
  );
};
