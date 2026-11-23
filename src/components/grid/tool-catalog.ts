import type { ToolType } from '@/shared/contracts/tool-job';

export interface ToolOption {
  id: ToolType;
  label: string;
  description: string;
}

/**
 * The tools a URL list can be sent to. Sprint 2.1 wires the handoff and the workspace; the
 * per-URL extractors arrive in Sprints 2.2 and 2.3 behind the same names.
 */
export const TOOL_OPTIONS: ToolOption[] = [
  { id: 'table', label: 'Table extractor', description: 'Read the rows of a table on each page.' },
  { id: 'list', label: 'List extractor', description: 'Collect the repeated items on each page.' },
  { id: 'page', label: 'Page details', description: 'Read the title, description and key details of each page.' },
  { id: 'page_text', label: 'Page text', description: 'Keep the readable text of each page.' },
  { id: 'links', label: 'All links', description: 'Collect every link on each page.' },
  { id: 'images', label: 'Images', description: 'Collect every image address on each page.' },
  { id: 'email', label: 'Email addresses', description: 'Find email addresses on each page.' },
  { id: 'social', label: 'Social profiles', description: 'Find social media profile links on each page.' },
  { id: 'sitemap', label: 'Sitemap', description: 'Read a sitemap and list the pages it names.' },
  { id: 'shopify', label: 'Shopify products', description: 'Read products from a Shopify catalogue.' },
];

export function toolLabel(tool: ToolType): string {
  return TOOL_OPTIONS.find((option) => option.id === tool)?.label ?? tool;
}

export function isToolType(value: unknown): value is ToolType {
  return typeof value === 'string' && TOOL_OPTIONS.some((option) => option.id === value);
}
