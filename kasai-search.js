const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const { initDb, upsertProperty, insertSession, insertRooms } = require('./db');

// ===== 検索設定 =====
const CONFIG = {
  // SUUMO 駅コード（東西線）
  suumoStations: [
    { name: '葛西駅',   code: 'ek_07760' },
    { name: '西葛西駅', code: 'ek_28520' },
  ],
  // HOMES 江戸川区
  homesAreaUrl: 'https://www.homes.co.jp/chintai/tokyo/edogawa-city/list/?clientnm=1R%2C1K%2C1LDK&sort=newdate',
  targetStations: ['葛西', '西葛西'],
  maxRentYen: 120000,
  maxRentMan: 12.0,
};
// ====================

const allResults = { suumo: [], homes: [] };

// ------- 家賃パース -------
function parseRent(rentStr) {
  if (!rentStr) return null;
  const m = rentStr.match(/([\d.]+)万円/);
  if (m) return Math.round(parseFloat(m[1]) * 10000);
  const m2 = rentStr.match(/([\d,]+)円/);
  if (m2) return parseInt(m2[1].replace(',', ''));
  return null;
}

function parseMenseki(s) {
  if (!s) return null;
  const m = s.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

// ------- SUUMO: 駅ページから検索 -------
async function scrapeSUUMOStation(context, stationName, stationCode) {
  const page = await context.newPage();
  const items = [];
  try {
    const stationUrl = `https://suumo.jp/chintai/tokyo/${stationCode}/`;
    await page.goto(stationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 間取りチェック: 1R(md0), 1K(md1), 1LDK(md3)
    await page.check('#md0').catch(() => {});
    await page.check('#md1').catch(() => {});
    await page.check('#md3').catch(() => {});

    // 家賃上限: 12万円
    await page.selectOption('select[name="ct"]', '12.0').catch(() => {});

    // フォーム送信
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
      page.evaluate(() => {
        const form = document.getElementById('js-searchPanel');
        if (form) form.submit();
      })
    ]);

    let pageNum = 1;
    while (true) {
      const pageItems = await page.$$eval('.cassetteitem', (cards) => {
        return cards.map(card => {
          const name = card.querySelector('.cassetteitem_content-title')?.textContent?.trim() || '';
          const address = card.querySelector('.cassetteitem_detail-col1')?.textContent?.trim() || '';
          const allStationEl = Array.from(card.querySelectorAll('.cassetteitem_detail-col2 .cassetteitem_detail-text'));
          const allStation = allStationEl.map(e => e.textContent.trim().replace(/\s+/g, ' ')).join(' | ');
          const nearest = allStationEl[0]?.textContent?.trim()?.replace(/\s+/g, ' ') || '';
          const ageText = card.querySelector('.cassetteitem_detail-col3')?.textContent?.trim()?.replace(/\s+/g, ' ') || '';

          const rooms = [];
          card.querySelectorAll('tr.js-cassette_link').forEach(row => {
            const tds = row.querySelectorAll('td');
            if (tds.length < 6) return;
            const floor = tds[2]?.textContent?.trim() || '';
            const rentKanri = (tds[3]?.textContent?.trim() || '').replace(/\s+/g, '\n').split('\n');
            const rent = rentKanri[0] || '';
            const kanri = rentKanri[1] || '';
            const shikiRei = (tds[4]?.textContent?.trim() || '').replace(/\s+/g, '\n').split('\n');
            const shiki = shikiRei[0] || '-';
            const rei = shikiRei[1] || '-';
            const madoriMenseki = (tds[5]?.textContent?.trim() || '').replace(/\s+/g, '\n').split('\n');
            const madori = madoriMenseki[0] || '';
            const menseki = madoriMenseki[1] || '';
            if (madori && rent) rooms.push({ floor, madori, menseki, rent, kanri, shiki, rei });
          });

          return { name, address, allStation, nearest, ageText, rooms };
        }).filter(i => i.name && i.rooms.length > 0);
      });

      items.push(...pageItems);
      console.log(`  [SUUMO ${stationName}] p${pageNum}: ${pageItems.length}件 (累計${items.length}件)`);

      // 次ページ
      const nextBtn = await page.$('.pagination_set-nav li:last-child a');
      const nextText = await nextBtn?.textContent();
      if (nextBtn && nextText && !nextText.includes('前') && pageNum < 5) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
          nextBtn.click()
        ]);
        await page.waitForTimeout(1200);
        pageNum++;
      } else {
        break;
      }
    }
  } catch (e) {
    console.error(`[SUUMO ${stationName}] エラー:`, e.message);
  } finally {
    await page.close();
  }
  return items.map(i => ({ ...i, source: 'SUUMO', sourceStation: stationName }));
}

