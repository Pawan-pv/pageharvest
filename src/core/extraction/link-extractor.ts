import { FieldDefinition } from '@/types';
import { ListCandidate } from '@/shared/contracts/message';
import { generateCssSelector } from '@/utils/selector';
import { normalizeText } from '@/utils/dom';

/**
 * Extract Links. It starts from the page's content and leaves out the site's navigation,
 * which is offered separately so a user who wants it can still choose it. One URL is one
 * record, however many times the page links to it.
 */
const LINK = 'a[href]';
const GOES_SOMEWHERE =
  ':not([href^="#"]):not([href^="javascript:" i]):not([href^="mailto:" i]):not([href^="tel:" i])';
const NAVIGATION_REGIONS = [
  'nav',
  '[role="navigation"]',
  'aside',
  '[role="complementary"]',
  'footer',
  '[role="contentinfo"]',
  '[role="banner"]',
  'body > header',
  '[id*="menu" i]',
  '[class*="menu" i]',
  '[id*="navigation" i]',
  '[class*="navigation" i]',
];
const OUTSIDE_NAVIGATION = `:not(${NAVIGATION_REGIONS.map((region) => `${region} a`).join(', ')})`;
const CONTENT_LINKS = `${LINK}${GOES_SOMEWHERE}${OUTSIDE_NAVIGATION}`;
const USABLE_LINKS = `${LINK}${GOES_SOMEWHERE}`;

const MAX_REGIONS = 8;
const MIN_SUB_REGION_LINKS = 3;
const SAMPLE_LINKS = 3;

function linkPreview(link: Element): string {
  const text = normalizeText(link.textContent) || link.querySelector('img')?.getAttribute('alt') || '';
  return `${text} (${link.getAttribute('href') ?? ''})`.trim().slice(0, 100);
}

function lowestCommonAncestor(elements: Element[]): Element | null {
  let ancestor = elements[0]?.parentElement ?? null;
  while (ancestor && !elements.every((element) => ancestor?.contains(element))) {
    ancestor = ancestor.parentElement;
  }
  return ancestor;
}

interface Region {
  selector: string;
  name: string;
  credible: boolean;
}

function buildCandidate(region: Region, root: Document | Element): ListCandidate | null {
  const links = Array.from(root.querySelectorAll(region.selector));
  if (links.length === 0) return null;
  const urls = new Set(links.map((link) => link.getAttribute('href')));
  return {
    containerSelector: region.selector,
    matchCount: links.length,
    sampleSnippets: links.slice(0, SAMPLE_LINKS).map(linkPreview),
    name: region.name,
    kind: 'links',
    credible: region.credible,
    confidence: region.credible ? 0.9 : 0.1,
    evidence: [
      region.credible ? 'in the page content' : 'inside navigation, a sidebar or a footer',
      `${urls.size} different addresses`,
    ],
    suggestedFields: ['Text', 'URL'],
    dedupeFields: ['URL'],
  };
}

function contentRegion(root: Document | Element): { element: Element | null; selector: string } {
  const landmark = root.querySelector('main, [role="main"]');
  if (landmark) return { element: landmark, selector: generateCssSelector(landmark) };

  const links = Array.from(root.querySelectorAll(CONTENT_LINKS));
  const ancestor = links.length > 0 ? lowestCommonAncestor(links) : null;
  if (!ancestor || ancestor.tagName === 'BODY' || ancestor.tagName === 'HTML') {
    return { element: null, selector: '' };
  }
  return { element: ancestor, selector: generateCssSelector(ancestor) };
}

function regionHeading(element: Element): string {
  const heading = element.querySelector('h1, h2, h3, h4')?.textContent;
  return normalizeText(heading ?? element.getAttribute('aria-label')).slice(0, 40);
}

export function detectLinkRegions(root: Document | Element = document): ListCandidate[] {
  const regions: Region[] = [];

  const content = contentRegion(root);
  const scoped = (selector: string) => (content.selector ? `${content.selector} ${selector}` : selector);
  regions.push({ selector: scoped(CONTENT_LINKS), name: 'Links in the page content', credible: true });

  // Each large block of the content can be chosen on its own.
  if (content.element) {
    for (const block of Array.from(content.element.children)) {
      const count = block.querySelectorAll(CONTENT_LINKS).length;
      if (count < MIN_SUB_REGION_LINKS) continue;
      const heading = regionHeading(block);
      regions.push({
        selector: `${generateCssSelector(block)} ${CONTENT_LINKS}`,
        name: heading ? `Links in "${heading}"` : 'Links in part of the page',
        credible: true,
      });
    }
  }

  for (const region of Array.from(root.querySelectorAll(NAVIGATION_REGIONS.join(', ')))) {
    // A menu inside a page header is covered by the header it sits in.
    if (region.parentElement?.closest(NAVIGATION_REGIONS.join(', '))) continue;
    const tag = region.tagName === 'FOOTER' ? 'footer' : region.tagName === 'ASIDE' ? 'sidebar' : 'navigation';
    regions.push({
      selector: `${generateCssSelector(region)} ${USABLE_LINKS}`,
      name: `Links in the ${tag}`,
      credible: false,
    });
  }

  const seen = new Set<string>();
  const candidates: ListCandidate[] = [];
  for (const region of regions) {
    const candidate = buildCandidate(region, root);
    if (!candidate) continue;
    const identity = Array.from(root.querySelectorAll(region.selector))
      .map((link) => link.getAttribute('href'))
      .join('\n');
    if (seen.has(identity)) continue;
    seen.add(identity);
    candidates.push(candidate);
  }

  return candidates
    .sort((a, b) => Number(b.credible) - Number(a.credible) || b.matchCount - a.matchCount)
    .slice(0, MAX_REGIONS);
}

/** Text and URL always. Title and rel only if some of the links have them. */
export function linkFields(containerSelector: string, root: Document | Element = document): FieldDefinition[] {
  const links = Array.from(root.querySelectorAll(containerSelector));
  const discovery = (filled: number, suggested: boolean) => {
    const coverage = links.length > 0 ? Math.round((filled / links.length) * 100) / 100 : 0;
    return { coverage, confidence: coverage, sampleSize: links.length, occurrences: filled, suggested };
  };
  const fields: FieldDefinition[] = [
    {
      id: 'link_text',
      name: 'Text',
      selector: ':scope',
      extractor: 'link_text',
      required: false,
      discovery: discovery(links.filter((link) => normalizeText(link.textContent) || link.querySelector('img[alt]')).length, true),
    },
    {
      id: 'link_url',
      name: 'URL',
      selector: ':scope',
      extractor: 'href',
      required: false,
      discovery: discovery(links.length, true),
    },
  ];

  for (const [attribute, name, suggested] of [['title', 'Title', true], ['rel', 'Rel', false]] as const) {
    const filled = links.filter((link) => link.getAttribute(attribute)?.trim()).length;
    if (filled > 0) {
      fields.push({
        id: `link_${attribute}`,
        name,
        selector: ':scope',
        extractor: 'attribute',
        attributeName: attribute,
        required: false,
        discovery: discovery(filled, suggested),
      });
    }
  }
  return fields;
}
