const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');

// ===== 検索設定 =====
const CONFIG = {
  // SUUMOのエリア（東京都の区）
  suumoWard: 'sc_shinjuku',  // sc_shinjuku / sc_shibuya / sc_minato / sc_bunkyo 等
  // 間取り（1K と 1LDK）
  madori: ['1K', '1LDK'],
  // 各サイトの最大取得件数
  maxResults: 20,
};
// ====================

const results = { suumo: [], homes: [], athome: 'CAPTCHA保護のためスキップ' };

// ------- SUUMO -------
async function scrapeSUUMO(context) {
  console.log('\n[SUUMO] 検索開始...');
  const page = await context.newPage();
  try {
    // エリアページへ移動（フィルタフォームを使うため）
    await page.goto(`https://suumo.jp/chintai/tokyo/${CONFIG.suumoWard}/`, {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await page.waitForTimeout(2000);

    // 1K (md=02, id=md1) と 1LDK (md=04, id=md3) をチェック
    await page.check('#md1');  // 1K
    await page.check('#md3');  // 1LDK

    // フォーム送信
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
      page.evaluate(() => document.getElementById('js-searchPanel').submit())
    ]);

    const resultUrl = page.url();
    console.log(`[SUUMO] 結果URL: ${resultUrl.substring(0, 80)}...`);

    const items = await page.$$eval('.cassetteitem', (cards, max) => {
      return cards.slice(0, max).map(card => {
        const name = card.querySelector('.cassetteitem_content-title')?.textContent?.trim() || '';
        // 結果ページのセレクタ
        const address = card.querySelector('.cassetteitem_detail-col1')?.textContent?.trim() || '';
        const nearest = card.querySelector('.cassetteitem_detail-col2 .cassetteitem_detail-text')?.textContent?.trim()?.replace(/\s+/g, ' ') || '';
        const age = card.querySelector('.cassetteitem_detail-col3')?.textContent?.trim()?.replace(/\s+/g, ' ') || '';

        const rooms = [];
        card.querySelectorAll('tr.js-cassette_link').forEach(row => {
          const tds = row.querySelectorAll('td');
          if (tds.length < 6) return;
          const floor = tds[2]?.textContent?.trim() || '';
          const rentKanriText = tds[3]?.textContent?.trim().replace(/\s+/g, '\n').split('\n') || [];
          const rent = rentKanriText[0] || '';
          const kanri = rentKanriText[1] || '';
          const madoriMensekiText = tds[5]?.textContent?.trim().replace(/\s+/g, '\n').split('\n') || [];
          const madori = madoriMensekiText[0] || '';
          const menseki = madoriMensekiText[1] || '';
          if (madori && rent) {
            rooms.push({ floor, madori, menseki, rent, kanri });
          }
        });

        return { name, address, nearest, age, rooms };
      }).filter(item => item.name || item.rooms.length > 0);
    }, CONFIG.maxResults);

    results.suumo = items;
    console.log(`[SUUMO] ${items.length}件取得`);
  } catch (e) {
    console.error('[SUUMO] エラー:', e.message);
  } finally {
    await page.close();
  }
}

