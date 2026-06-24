/**
 * 汎用1駅スクレイパー
 * Usage: node scrape-one-station.js --area=kiba --label=木場駅 --url=https://suumo.jp/chintai/tokyo/ek_XXXXX/
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs   = require('fs');
const path = require('path');
const { initDb, upsertProperty, insertSession, insertRooms } = require('./db');

process.env.NODE_NO_WARNINGS = '1';

// --- CLI args ---
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const eq = a.indexOf('=');
      return eq > 0 ? [a.slice(2, eq), a.slice(eq + 1)] : [a.slice(2), true];
    })
);

const AREA  = args.area  || 'unknown';
const LABEL = args.label || AREA;
const URL   = args.url;

if (!URL) {
  console.error('Usage: node scrape-one-station.js --area=KEY --label=駅名 --url=https://suumo.jp/...');
  process.exit(1);
}

console.log(`\n[${LABEL}] スクレイピング開始 → ${URL}`);

// --- scraping ---
async function scrapeStation(context, stationUrl) {
  const page = await context.newPage();
  const items = [];
  try {
    await page.goto(stationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 間取りフィルタ: 1R / 1K / 1LDK
    await page.check('#md0').catch(() => {});
    await page.check('#md1').catch(() => {});
    await page.check('#md3').catch(() => {});
    // 家賃上限 12万円
    await page.selectOption('select[name="ct"]', '12.0').catch(() => {});

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
      page.evaluate(() => {
        const f = document.getElementById('js-searchPanel');
        if (f) f.submit();
      }),
    ]);

    let pageNum = 1;
    while (pageNum <= 5) {
      const pageItems = await page.$$eval('.cassetteitem', (cards) => {
        return cards.map(card => {
          const name    = card.querySelector('.cassetteitem_content-title')?.textContent?.trim() || '';
          const address = card.querySelector('.cassetteitem_detail-col1')?.textContent?.trim() || '';
          const stEls   = Array.from(card.querySelectorAll('.cassetteitem_detail-col2 .cassetteitem_detail-text'));
          const allStation = stEls.map(e => e.textContent.trim().replace(/\s+/g, ' ')).join(' | ');
          const nearest    = stEls[0]?.textContent?.trim()?.replace(/\s+/g, ' ') || '';
          const ageText  = card.querySelector('.cassetteitem_detail-col3')?.textContent?.trim()?.replace(/\s+/g, ' ') || '';

          const rooms = [];
          card.querySelectorAll('tr.js-cassette_link').forEach(row => {
            const tds = row.querySelectorAll('td');
            if (tds.length < 6) return;
            const floor       = tds[2]?.textContent?.trim() || '';
            const rentKanri   = (tds[3]?.textContent?.trim() || '').replace(/\s+/g, '\n').split('\n');
            const rent        = rentKanri[0] || '';
            const kanri       = rentKanri[1] || '';
            const shikiRei    = (tds[4]?.textContent?.trim() || '').replace(/\s+/g, '\n').split('\n');
            const shiki       = shikiRei[0] || '-';
            const rei         = shikiRei[1] || '-';
            const madoriMenseki = (tds[5]?.textContent?.trim() || '').replace(/\s+/g, '\n').split('\n');
            const madori      = madoriMenseki[0] || '';
            const menseki     = madoriMenseki[1] || '';
            if (madori && rent) rooms.push({ floor, madori, menseki, rent, kanri, shiki, rei });
          });

          return { name, address, allStation, nearest, ageText, rooms };
        }).filter(i => i.name && i.rooms.length > 0);
      });

      items.push(...pageItems);
      console.log(`  [${LABEL}] p${pageNum}: ${pageItems.length}件`);

      const nextBtn  = await page.$('.pagination_set-nav li:last-child a');
      const nextText = await nextBtn?.textContent().catch(() => '');
      if (nextBtn && nextText && !nextText.includes('前') && pageNum < 5) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
          nextBtn.click(),
        ]).catch(() => {});
        await page.waitForTimeout(1200);
        pageNum++;
      } else break;
    }
  } catch (e) {
    console.error(`[${LABEL}] エラー:`, e.message);
  } finally {
    await page.close();
  }
  return items;
}

// --- main ---
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'ja-JP',
    viewport: { width: 1280, height: 800 },
  });

  let items = [];
  try {
    items = await scrapeStation(context, URL);
  } finally {
    await browser.close();
  }

  const totalRooms = items.reduce((n, p) => n + (p.rooms?.length || 0), 0);
  console.log(`[${LABEL}] 取得: 物件${items.length}件 / 部屋${totalRooms}件`);

  // --- JSON保存 ---
  const outDir = path.join(__dirname, 'station-data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${AREA}.json`);
  fs.writeFileSync(outFile, JSON.stringify(
    { area: AREA, label: LABEL, url: URL, scraped_at: new Date().toISOString(), items },
    null, 2
  ));
  console.log(`[${LABEL}] JSON保存: ${outFile}`);

  // --- DB保存 ---
  const db = initDb();
  const sessionId = insertSession(db, {
    search_area:     AREA,
    search_madori:   '1R,1K,1LDK',
    search_max_rent: 120000,
    source:          'SUUMO',
    result_count:    totalRooms,
  });
  for (const item of items) {
    if (!item.name || !item.rooms?.length) continue;
    const pid = upsertProperty(db, {
      name:        item.name,
      address:     item.address,
      station_info: item.allStation || item.nearest,
      ageText:     item.ageText,
      source:      'SUUMO',
    });
    insertRooms(db, pid, sessionId, item.rooms);
  }
  db.close();
  console.log(`[${LABEL}] DB保存完了: session#${sessionId}`);
})();
