import { BrowserContext, Page } from '@playwright/test';
import { Property, calcEffectiveCost, parseRent, parseArea } from '../types';

// 東京メトロ東西線 賃貸 1K/1R, 10万円以下, 築10年以内, 50件/page
// ra=013: 東京都, ra=012: 千葉県（浦安・妙典等）, rn=0025: 東西線
// cb/ct: 賃料, md=01/02: 1R/1K, cn=10: 築10年以内
const SUUMO_BASE =
  'https://suumo.jp/jj/chintai/ichiran/FR301FC001/' +
  '?ar=030&bs=040&ra=013&ra=012&rn=0025&cb=0.0&ct=10.0&md=01&md=02&cn=10&pc=50';

const CURRENT_YEAR = 2026;

function parseBuiltYearFromAge(text: string): number {
  // "築7年" → 2026-7 = 2019, "新築" → 2026
  if (text.includes('新築')) return CURRENT_YEAR;
  const m = text.match(/築(\d+)年/);
  return m ? CURRENT_YEAR - parseInt(m[1], 10) : 0;
}

async function scrapeOnePage(page: Page, pageNum: number): Promise<{ properties: Property[]; hasNext: boolean }> {
  const url = pageNum === 1 ? SUUMO_BASE : `${SUUMO_BASE}&pn=${pageNum}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const title = await page.title();
  if (title.includes('エラー')) return { properties: [], hasNext: false };

  const properties: Property[] = [];
  const cards = await page.$$('.cassetteitem');
  if (cards.length === 0) return { properties: [], hasNext: false };

  for (const card of cards) {
    const name = await card
      .$eval('.cassetteitem_content-title', (el) => el.textContent?.trim() ?? '')
      .catch(() => '');

    const address = await card
      .$eval('.cassetteitem_detail-col1', (el) => el.textContent?.trim() ?? '')
      .catch(() => '');

    const stations = await card
      .$$eval('.cassetteitem_detail-col2 .cassetteitem_detail-text', (els) =>
        els.map((el) => el.textContent?.trim().replace(/\s+/g, '') ?? '')
      )
      .catch(() => [] as string[]);

    const builtRaw = await card
      .$eval('.cassetteitem_detail-col3 div', (el) => el.textContent?.trim() ?? '')
      .catch(() => '');

    const structureText = await card
      .$$eval('.cassetteitem_detail-col3 div', (els) => els.map((el) => el.textContent?.trim() ?? ''))
      .catch(() => [] as string[]);
    const structure = structureText[1] ?? '';

    const rows = await card.$$('tbody tr.js-cassette_link');

    for (const row of rows) {
      const layout = await row
        .$eval('.cassetteitem_madori', (el) => el.textContent?.trim() ?? '')
        .catch(() => '');
      const areaText = await row
        .$eval('.cassetteitem_menseki', (el) => el.textContent?.trim() ?? '')
        .catch(() => '');
      const rentText = await row
        .$eval('.cassetteitem_price--rent .cassetteitem_other-emphasis', (el) => el.textContent?.trim() ?? '')
        .catch(() => '');
      const mgmtText = await row
        .$eval('.cassetteitem_price--administration', (el) => el.textContent?.trim() ?? '')
        .catch(() => '');
      const deposit = await row
        .$eval('.cassetteitem_price--deposit', (el) => el.textContent?.trim() ?? '')
        .catch(() => '-');
      const keyMoney = await row
        .$eval('.cassetteitem_price--gratuity', (el) => el.textContent?.trim() ?? '')
        .catch(() => '-');
      const floor = await row
        .$eval('td:nth-child(3)', (el) => el.textContent?.trim() ?? '')
        .catch(() => '');
      const href = await row
        .$eval('a.js-cassette_link_href', (el) => el.getAttribute('href') ?? '')
        .catch(async () => {
          return await row.$eval('a', (el) => el.getAttribute('href') ?? '').catch(() => '');
        });

      // Filter: 1K/1R only (already URL-filtered but double-check)
      const normalizedLayout = layout
        .replace('ワンルーム', '1R')
        .replace(/１Ｋ|１Ｒ/g, (m) => m.replace('１', '1').replace('Ｋ', 'K').replace('Ｒ', 'R'));
      if (!/^1[KR]$/.test(normalizedLayout)) continue;

      const rent = parseRent(rentText);
      if (!rent || rent > 100000) continue;

      const mgmt = mgmtText === '-' || !mgmtText ? 0 : parseRent(mgmtText);
      const area = parseArea(areaText);
      const effectiveCost = calcEffectiveCost(rent, mgmt);
      const effectiveCostPerSqm = area > 0 ? Math.round(effectiveCost / area) : 0;
      const builtYearNum = parseBuiltYearFromAge(builtRaw);

      properties.push({
        source: 'SUUMO',
        name,
        address,
        stations,
        layout: normalizedLayout,
        area,
        rent,
        management: mgmt,
        deposit,
        keyMoney,
        builtYear: builtRaw,
        builtYearNum,
        structure,
        floor: floor.replace(/\s+/g, ''),
        effectiveCost,
        effectiveCostPerSqm,
        url: href.startsWith('http') ? href : `https://suumo.jp${href}`,
      });
    }
  }

  // Check if next page exists
  const hasNext = await page.$('.pagination-parts--next').then((el) => el !== null).catch(() => false);

  return { properties, hasNext };
}

export async function scrapeSuumo(context: BrowserContext): Promise<Property[]> {
  const page = await context.newPage();
  const allProperties: Property[] = [];

  try {
    console.log('SUUMO にアクセス中 (東西線 1K/1R 10万円以下 築10年以内)...');
    for (let p = 1; p <= 4; p++) {
      const { properties, hasNext } = await scrapeOnePage(page, p);
      allProperties.push(...properties);
      console.log(`  SUUMO page ${p}: ${properties.length} 件`);
      if (!hasNext || properties.length === 0) break;
    }
  } finally {
    await page.close();
  }

  return allProperties;
}
