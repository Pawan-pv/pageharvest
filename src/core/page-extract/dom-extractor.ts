import type { CustomCssField, PageActionsConfig } from './types';

export interface DomExtractionArgs {
  extractMetadata: boolean;
  extractJsonLd: boolean;
  customFields: CustomCssField[];
  pageActions?: PageActionsConfig;
}

/**
 * Self-contained extraction function that executes inside the target web page via
 * chrome.scripting.executeScript. Has zero external imports so it bundles cleanly.
 */
export async function executeDomExtraction(args: DomExtractionArgs): Promise<Record<string, string>> {
  const result: Record<string, string> = {
    sourceUrl: window.location.href,
  };

  // 1. Page Actions (wait, scroll, click)
  if (args.pageActions) {
    if (args.pageActions.scrollToBottom) {
      window.scrollTo(0, document.body.scrollHeight);
    }
    if (args.pageActions.clickSelector) {
      const el = document.querySelector<HTMLElement>(args.pageActions.clickSelector);
      if (el) {
        el.click();
      }
    }
    if (args.pageActions.waitMs && args.pageActions.waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, args.pageActions!.waitMs));
    }
  }

  // 2. Page Metadata
  if (args.extractMetadata) {
    result.title = document.title || '';
    const getMeta = (nameOrProp: string) => {
      const el =
        document.querySelector(`meta[name="${nameOrProp}"]`) ||
        document.querySelector(`meta[property="${nameOrProp}"]`);
      return el ? el.getAttribute('content') || '' : '';
    };

    result.description = getMeta('description');
    const canonEl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    result.canonical = canonEl ? canonEl.href : '';
    result.ogTitle = getMeta('og:title');
    result.ogDescription = getMeta('og:description');
    result.ogImage = getMeta('og:image');
    result.author = getMeta('author');
    result.publishedTime =
      getMeta('article:published_time') ||
      getMeta('og:article:published_time') ||
      getMeta('publication_date');
    result.language = document.documentElement.lang || '';
  }

  // 3. Structured Data / JSON-LD
  if (args.extractJsonLd) {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const allEntities: Record<string, unknown>[] = [];
    scripts.forEach((script) => {
      try {
        const text = script.textContent?.trim();
        if (text) {
          const parsed = JSON.parse(text) as unknown;
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && typeof item === 'object') {
                allEntities.push(item as Record<string, unknown>);
              }
            }
          } else if (parsed && typeof parsed === 'object') {
            const parsedObj = parsed as Record<string, unknown>;
            if (Array.isArray(parsedObj['@graph'])) {
              for (const item of parsedObj['@graph']) {
                if (item && typeof item === 'object') {
                  allEntities.push(item as Record<string, unknown>);
                }
              }
            } else {
              allEntities.push(parsedObj);
            }
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    });

    if (allEntities.length > 0) {
      const getEntityType = (e: Record<string, unknown>): string =>
        Array.isArray(e['@type']) ? (e['@type'] as string[]).join(' ') : String(e['@type'] || '');
      const product = allEntities.find((e) => /Product/i.test(getEntityType(e)));
      const article = allEntities.find((e) => /Article|NewsArticle|BlogPosting/i.test(getEntityType(e)));
      const primary = product || article || allEntities[0];

      result.schemaType = String(Array.isArray(primary['@type']) ? primary['@type'][0] : primary['@type'] || '');
      result.name = String(primary.name || primary.headline || primary.title || '');
      result.sku = String(primary.sku || '');
      const brandObj = primary.brand as Record<string, unknown> | undefined;
      result.brand = typeof primary.brand === 'object' && primary.brand ? String(brandObj?.name || '') : String(primary.brand || '');

      let offers = primary.offers;
      if (Array.isArray(offers)) offers = offers[0];
      const offersObj = offers as Record<string, unknown> | undefined;
      if (offers && typeof offers === 'object') {
        result.price = String(offersObj?.price || '');
        result.priceCurrency = String(offersObj?.priceCurrency || '');
        result.availability = String(offersObj?.availability || '');
      } else {
        result.price = String(primary.price || '');
        result.priceCurrency = String(primary.priceCurrency || '');
        result.availability = String(primary.availability || '');
      }

      const ratingObj = primary.aggregateRating as Record<string, unknown> | undefined;
      if (primary.aggregateRating && typeof primary.aggregateRating === 'object') {
        result.ratingValue = String(ratingObj?.ratingValue || '');
        result.reviewCount = String(ratingObj?.reviewCount || '');
      }
      const imageObj = primary.image as Record<string, unknown> | undefined;
      if (typeof primary.image === 'string') {
        result.schemaImage = primary.image;
      } else if (Array.isArray(primary.image) && primary.image.length > 0) {
        result.schemaImage = String(primary.image[0]);
      } else if (typeof primary.image === 'object' && primary.image) {
        result.schemaImage = String(imageObj?.url || '');
      }
    }
  }

  // 4. Custom CSS Fields
  if (args.customFields && args.customFields.length > 0) {
    for (const field of args.customFields) {
      if (!field.selector || !field.name) continue;
      try {
        const el = document.querySelector(field.selector);
        if (!el) {
          result[field.name] = '';
          continue;
        }

        let val = '';
        if (field.attribute === 'href') {
          val = el instanceof HTMLAnchorElement ? el.href : el.getAttribute('href') || '';
        } else if (field.attribute === 'src') {
          val = el instanceof HTMLImageElement ? el.src : el.getAttribute('src') || '';
        } else if (field.attribute === 'content') {
          val = el.getAttribute('content') || '';
        } else {
          val = el.textContent || '';
        }
        result[field.name] = val.trim();
      } catch {
        result[field.name] = '';
      }
    }
  }

  return result;
}
