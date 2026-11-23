/**
 * Pure-TypeScript Social Media Link Extractor and Platform Canonicalizer.
 * Supports X/Twitter, Instagram, LinkedIn, YouTube, TikTok, Facebook, GitHub, Pinterest, Threads, Discord, and Telegram.
 */

export type SocialPlatform =
  | 'x'
  | 'instagram'
  | 'linkedin'
  | 'youtube'
  | 'tiktok'
  | 'facebook'
  | 'github'
  | 'pinterest'
  | 'threads'
  | 'discord'
  | 'telegram';

export interface ExtractedSocialLink {
  platform: SocialPlatform;
  platformLabel: string;
  handle: string;
  profileUrl: string;
  sourceUrl: string;
  originUrl: string;
  depth: number;
}

export const PLATFORM_INFO: Record<SocialPlatform, { label: string; domainPatterns: RegExp[] }> = {
  x: {
    label: 'X (Twitter)',
    domainPatterns: [/(?:^|\.)(?:twitter\.com|x\.com)$/i],
  },
  instagram: {
    label: 'Instagram',
    domainPatterns: [/(?:^|\.)instagram\.com$/i],
  },
  linkedin: {
    label: 'LinkedIn',
    domainPatterns: [/(?:^|\.)linkedin\.com$/i],
  },
  youtube: {
    label: 'YouTube',
    domainPatterns: [/(?:^|\.)(?:youtube\.com|youtu\.be)$/i],
  },
  tiktok: {
    label: 'TikTok',
    domainPatterns: [/(?:^|\.)tiktok\.com$/i],
  },
  facebook: {
    label: 'Facebook',
    domainPatterns: [/(?:^|\.)facebook\.com$/i],
  },
  github: {
    label: 'GitHub',
    domainPatterns: [/(?:^|\.)github\.com$/i],
  },
  pinterest: {
    label: 'Pinterest',
    domainPatterns: [/(?:^|\.)pinterest\.[a-z.]+$/i],
  },
  threads: {
    label: 'Threads',
    domainPatterns: [/(?:^|\.)threads\.net$/i],
  },
  discord: {
    label: 'Discord',
    domainPatterns: [/(?:^|\.)(?:discord\.gg|discord\.com)$/i],
  },
  telegram: {
    label: 'Telegram',
    domainPatterns: [/(?:^|\.)(?:t\.me|telegram\.me)$/i],
  },
};

const NOISE_PATH_PATTERNS = [
  /\/sharer(?:\.php)?/i,
  /\/shareArticle/i,
  /\/intent\//i,
  /\/share/i,
  /\/plugins\//i,
  /\/embed\//i,
  /\/widgets\//i,
  /\/login/i,
  /\/signup/i,
  /\/register/i,
  /\/terms/i,
  /\/privacy/i,
  /\/help/i,
  /\/about/i,
  /\/explore/i,
  /\/hashtag\//i,
  /\/search/i,
];