// ------- HOMES: 江戸川区から取得してフィルタ -------
async function scrapeHOMES(context) {
  console.log('\n[HOMES] 江戸川区 1R/1K/1LDK 取得中...');
  const page = await context.newPage();
  const items = [];
  try {
    await page.goto(CONFIG.homesAreaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    let pageNum = 1;
    while (pageNum <= 5) {
      console.log(`  [HOMES] p${pageNum}: ${page.url().substring(0, 70)}...`);

      const pageItems = await page.evaluate(() => {
        const results = [];

        // マルチユニットビル
        document.querySelectorAll('table.unitResidenceSummary').forEach(tbl => {
          let address = '', transport = '', name = '';
          let parent = tbl.parentElement;
          for (let i = 0; i < 12; i++) {
            if (!parent) break;
            if (!address) { const el = parent.querySelector('td.address'); if (el) address = el.textContent.trim(); }
            if (!transport) { const el = parent.querySelector('td.traffic'); if (el) transport = el.textContent.trim().replace(/\s+/g, ' '); }
            if (!name) { const el = parent.querySelector('.prg-bukkenNameAnchor, .bukkenName a'); if (el) name = el.textContent.trim(); }
            if (address && name) break;
            parent = parent.parentElement;
          }

          tbl.querySelectorAll('tbody tr').forEach(row => {
            const layoutTd = row.querySelector('td.layout');
            const priceTd = row.querySelector('td.price');
            if (!layoutTd || !priceTd) return;
            const layoutText = layoutTd.textContent.trim().replace(/\s+/g, ' ');
            const priceText = priceTd.textContent.trim().replace(/\s+/g, ' ');
            const floorText = row.querySelector('td.floar')?.textContent?.trim() || '';
            const layoutMatch = layoutText.match(/^(.+?)\s*(\d+(?:\.\d+)?m²)$/);
            const madori = layoutMatch ? layoutMatch[1].trim() : layoutText;
            const menseki = layoutMatch ? layoutMatch[2] : '';
            const rentMatch = priceText.match(/^([\d.]+万円)/);
            const rent = rentMatch ? rentMatch[1] : priceText.split('/')[0].trim();
            results.push({ name, address, transport, floor: floorText, rent, madori, menseki });
          });
        });

        // シングルユニット
        document.querySelectorAll('.bukkenSpec table').forEach(tbl => {
          const tdPrice = tbl.querySelector('td.price');
          if (!tdPrice) return;
          const rent = tdPrice.textContent.trim().replace(/\s+/g, ' ');
          const address = tbl.querySelector('td.address')?.textContent?.trim() || '';
          const transport = tbl.querySelector('td.traffic')?.textContent?.trim()?.replace(/\s+/g, ' ') || '';
          const spaceText = tbl.querySelector('td.space')?.textContent?.trim() || '';
          let name = '';
          let el = tbl.parentElement;
          for (let j = 0; j < 8; j++) {
            if (!el) break;
            const nameEl = el.querySelector('.prg-bukkenNameAnchor, .bukkenName a');
            if (nameEl) { name = nameEl.textContent.trim(); break; }
            el = el.parentElement;
          }
          const spaceParts = spaceText.split('/');
          results.push({ name, address, transport, rent, madori: spaceParts[1]?.trim() || '', menseki: spaceParts[0]?.trim() || '' });
        });

        return results;
      });

      items.push(...pageItems);
      console.log(`  -> ${pageItems.length}件 (累計${items.length}件)`);

      // 次ページ
      const nextLink = await page.$('.pagination a:last-child, [rel="next"], a[class*="next"]');
      const nextHref = await nextLink?.getAttribute('href');
      if (nextLink && nextHref && nextHref !== '#' && pageNum < 5) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
          nextLink.click()
        ]).catch(() => {});
        await page.waitForTimeout(1200);
        pageNum++;
      } else {
        break;
      }
    }
  } catch (e) {
    console.error('[HOMES] エラー:', e.message);
  } finally {
    await page.close();
  }

  // 葛西・西葛西フィルタ
  const filtered = items.filter(i => {
    const st = (i.transport || i.nearest || '');
    return CONFIG.targetStations.some(s => st.includes(s));
  });
  console.log(`[HOMES] 取得${items.length}件 → 葛西・西葛西 ${filtered.length}件`);
  return filtered.map(i => ({ ...i, source: 'HOMES' }));
}

