import { chromium } from '@playwright/test';
import { Property } from './types';
import { scrapeSuumo } from './scrapers/suumo';

export async function scrapeProperties(): Promise<Property[]> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  try {
    const properties = await scrapeSuumo(context);

    // Deduplicate by URL
    const seen = new Set<string>();
    const unique = properties.filter((p) => {
      if (seen.has(p.url)) return false;
      seen.add(p.url);
      return true;
    });

    // Sort by effectiveCost ascending
    unique.sort((a, b) => a.effectiveCost - b.effectiveCost);
    return unique;
  } finally {
    await browser.close();
  }
}