// ------- HOMES -------
async function scrapeHOMES(context) {
  console.log('\n[HOMES] 検索開始...');
  const page = await context.newPage();
  try {
    const url = 'https://www.homes.co.jp/chintai/tokyo/list/?clientnm=1K%2C1LDK&sort=newdate';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    console.log(`[HOMES] 結果URL: ${url}`);

    const items = await page.evaluate((max) => {
      const results = [];

      // ケース1: マルチユニットビル（unitResidenceSummary テーブル）
      document.querySelectorAll('table.unitResidenceSummary').forEach(tbl => {
        if (results.length >= max) return;

        // 建物情報（address/transport）を親要素から取得
        let address = '', transport = '', name = '';
        let parent = tbl.parentElement;
        for (let i = 0; i < 10; i++) {
          if (!parent) break;
          if (!address) {
            const addrTd = parent.querySelector('td.address, th + td');
            if (addrTd) address = addrTd.textContent.trim().replace(/\s+/g, ' ');
          }
          if (!transport) {
            const trafficTd = parent.querySelector('td.traffic');
            if (trafficTd) transport = trafficTd.textContent.trim().replace(/\s+/g, ' ');
          }
          if (!name) {
            const nameEl = parent.querySelector('.prg-bukkenNameAnchor, .bukkenName a');
            if (nameEl) name = nameEl.textContent.trim();
          }
          if (address && name) break;
          parent = parent.parentElement;
        }

        // 部屋一覧の各行
        tbl.querySelectorAll('tbody tr').forEach(row => {
          if (results.length >= max) return;
          const layoutTd = row.querySelector('td.layout');
          const priceTd = row.querySelector('td.price');
          const floorTd = row.querySelector('td.floar');
          if (!layoutTd || !priceTd) return;

          const layoutText = layoutTd.textContent.trim().replace(/\s+/g, ' ');
          const priceText = priceTd.textContent.trim().replace(/\s+/g, ' ');
          const floorText = floorTd ? floorTd.textContent.trim().replace(/\s+/g, ' ') : '';

          // layoutText例: "1K20.79m²" or "1LDK 35.5m²"
          const layoutMatch = layoutText.match(/^([\w\s]+?)\s*(\d+(?:\.\d+)?m²)$/);
          const madori = layoutMatch ? layoutMatch[1].trim() : layoutText;
          const menseki = layoutMatch ? layoutMatch[2] : '';

          // rentのみ抽出（"10.1万円/8,000円1ヶ月/..."）
          const rentMatch = priceText.match(/^([\d.]+万円)/);
          const rent = rentMatch ? rentMatch[1] : priceText.split('/')[0].trim();

          results.push({ name, address, transport, floor: floorText, rent, madori, menseki });
        });
      });

      // ケース2: シングルユニット（td.price が直接ある）
      document.querySelectorAll('.bukkenSpec table').forEach(tbl => {
        if (results.length >= max) return;
        const tdPrice = tbl.querySelector('td.price');
        if (!tdPrice) return; // マルチユニット系はスキップ
        const tdAddress = tbl.querySelector('td.address');
        const tdTraffic = tbl.querySelector('td.traffic');
        const tdSpace = tbl.querySelector('td.space');

        const rent = tdPrice.textContent.trim().replace(/\s+/g, ' ');
        const address = tdAddress ? tdAddress.textContent.trim() : '';
        const transport = tdTraffic ? tdTraffic.textContent.trim().replace(/\s+/g, ' ') : '';
        const spaceText = tdSpace ? tdSpace.textContent.trim() : '';

        let name = '';
        let el = tbl.parentElement;
        for (let j = 0; j < 8; j++) {
          if (!el) break;
          const nameEl = el.querySelector('.prg-bukkenNameAnchor, .bukkenName a');
          if (nameEl) { name = nameEl.textContent.trim(); break; }
          el = el.parentElement;
        }

        const spaceParts = spaceText.split('/');
        const menseki = spaceParts[0]?.trim() || '';
        const madori = spaceParts[1]?.trim() || '';

        results.push({ name, address, transport, rent, madori, menseki });
      });

      return results;
    }, CONFIG.maxResults);

    results.homes = items;
    console.log(`[HOMES] ${items.length}件取得`);
  } catch (e) {
    console.error('[HOMES] エラー:', e.message);
  } finally {
    await page.close();
  }
}

// ------- 結果表示 -------
function printResults() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              賃貸物件検索結果                             ║');
  console.log(`║  条件: 間取り=${CONFIG.madori.join('/')} / エリア=東京都${CONFIG.suumoWard.replace('sc_', '')}   ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  // SUUMO
  console.log(`\n▶ SUUMO (${Array.isArray(results.suumo) ? results.suumo.length : 0}件)`);
  console.log('─'.repeat(60));
  if (Array.isArray(results.suumo)) {
    results.suumo.forEach((item, i) => {
      console.log(`\n[${i + 1}] ${item.name || '(名称なし)'}`);
      if (item.address) console.log(`  📍 ${item.address}`);
      if (item.nearest) console.log(`  🚉 ${item.nearest}`);
      if (item.rooms.length > 0) {
        item.rooms.slice(0, 3).forEach(r => {
          console.log(`  🏠 ${r.floor} | ${r.madori} ${r.menseki} | 家賃:${r.rent} 管理費:${r.kanri}`);
        });
      }
    });
  }

  // HOMES
  console.log(`\n\n▶ HOMES (${Array.isArray(results.homes) ? results.homes.length : 0}件)`);
  console.log('─'.repeat(60));
  if (Array.isArray(results.homes)) {
    results.homes.forEach((item, i) => {
      console.log(`\n[${i + 1}] ${item.name || '(名称なし)'}`);
      if (item.address) console.log(`  📍 ${item.address}`);
      if (item.transport) console.log(`  🚉 ${item.transport}`);
      console.log(`  🏠 ${item.madori} ${item.menseki} | 家賃:${item.rent}`);
    });
  }

  // athome
  console.log(`\n\n▶ athome`);
  console.log('─'.repeat(60));
  console.log(`  ⚠️  ${results.athome}`);
}

// ------- メイン -------
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

  try {
    // SUUMO と HOMES を並列実行
    await Promise.all([
      scrapeSUUMO(context),
      scrapeHOMES(context),
    ]);
  } finally {
    await browser.close();
  }

  printResults();

  // JSON保存
  const outFile = '/home/user/Claude-code/rental-results.json';
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf-8');

  const suumoCount = Array.isArray(results.suumo) ? results.suumo.length : 0;
  const homesCount = Array.isArray(results.homes) ? results.homes.length : 0;
  console.log(`\n\n合計 ${suumoCount + homesCount}件 (SUUMO:${suumoCount} / HOMES:${homesCount})`);
  console.log(`結果を ${outFile} に保存しました。`);
})();
