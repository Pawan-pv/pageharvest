import { describe, it, expect } from 'vitest';
import { extractSocialLinksFromHtml, parseSocialLink } from '@/core/social/social-parser';

describe('Social Media Link Parser', () => {
  it('parses and canonicalizes profiles across major platforms', () => {
    const xResult = parseSocialLink('https://twitter.com/pageharvest?lang=en');
    expect(xResult).toEqual({
      platform: 'x',
      handle: '@pageharvest',
      profileUrl: 'https://x.com/pageharvest',
    });

    const xDirect = parseSocialLink('https://x.com/startup_founder');
    expect(xDirect?.platform).toBe('x');
    expect(xDirect?.handle).toBe('@startup_founder');

    const linkedin = parseSocialLink('https://www.linkedin.com/company/acme-corp/');
    expect(linkedin).toEqual({
      platform: 'linkedin',
      handle: 'acme-corp',
      profileUrl: 'https://www.linkedin.com/company/acme-corp/',
    });

    const github = parseSocialLink('https://github.com/my-org');
    expect(github).toEqual({
      platform: 'github',
      handle: 'my-org',
      profileUrl: 'https://github.com/my-org',
    });

    const youtube = parseSocialLink('https://youtube.com/@techchannel');
    expect(youtube).toEqual({
      platform: 'youtube',
      handle: '@techchannel',
      profileUrl: 'https://www.youtube.com/@techchannel',
    });

    const instagram = parseSocialLink('https://instagram.com/nature.photos/');
    expect(instagram).toEqual({
      platform: 'instagram',
      handle: '@nature.photos',
      profileUrl: 'https://www.instagram.com/nature.photos/',
    });
  });

  it('rejects share, intent, embed, and noise URLs', () => {
    expect(parseSocialLink('https://twitter.com/intent/tweet?text=Hello')).toBeNull();
    expect(parseSocialLink('https://www.facebook.com/sharer/sharer.php?u=example.com')).toBeNull();
    expect(parseSocialLink('https://www.linkedin.com/shareArticle?mini=true')).toBeNull();
    expect(parseSocialLink('https://instagram.com/explore/tags/summer/')).toBeNull();
    expect(parseSocialLink('https://github.com/features')).toBeNull();
  });

  it('extracts unique social links from HTML with platform filtering', () => {
    const html = `
      <footer>
        <a href="https://x.com/team_alpha">Twitter</a>
        <a href="https://github.com/team-alpha/repo">GitHub</a>
        <a href="https://discord.gg/abc123xyz">Discord Server</a>
        <a href="https://facebook.com/sharer.php?u=test">Share</a>
      </footer>
    `;

    const all = extractSocialLinksFromHtml(
      html,
      'https://alpha.dev',
      'https://alpha.dev',
      0
    );
    expect(all).toHaveLength(3);

    const filtered = extractSocialLinksFromHtml(
      html,
      'https://alpha.dev',
      'https://alpha.dev',
      0,
      ['github', 'discord']
    );
    expect(filtered).toHaveLength(2);
    expect(filtered.map((s) => s.platform)).toEqual(['github', 'discord']);
  });
});
