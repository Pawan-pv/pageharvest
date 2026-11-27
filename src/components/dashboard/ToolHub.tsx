import React from 'react';
import {
  ArrowRight,
  ChevronRight,
  Database,
  FileText,
  Globe,
  Image,
  Link2,
  List,
  Mail,
  Map,
  ShoppingBag,
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

/**
 * Tailwind only generates classes it can see as complete strings, so every accent is a
 * static map. Cards stay calm and neutral; each tool's icon container carries a refined
 * studio tint so scanning all 10 tools feels effortless rather than a neon rainbow.
 */
const ACCENTS: Record<ToolAccent, string> = {
  emerald: 'border-tool-emerald/25 bg-tool-emerald/10 text-tool-emerald',
  teal: 'border-tool-teal/25 bg-tool-teal/10 text-tool-teal',
  cyan: 'border-tool-cyan/25 bg-tool-cyan/10 text-tool-cyan',
  sky: 'border-tool-sky/25 bg-tool-sky/10 text-tool-sky',
  indigo: 'border-tool-indigo/25 bg-tool-indigo/10 text-tool-indigo',
  violet: 'border-tool-violet/25 bg-tool-violet/10 text-tool-violet',
  green: 'border-tool-green/25 bg-tool-green/10 text-tool-green',
  lime: 'border-tool-lime/25 bg-tool-lime/10 text-tool-lime',
  amber: 'border-tool-amber/25 bg-tool-amber/10 text-tool-amber',
  slate: 'border-tool-slate/25 bg-tool-slate/10 text-tool-slate',
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
 * One full-width tool card with balanced surface hierarchy, optical icon sizing, and crisp typography.
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
  const iconTone = ACCENTS[accent];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? title}
      className="group w-full rounded-xl border border-line bg-surface p-3.5 text-left ph-card-elevated transition-all duration-150 hover:border-line-strong hover:bg-surface-sunken/40 active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`ph-tool-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-transform duration-150 group-hover:scale-[1.04] ${iconTone}`}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-body font-semibold tracking-[-0.01em] text-fg">{title}</span>
            {badge && (
              <span className="rounded-full border border-line bg-surface-muted px-1.5 py-0.5 text-2xs font-medium text-fg-subtle">
                {badge}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-fg-subtle">{description}</span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-fg-faint transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-fg-muted"
        />
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
  onOpenListExtractor,
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
        <h2 id="tools-heading" className="flex items-center gap-1.5 text-xs ph-heading text-fg">
          <span
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-md border border-brand-line bg-brand-soft text-brand-fg"
          >
            <Zap className="h-3 w-3" />
          </span>
          Tools
        </h2>
        <button
          type="button"
          onClick={onViewAllHistory}
          className="flex min-h-7 items-center gap-1 rounded-control px-1.5 text-2xs font-semibold ph-tabular text-brand-fg transition-colors hover:text-brand-emphasis"
        >
          <span>My Recent ({datasetsCount})</span>
          <ArrowRight aria-hidden="true" className="h-3 w-3" />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <ToolCard
          title="List Extractor"
          description="Extract data from lists, tables, and paginated pages"
          icon={<List className="h-[18px] w-[18px]" />}
          accent="emerald"
          ariaLabel="Find Data on This Page"
          disabled={disabled}
          onClick={onOpenListExtractor ?? onAutoDetectLists}
        />
        <ToolCard
          title="Table Extractor"
          description="Capture any HTML table into a clean spreadsheet"
          icon={<Table2 className="h-[18px] w-[18px]" />}
          accent="teal"
          ariaLabel="Extract a table"
          disabled={disabled}
          onClick={onExtractTable}
        />
        <ToolCard
          title="Links Extractor"
          description="Collect all links and anchor text from this page"
          icon={<Link2 className="h-[18px] w-[18px]" />}
          accent="cyan"
          ariaLabel="Extract all links"
          disabled={disabled}
          onClick={onExtractLinks}
        />
        <ToolCard
          title="Page Extractor"
          description="Bulk-extract structured data from multiple URLs"
          icon={<Database className="h-[18px] w-[18px]" />}
          accent="sky"
          ariaLabel="Page Extractor"
          disabled={disabled}
          onClick={onOpenPageExtractor}
        />
        <ToolCard
          title="Sitemap Explorer"
          description="Parse XML sitemaps and filter site URLs"
          icon={<Map className="h-[18px] w-[18px]" />}
          accent="indigo"
          ariaLabel="Sitemap Explorer"
          disabled={disabled}
          onClick={onOpenSitemapExplorer}
        />
        <ToolCard
          title="Shopify Extractor"
          description="Extract a store's full catalog to Shopify CSV"
          icon={<ShoppingBag className="h-[18px] w-[18px]" />}
          accent="lime"
          ariaLabel="Shopify Extractor"
          disabled={disabled}
          onClick={onOpenShopifyExtractor}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 pt-1">
        <h3 className="ph-eyebrow">v2.0 suite</h3>
        <span className="rounded-full border border-brand-line bg-brand-soft px-2 py-0.5 text-2xs font-semibold ph-tabular text-brand-fg">
          10 Tools Live
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <ToolCard
          title="Image Downloader"
          description="Bulk download images with custom file naming"
          icon={<Image className="h-[18px] w-[18px]" />}
          accent="violet"
          ariaLabel="Image Downloader"
          disabled={disabled}
          onClick={onOpenImageDownloader}
        />
        <ToolCard
          title="Email Extractor"
          description="Find and extract email addresses across pages"
          icon={<Mail className="h-[18px] w-[18px]" />}
          accent="green"
          ariaLabel="Email Extractor"
          disabled={disabled}
          onClick={onOpenEmailExtractor}
        />
        <ToolCard
          title="Social Link Extractor"
          description="Find social media profiles across multiple pages"
          icon={<Globe className="h-[18px] w-[18px]" />}
          accent="amber"
          ariaLabel="Social Link Extractor"
          disabled={disabled}
          onClick={onOpenSocialExtractor}
        />
        <ToolCard
          title="Page Text Extractor"
          description="Extract clean AI-ready Markdown and metadata"
          icon={<FileText className="h-[18px] w-[18px]" />}
          accent="slate"
          ariaLabel="Page Text Extractor"
          disabled={disabled}
          onClick={onOpenPageTextExtractor}
        />
      </div>
    </section>
  );
};
