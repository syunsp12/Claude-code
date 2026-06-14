import { chromium } from '@playwright/test';
import { Property, CURRENT_PROPERTY } from './types';
import { scrapeSuumo } from './scrapers/suumo';
import { verifyProperties } from './verify';

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

    // Sort by builtYearNum descending (newest first), then effectiveCost ascending
    unique.sort((a, b) => b.builtYearNum - a.builtYearNum || a.effectiveCost - b.effectiveCost);

    // 実質月額が比較基準以下の候補のみ、詳細ページで募集状況を検証する
    const candidates = unique.filter((p) => p.effectiveCost <= CURRENT_PROPERTY.effectiveCost);
    console.log(
      `\n募集状況を検証中（実質月額 ${CURRENT_PROPERTY.effectiveCost.toLocaleString('ja-JP')}円以下の候補 ${candidates.length} 件の詳細ページを確認）...`
    );
    await verifyProperties(context, candidates);

    return unique;
  } finally {
    await browser.close();
  }
}
