import { chromium, Browser, Page } from '@playwright/test';
import { Property } from './types';

// Tokyo rental search: 1K/1R, max 10万円, 築10年以内
const SUUMO_URL =
  'https://suumo.jp/jj/chintai/ichiran/FR301FC001/' +
  '?ar=030&bs=040&ta=13&kb=1&mb=10&mt=tm&cn=0' +
  '&shkr1=03&shkr2=03' + // 1R, 1K
  '&nen=10' +             // 築10年以内
  '&pc=50';               // 50件表示

function calcEffectiveCost(rent: number, management: number): number {
  // 補助：賃料の50%、上限5万、課税20%
  // 賃料10万以下: 実質 = 0.6 × 賃料 + 管理費
  const subsidy = Math.min(rent * 0.5, 50000);
  const afterTaxSubsidy = subsidy * 0.8;
  return Math.round(rent - afterTaxSubsidy + management);
}

function parseRent(text: string): number {
  // "9.7万円" → 97000, "97,000円" → 97000
  const wan = text.match(/([\d.]+)万円/);
  if (wan) return Math.round(parseFloat(wan[1]) * 10000);
  const yen = text.match(/([\d,]+)円/);
  if (yen) return parseInt(yen[1].replace(/,/g, ''), 10);
  return 0;
}

function parseArea(text: string): number {
  const m = text.match(/([\d.]+)\s*m/);
  return m ? parseFloat(m[1]) : 0;
}

async function scrapeOnePage(page: Page, url: string): Promise<Property[]> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const properties: Property[] = [];

  const cards = await page.$$('.cassetteitem');
  if (cards.length === 0) {
    console.warn('[WARN] 物件カードが見つかりませんでした。セレクタを確認してください。');
    return [];
  }

  for (const card of cards) {
    // Building-level info
    const name = await card
      .$eval('.cassetteitem_content-title', (el) => el.textContent?.trim() ?? '')
      .catch(() => '不明');

    const detailItems = await card
      .$$eval('.cassetteitem_detail-col1 li', (els) =>
        els.map((el) => el.textContent?.trim().replace(/\s+/g, ' ') ?? '')
      )
      .catch(() => [] as string[]);

    const address = detailItems[0] ?? '';
    const structure = detailItems[1] ?? '';
    const builtYear = detailItems[2] ?? '';

    const stations = await card
      .$$eval('.cassetteitem_detail-col2 .cassetteitem_detail-text', (els) =>
        els.map((el) => el.textContent?.trim().replace(/\s+/g, '') ?? '')
      )
      .catch(() => [] as string[]);

    // Room-level rows
    const rows = await card.$$('tbody tr.js-cassette_link');

    for (const row of rows) {
      const cells = await row
        .$$eval('td', (tds) =>
          tds.map((td) => td.textContent?.trim().replace(/\s+/g, ' ') ?? '')
        )
        .catch(() => [] as string[]);

      if (cells.length < 7) continue;

      const floor = cells[0] ?? '';
      const rentText = cells[1] ?? '';
      const mgmtText = cells[2] ?? '';
      const deposit = cells[3] ?? '';
      const keyMoney = cells[4] ?? '';
      const layout = cells[5] ?? '';
      const areaText = cells[6] ?? '';

      // Filter: 1K or 1R only
      if (!/^1[KR]$/.test(layout.trim())) continue;

      const rent = parseRent(rentText);
      const management = parseRent(mgmtText);
      const area = parseArea(areaText);

      if (rent === 0 || rent > 100000) continue;

      const effectiveCost = calcEffectiveCost(rent, management);
      const effectiveCostPerSqm = area > 0 ? Math.round(effectiveCost / area) : 0;

      const href = await row
        .$eval('a', (el) => el.getAttribute('href') ?? '')
        .catch(() => '');

      properties.push({
        name,
        address,
        stations,
        layout: layout.trim(),
        area,
        rent,
        management,
        deposit,
        keyMoney,
        builtYear,
        structure,
        floor,
        effectiveCost,
        effectiveCostPerSqm,
        url: href.startsWith('http') ? href : `https://suumo.jp${href}`,
      });
    }
  }

  return properties;
}

export async function scrapeProperties(): Promise<Property[]> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--ignore-certificate-errors', '--no-sandbox'],
    });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    console.log('SUUMO にアクセス中...');
    const properties = await scrapeOnePage(page, SUUMO_URL);

    // Sort by effectiveCost ascending
    properties.sort((a, b) => a.effectiveCost - b.effectiveCost);

    return properties;
  } finally {
    if (browser) await browser.close();
  }
}