// ------- 相場分析 -------
function analyzeMarket(allFiltered) {
  const TARGET = {
    name: 'フジマンションイーストファイブ 206号室',
    rent: 97000,
    kanri: 0,
    menseki: 30.03,
    madori: '1K',
    station: '葛西駅 徒歩6分',
    age: '築19年',
    shiki: 0,
    rei: 0,
  };

  // 有効物件を抽出（ルーム単位）
  const units = [];
  allFiltered.forEach(item => {
    if (item.rooms && item.rooms.length > 0) {
      item.rooms.forEach(r => {
        const rent = parseRent(r.rent);
        const menseki = parseMenseki(r.menseki);
        if (rent && rent <= CONFIG.maxRentYen && rent > 30000) {
          units.push({
            name: item.name,
            address: item.address,
            station: item.allStation || item.nearest || '',
            ageText: item.ageText || '',
            floor: r.floor,
            madori: r.madori,
            menseki: menseki,
            rent: rent,
            kanri: parseRent(r.kanri) || 0,
            shiki: r.shiki,
            rei: r.rei,
            source: item.source || item.sourceStation || '',
          });
        }
      });
    } else {
      const rent = parseRent(item.rent);
      const menseki = parseMenseki(item.menseki);
      if (rent && rent <= CONFIG.maxRentYen && rent > 30000) {
        units.push({
          name: item.name,
          address: item.address,
          station: item.transport || item.nearest || item.allStation || '',
          floor: item.floor || '',
          madori: item.madori,
          menseki: menseki,
          rent: rent,
          kanri: 0,
          shiki: '-',
          rei: '-',
          source: item.source || '',
        });
      }
    }
  });

  // 重複除去（同名・同家賃）
  const seen = new Set();
  const deduped = units.filter(u => {
    const key = `${u.name}_${u.rent}_${u.floor}_${u.madori}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log('\n\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║   葛西・西葛西駅周辺 1R/1K/1LDK 12万円以下 賃貸物件リスト & 相場分析  ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');

  // --- 物件リスト ---
  console.log(`\n▶ 取得物件リスト (${deduped.length}件)\n`);
  console.log(`${'#'.padEnd(3)} ${'物件名'.padEnd(24)} ${'間取'.padEnd(6)} ${'面積'.padEnd(8)} ${'家賃'.padEnd(8)} ${'管理費'.padEnd(6)} ${'敷/礼'.padEnd(8)} ${'最寄駅'}`);
  console.log('─'.repeat(100));

  deduped.forEach((u, i) => {
    const name = (u.name || '').replace(/^賃貸(マンション|アパート)/, '').substring(0, 22);
    const station = u.station.substring(0, 25);
    const rentStr = `${Math.round(u.rent/1000)}千円`;
    const kanriStr = u.kanri > 0 ? `${Math.round(u.kanri/1000)}千円` : '-';
    const shikiRei = `${u.shiki||'-'}/${u.rei||'-'}`;
    console.log(
      `${String(i+1).padEnd(3)} ${name.padEnd(24)} ${(u.madori||'').padEnd(6)} ${(u.menseki ? u.menseki+'㎡' : '').padEnd(8)} ${rentStr.padEnd(8)} ${kanriStr.padEnd(6)} ${shikiRei.padEnd(8)} ${station}`
    );
  });

  // --- 統計 ---
  const rents = deduped.map(u => u.rent);
  const sorted = [...rents].sort((a, b) => a - b);
  const avg = rents.length ? Math.round(rents.reduce((s,r) => s+r, 0) / rents.length) : 0;
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const q1 = sorted.length ? sorted[Math.floor(sorted.length * 0.25)] : 0;
  const q3 = sorted.length ? sorted[Math.floor(sorted.length * 0.75)] : 0;

  // 1R/1K/1LDK 別統計
  const byMadori = { '1R': [], '1K': [], '1LDK': [] };
  deduped.forEach(u => {
    const m = u.madori;
    if (m === 'ワンルーム' || m === '1R') byMadori['1R'].push(u.rent);
    else if (m === '1K') byMadori['1K'].push(u.rent);
    else if (m === '1LDK' || m === '1SLDK') byMadori['1LDK'].push(u.rent);
  });

  // ㎡単価
  const ppsmList = deduped.filter(u => u.menseki).map(u => u.rent / u.menseki);
  const avgPpsm = ppsmList.length ? Math.round(ppsmList.reduce((s,v)=>s+v,0)/ppsmList.length) : 0;

  console.log('\n\n▶ 相場統計');
  console.log('─'.repeat(60));
  console.log(`  対象物件数      : ${deduped.length}件`);
  console.log(`  家賃 平均       : ${Math.round(avg/1000)}千円`);
  console.log(`  家賃 中央値     : ${Math.round(median/1000)}千円`);
  console.log(`  家賃 Q1 (下25%) : ${Math.round(q1/1000)}千円`);
  console.log(`  家賃 Q3 (上75%) : ${Math.round(q3/1000)}千円`);
  console.log(`  ㎡単価 平均     : ${avgPpsm.toLocaleString()}円/㎡`);
  console.log('');

  for (const [type, rents] of Object.entries(byMadori)) {
    if (rents.length === 0) continue;
    const s = [...rents].sort((a,b)=>a-b);
    const a = Math.round(rents.reduce((x,r)=>x+r,0)/rents.length);
    const md = s[Math.floor(s.length/2)];
    console.log(`  [${type}] ${rents.length}件 / 平均${Math.round(a/1000)}千円 / 中央値${Math.round(md/1000)}千円 / 範囲${Math.round(s[0]/1000)}〜${Math.round(s[s.length-1]/1000)}千円`);
  }

  // --- 類似物件（1K, 25-35㎡）での比較 ---
  const similar = deduped.filter(u =>
    (u.madori === '1K' || u.madori === '1R' || u.madori === 'ワンルーム') &&
    u.menseki && u.menseki >= 20 && u.menseki <= 40
  );
  const simRents = similar.map(u => u.rent).sort((a,b)=>a-b);
  const simAvg = simRents.length ? Math.round(simRents.reduce((s,r)=>s+r,0)/simRents.length) : 0;
  const simMedian = simRents.length ? simRents[Math.floor(simRents.length/2)] : 0;
  const simPpsm = similar.filter(u=>u.menseki).map(u=>u.rent/u.menseki);
  const simAvgPpsm = simPpsm.length ? Math.round(simPpsm.reduce((s,v)=>s+v,0)/simPpsm.length) : 0;

  // --- 対象物件の評価 ---
  const targetPpsm = Math.round(TARGET.rent / TARGET.menseki);
  const diffFromSimMedian = TARGET.rent - simMedian;
  const diffPct = simMedian > 0 ? ((TARGET.rent - simMedian) / simMedian * 100).toFixed(1) : 'N/A';

  console.log('\n\n▶ フジマンションイーストファイブ 206号室 の相場評価');
  console.log('─'.repeat(60));
  console.log(`  家賃             : ${TARGET.rent.toLocaleString()}円 (管理費 ${TARGET.kanri}円)`);
  console.log(`  合計月額         : ${(TARGET.rent + TARGET.kanri).toLocaleString()}円`);
  console.log(`  間取り・面積     : ${TARGET.madori} / ${TARGET.menseki}㎡`);
  console.log(`  立地             : ${TARGET.station}`);
  console.log(`  築年             : ${TARGET.age}`);
  console.log(`  ㎡単価(本物件)   : ${targetPpsm.toLocaleString()}円/㎡`);
  console.log('');
  console.log(`  ---- 全物件との比較 ----`);
  console.log(`  市場 平均        : ${Math.round(avg/1000)}千円  → 本物件は ${TARGET.rent >= avg ? '+' : ''}${Math.round((TARGET.rent-avg)/avg*100)}%`);
  console.log(`  市場 中央値      : ${Math.round(median/1000)}千円  → 本物件は ${TARGET.rent >= median ? '+' : ''}${Math.round((TARGET.rent-median)/median*100)}%`);
  console.log(`  市場㎡単価平均   : ${avgPpsm.toLocaleString()}円/㎡ → 本物件は ${targetPpsm >= avgPpsm ? '+' : ''}${avgPpsm > 0 ? Math.round((targetPpsm-avgPpsm)/avgPpsm*100) : 'N/A'}%`);
  console.log('');
  console.log(`  ---- 類似物件 (1R/1K 20-40㎡, ${similar.length}件) との比較 ----`);
  console.log(`  類似 平均        : ${Math.round(simAvg/1000)}千円  → 本物件は ${TARGET.rent >= simAvg ? '+' : ''}${simAvg > 0 ? Math.round((TARGET.rent-simAvg)/simAvg*100) : 'N/A'}%`);
  console.log(`  類似 中央値      : ${Math.round(simMedian/1000)}千円  → 本物件は ${diffPct !== 'N/A' ? (parseFloat(diffPct) >= 0 ? '+' : '') + diffPct + '%' : 'N/A'}`);
  console.log(`  類似㎡単価平均   : ${simAvgPpsm.toLocaleString()}円/㎡ → 本物件は ${targetPpsm >= simAvgPpsm ? '+' : ''}${simAvgPpsm > 0 ? Math.round((targetPpsm-simAvgPpsm)/simAvgPpsm*100) : 'N/A'}%`);

  // --- 総合判定 ---
  const dpct = simMedian > 0 ? (TARGET.rent - simMedian) / simMedian * 100 : (TARGET.rent - median) / median * 100;
  let verdict, detail;
  if (dpct <= -15) {
    verdict = '★★★ かなり割安';
    detail = '類似物件の中央値より15%以上安く、非常に競争力がある価格帯。';
  } else if (dpct <= -5) {
    verdict = '★★☆ やや割安';
    detail = '類似物件より安め。立地・設備が良ければコスパ優秀。';
  } else if (dpct <= 5) {
    verdict = '★★☆ ほぼ相場通り';
    detail = '類似物件の中央値とほぼ同水準。妥当な価格帯。';
  } else if (dpct <= 15) {
    verdict = '★☆☆ やや割高';
    detail = '類似物件より若干高め。設備・条件次第で許容範囲。';
  } else {
    verdict = '☆☆☆ 割高';
    detail = '類似物件より高め。競合物件との比較検討を推奨。';
  }

  console.log('\n\n▶ 総合判定');
  console.log('─'.repeat(60));
  console.log(`  ${verdict}`);
  console.log(`  ${detail}`);
  console.log(`\n  類似物件中央値比: ${dpct >= 0 ? '+' : ''}${dpct.toFixed(1)}% (差額${Math.round(Math.abs(TARGET.rent-(simMedian||median))/1000)}千円)`);

  // 類似物件リスト
  if (similar.length > 0) {
    console.log('\n\n▶ 類似物件リスト (1R/1K 20-40㎡, ≤12万円)');
    console.log('─'.repeat(90));
    similar.slice(0, 20).forEach((u, i) => {
      const name = (u.name || '').replace(/^賃貸(マンション|アパート)/, '').substring(0, 20);
      const st = u.station.substring(0, 25);
      const ppsmStr = u.menseki ? `${Math.round(u.rent/u.menseki)}円/㎡` : '';
      console.log(`  [${String(i+1).padStart(2)}] ${name.padEnd(22)} ${(u.madori||'').padEnd(4)} ${(u.menseki?u.menseki+'㎡':'').padEnd(7)} ${Math.round(u.rent/1000)}千円  ${ppsmStr.padEnd(10)} ${st}`);
    });
  }

  return { deduped, avg, median, simAvg, simMedian, verdict, dpct };
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

  console.log('葛西・西葛西 賃貸物件検索開始...\n');

  try {
    // SUUMO: 葛西・西葛西 それぞれ並列に検索
    console.log('[SUUMO] 葛西・西葛西 各駅検索中...');
    const suumoResults = await Promise.all(
      CONFIG.suumoStations.map(s => scrapeSUUMOStation(context, s.name, s.code))
    );
    allResults.suumo = suumoResults.flat();

    // HOMES: 江戸川区全体から取得しフィルタ
    const homesResults = await scrapeHOMES(context);
    allResults.homes = homesResults;

  } finally {
    await browser.close();
  }

  const allFiltered = [...allResults.suumo, ...allResults.homes];
  console.log(`\n取得合計: SUUMO ${allResults.suumo.length}件, HOMES ${allResults.homes.length}件, 合計 ${allFiltered.length}件`);

  // JSON保存
  fs.writeFileSync('/home/user/Claude-code/kasai-results.json',
    JSON.stringify({ suumo: allResults.suumo, homes: allResults.homes }, null, 2));

  // 相場分析
  const analysis = analyzeMarket(allFiltered);

  fs.writeFileSync('/home/user/Claude-code/kasai-analysis.json',
    JSON.stringify(analysis, null, 2));

  console.log('\n結果を kasai-results.json / kasai-analysis.json に保存しました。');

  // ===== DB保存 =====
  const db = initDb();
  const totalRooms = allResults.suumo.reduce((n, p) => n + (p.rooms?.length || 0), 0);
  const sessionId = insertSession(db, {
    search_area:     'kasai+nishikasai',
    search_madori:   '1R,1K,1LDK',
    search_max_rent: CONFIG.maxRentYen,
    source:          'SUUMO',
    result_count:    totalRooms,
  });
  for (const item of allResults.suumo) {
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
  console.log(`[DB保存] kasai+nishikasai: session#${sessionId} (${totalRooms}件)`);
})();