function sanitizeHandle(raw: string): string {
  let cleaned = raw.replace(/^[@/]+/, '').replace(/[/]+$/, '').trim();
  // Remove query params or hash if attached
  cleaned = cleaned.split(/[?#]/)[0] || '';
  return cleaned;
}

/**
 * Identifies the platform and extracts a clean profile handle and canonical URL from a raw link.
 */
export function parseSocialLink(rawUrl: string): { platform: SocialPlatform; handle: string; profileUrl: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  for (const pattern of NOISE_PATH_PATTERNS) {
    if (pattern.test(path)) return null;
  }

  const segments = path.split('/').filter(Boolean);

  for (const [platformKey, config] of Object.entries(PLATFORM_INFO) as [SocialPlatform, typeof PLATFORM_INFO[SocialPlatform]][]) {
    const matchesDomain = config.domainPatterns.some((p) => p.test(host));
    if (!matchesDomain) continue;

    if (platformKey === 'x') {
      if (segments.length >= 1) {
        const handle = sanitizeHandle(segments[0]);
        if (!handle || ['home', 'explore', 'notifications', 'messages', 'i', 'settings'].includes(handle.toLowerCase())) {
          return null;
        }
        return {
          platform: 'x',
          handle: `@${handle}`,
          profileUrl: `https://x.com/${handle}`,
        };
      }
    } else if (platformKey === 'instagram') {
      if (segments.length >= 1) {
        const handle = sanitizeHandle(segments[0]);
        if (!handle || ['p', 'reel', 'stories', 'explore', 'direct'].includes(handle.toLowerCase())) {
          return null;
        }
        return {
          platform: 'instagram',
          handle: `@${handle}`,
          profileUrl: `https://www.instagram.com/${handle}/`,
        };
      }
    } else if (platformKey === 'linkedin') {
      if (segments.length >= 2 && (segments[0] === 'company' || segments[0] === 'in' || segments[0] === 'school')) {
        const handle = sanitizeHandle(segments[1]);
        if (!handle) return null;
        return {
          platform: 'linkedin',
          handle,
          profileUrl: `https://www.linkedin.com/${segments[0]}/${handle}/`,
        };
      }
    } else if (platformKey === 'youtube') {
      if (segments.length >= 1) {
        if (segments[0].startsWith('@')) {
          const handle = sanitizeHandle(segments[0]);
          return {
            platform: 'youtube',
            handle: `@${handle}`,
            profileUrl: `https://www.youtube.com/@${handle}`,
          };
        }
        if ((segments[0] === 'c' || segments[0] === 'channel' || segments[0] === 'user') && segments[1]) {
          const handle = sanitizeHandle(segments[1]);
          return {
            platform: 'youtube',
            handle,
            profileUrl: `https://www.youtube.com/${segments[0]}/${handle}`,
          };
        }
      }
    } else if (platformKey === 'tiktok') {
      if (segments.length >= 1) {
        const handle = sanitizeHandle(segments[0]);
        if (!handle || handle.startsWith('tag') || handle.startsWith('music')) return null;
        return {
          platform: 'tiktok',
          handle: `@${handle.replace(/^@/, '')}`,
          profileUrl: `https://www.tiktok.com/@${handle.replace(/^@/, '')}`,
        };
      }
    } else if (platformKey === 'facebook') {
      if (segments.length >= 1) {
        const handle = sanitizeHandle(segments[0]);
        if (!handle || ['sharer', 'share', 'dialog', 'plugins', 'photo', 'events', 'groups'].includes(handle.toLowerCase())) {
          return null;
        }
        return {
          platform: 'facebook',
          handle,
          profileUrl: `https://www.facebook.com/${handle}/`,
        };
      }
    } else if (platformKey === 'github') {
      if (segments.length >= 1) {
        const handle = sanitizeHandle(segments[0]);
        if (!handle || ['features', 'pricing', 'about', 'security', 'enterprise', 'topics'].includes(handle.toLowerCase())) {
          return null;
        }
        return {
          platform: 'github',
          handle,
          profileUrl: `https://github.com/${handle}`,
        };
      }
    } else if (platformKey === 'pinterest') {
      if (segments.length >= 1) {
        const handle = sanitizeHandle(segments[0]);
        if (!handle || ['pin', 'today', 'ideas'].includes(handle.toLowerCase())) return null;
        return {
          platform: 'pinterest',
          handle,
          profileUrl: `https://www.pinterest.com/${handle}/`,
        };
      }
    } else if (platformKey === 'threads') {
      if (segments.length >= 1) {
        const handle = sanitizeHandle(segments[0]);
        return {
          platform: 'threads',
          handle: `@${handle.replace(/^@/, '')}`,
          profileUrl: `https://www.threads.net/@${handle.replace(/^@/, '')}`,
        };
      }
    } else if (platformKey === 'discord') {
      if (segments.length >= 1) {
        const code = sanitizeHandle(segments[segments.length - 1]);
        if (!code) return null;
        return {
          platform: 'discord',
          handle: code,
          profileUrl: `https://discord.gg/${code}`,
        };
      }
    } else if (platformKey === 'telegram') {
      if (segments.length >= 1) {
        const handle = sanitizeHandle(segments[0]);
        if (!handle || ['joinchat', 'share'].includes(handle.toLowerCase())) return null;
        return {
          platform: 'telegram',
          handle: `@${handle.replace(/^@/, '')}`,
          profileUrl: `https://t.me/${handle.replace(/^@/, '')}`,
        };
      }
    }
  }

  return null;
}

/**
 * Extracts and canonicalizes all valid social media links from HTML anchor elements.
 */
export function extractSocialLinksFromHtml(
  html: string,
  sourceUrl: string,
  originUrl: string,
  depth = 0,
  platformFilter?: SocialPlatform[]
): ExtractedSocialLink[] {
  const allowed = platformFilter && platformFilter.length > 0 ? new Set(platformFilter) : null;
  const seenProfiles = new Set<string>();
  const results: ExtractedSocialLink[] = [];

  const hrefRegex = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    const rawHref = (match[1] || match[2] || match[3] || '').trim();
    if (!rawHref.startsWith('http://') && !rawHref.startsWith('https://') && !rawHref.startsWith('//')) {
      continue;
    }

    const fullUrl = rawHref.startsWith('//') ? `https:${rawHref}` : rawHref;
    const parsed = parseSocialLink(fullUrl);
    if (!parsed) continue;

    if (allowed && !allowed.has(parsed.platform)) continue;

    const key = `${parsed.platform}:${parsed.handle.toLowerCase()}`;
    if (!seenProfiles.has(key)) {
      seenProfiles.add(key);
      results.push({
        platform: parsed.platform,
        platformLabel: PLATFORM_INFO[parsed.platform].label,
        handle: parsed.handle,
        profileUrl: parsed.profileUrl,
        sourceUrl,
        originUrl,
        depth,
      });
    }
  }

  return results;
}
