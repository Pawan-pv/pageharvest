import { describe, it, expect } from 'vitest';
import { extractEmailsFromHtml, isValidEmail } from '@/core/email/email-parser';

describe('Email Extractor Parser', () => {
  it('validates email formats and filters false positives', () => {
    expect(isValidEmail('founder@acme.co')).toBe(true);
    expect(isValidEmail('support+help@sub.domain.org')).toBe(true);

    // Reject false positives
    expect(isValidEmail('image@2x.png')).toBe(false);
    expect(isValidEmail('icon@1.5x.jpg')).toBe(false);
    expect(isValidEmail('style@common.css')).toBe(false);
    expect(isValidEmail('app@bundle.js')).toBe(false);
    expect(isValidEmail('test@example.com')).toBe(false);
    expect(isValidEmail('test@sentry.io')).toBe(false);
    expect(isValidEmail('git@github.com')).toBe(false);
    expect(isValidEmail('invalid-no-at.com')).toBe(false);
  });

  it('extracts emails from mailto: links and strips query parameters', () => {
    const html = `
      <div>
        <a href="mailto:contact@mybusiness.com?subject=Inquiry&body=Hello">Contact Us</a>
        <a href="mailto:sales@mybusiness.com">Sales</a>
      </div>
    `;

    const results = extractEmailsFromHtml(
      html,
      'https://mybusiness.com/about',
      'https://mybusiness.com',
      0,
      'About Us'
    );

    expect(results).toHaveLength(2);
    expect(results[0].email).toBe('contact@mybusiness.com');
    expect(results[0].emailDomain).toBe('mybusiness.com');
    expect(results[0].foundVia).toBe('mailto');
    expect(results[0].pageTitle).toBe('About Us');
    expect(results[1].email).toBe('sales@mybusiness.com');
  });

  it('extracts plaintext and obfuscated emails', () => {
    const html = `
      <p>Reach out to team [at] startup [dot] io or press (at) startup.io for inquiries.</p>
      <p>Direct inquiries: ceo&#64;startup&#46;io.</p>
      <p>Raw text: general@startup.io</p>
    `;

    const results = extractEmailsFromHtml(
      html,
      'https://startup.io/contact',
      'https://startup.io',
      1
    );

    const emails = results.map((r) => r.email);
    expect(emails).toContain('team@startup.io');
    expect(emails).toContain('press@startup.io');
    expect(emails).toContain('ceo@startup.io');
    expect(emails).toContain('general@startup.io');
  });

  it('deduplicates emails preserving first foundVia origin', () => {
    const html = `
      <a href="mailto:info@agency.org">Email Us</a>
      <p>You can email info@agency.org at any time.</p>
    `;

    const results = extractEmailsFromHtml(
      html,
      'https://agency.org',
      'https://agency.org'
    );

    expect(results).toHaveLength(1);
    expect(results[0].email).toBe('info@agency.org');
    expect(results[0].foundVia).toBe('mailto');
  });
});
