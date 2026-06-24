const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const { initDb, upsertProperty, insertSession, insertRooms } = require('./db');

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

async function scrapeStation(context, label, stationUrl) {
  const page = await context.newPage();
  const items = [];
  try {
    await page.goto(stationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.check('#md0').catch(() => {});
    await page.check('#md1').catch(() => {});
    await page.check('#md3').catch(() => {});
    await page.selectOption('select[name="ct"]', '12.0').catch(() => {});
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
      page.evaluate(() => { const f = document.getElementById('js-searchPanel'); if (f) f.submit(); })
    ]);

    let pageNum = 1;
    while (pageNum <= 5) {
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
      console.log(`  [SUUMO ${label}] p${pageNum}: ${pageItems.length}件`);

      const nextBtn = await page.$('.pagination_set-nav li:last-child a');
      const nextText = await nextBtn?.textContent().catch(() => '');
      if (nextBtn && nextText && !nextText.includes('前') && pageNum < 5) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
          nextBtn.click()
        ]).catch(() => {});
        await page.waitForTimeout(1200);
        pageNum++;
      } else break;
    }
  } catch (e) {
    console.error(`[${label}] エラー:`, e.message);
  } finally {
    await page.close();
  }
  return items.map(i => ({ ...i, source: label }));
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'ja-JP', viewport: { width: 1280, height: 800 },
  });

  console.log('葛西・西葛西・浦安 比較検索開始...\n');

  const [kasai, nishikasai, urayasu] = await Promise.all([
    scrapeStation(context, '葛西駅',   'https://suumo.jp/chintai/tokyo/ek_07760/'),
    scrapeStation(context, '西葛西駅', 'https://suumo.jp/chintai/tokyo/ek_28520/'),
    scrapeStation(context, '浦安駅',   'https://suumo.jp/chintai/chiba/ek_04690/'),
  ]);

  await browser.close();

  console.log(`\n取得: 葛西${kasai.length}件, 西葛西${nishikasai.length}件, 浦安${urayasu.length}件`);

  // ユニット展開
  function toUnits(items) {
    const units = [];
    items.forEach(item => {
      item.rooms.forEach(r => {
        const rent = parseRent(r.rent);
        const menseki = parseMenseki(r.menseki);
        if (rent && rent <= 120000 && rent > 30000) {
          units.push({
            name: item.name,
            address: item.address,
            station: item.allStation || item.nearest || '',
            ageText: item.ageText || '',
            floor: r.floor,
            madori: r.madori,
            menseki,
            rent,
            kanri: parseRent(r.kanri) || 0,
            shiki: r.shiki,
            rei: r.rei,
            source: item.source,
          });
        }
      });
    });
    // 重複除去
    const seen = new Set();
    return units.filter(u => {
      const key = `${u.name}_${u.rent}_${u.floor}_${u.madori}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const kasaiUnits     = toUnits(kasai);
  const nishiUnits     = toUnits(nishikasai);
  const urayasuUnits   = toUnits(urayasu);
  const allKasaiUnits  = toUnits([...kasai, ...nishikasai]);
  const allUnits       = toUnits([...kasai, ...nishikasai, ...urayasu]);

  function stats(units) {
    const rents = units.map(u => u.rent).sort((a,b)=>a-b);
    const avg = rents.length ? Math.round(rents.reduce((s,r)=>s+r,0)/rents.length) : 0;
    const med = rents.length ? rents[Math.floor(rents.length/2)] : 0;
    const q1  = rents.length ? rents[Math.floor(rents.length*0.25)] : 0;
    const q3  = rents.length ? rents[Math.floor(rents.length*0.75)] : 0;
    const ppsm = units.filter(u=>u.menseki).map(u=>u.rent/u.menseki);
    const avgPpsm = ppsm.length ? Math.round(ppsm.reduce((s,v)=>s+v,0)/ppsm.length) : 0;

    // 類似 (1R/1K, 20-40㎡)
    const sim = units.filter(u =>
      (u.madori==='1K'||u.madori==='1R'||u.madori==='ワンルーム') && u.menseki && u.menseki>=20 && u.menseki<=40
    );
    const simRents = sim.map(u=>u.rent).sort((a,b)=>a-b);
    const simAvg = simRents.length ? Math.round(simRents.reduce((s,r)=>s+r,0)/simRents.length) : 0;
    const simMed = simRents.length ? simRents[Math.floor(simRents.length/2)] : 0;
    const simPpsm = sim.filter(u=>u.menseki).map(u=>u.rent/u.menseki);
    const simAvgPpsm = simPpsm.length ? Math.round(simPpsm.reduce((s,v)=>s+v,0)/simPpsm.length) : 0;
    return { n: rents.length, avg, med, q1, q3, avgPpsm, simN: sim.length, simAvg, simMed, simAvgPpsm };
  }

  const sKasai    = stats(kasaiUnits);
  const sNishi    = stats(nishiUnits);
  const sUrayasu  = stats(urayasuUnits);
  const sBefore   = stats(allKasaiUnits);
  const sAfter    = stats(allUnits);

  const TARGET = { rent: 97000, menseki: 30.03, madori: '1K', station: '葛西駅6分' };
  const tPpsm = Math.round(TARGET.rent / TARGET.menseki);

  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║        葛西・西葛西・浦安 1R/1K/1LDK 12万円以下 相場比較            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  console.log('\n▶ 駅別統計サマリー（全間取り）\n');
  console.log(`${'駅'.padEnd(10)} ${'件数'.padEnd(5)} ${'平均'.padEnd(8)} ${'中央値'.padEnd(8)} ${'Q1'.padEnd(8)} ${'Q3'.padEnd(8)} ${'㎡単価平均'}`);
  console.log('─'.repeat(65));
  for (const [label, s] of [['葛西駅', sKasai], ['西葛西駅', sNishi], ['浦安駅', sUrayasu]]) {
    console.log(`${label.padEnd(10)} ${String(s.n).padEnd(5)} ${String(Math.round(s.avg/1000))+'千円'.padEnd(8)} ${String(Math.round(s.med/1000))+'千円'.padEnd(8)} ${String(Math.round(s.q1/1000))+'千円'.padEnd(8)} ${String(Math.round(s.q3/1000))+'千円'.padEnd(8)} ${s.avgPpsm.toLocaleString()}円/㎡`);
  }

  console.log('\n▶ 類似物件（1R/1K 20-40㎡）の駅別統計\n');
  console.log(`${'駅'.padEnd(10)} ${'件数'.padEnd(5)} ${'平均'.padEnd(8)} ${'中央値'.padEnd(8)} ${'㎡単価平均'}`);
  console.log('─'.repeat(50));
  for (const [label, s] of [['葛西駅', sKasai], ['西葛西駅', sNishi], ['浦安駅', sUrayasu]]) {
    console.log(`${label.padEnd(10)} ${String(s.simN).padEnd(5)} ${String(Math.round(s.simAvg/1000))+'千円'.padEnd(8)} ${String(Math.round(s.simMed/1000))+'千円'.padEnd(8)} ${s.simAvgPpsm.toLocaleString()}円/㎡`);
  }

  console.log('\n▶ 浦安追加前後の相場変化\n');
  const cols = ['', '葛西+西葛西のみ', '+ 浦安追加後', '変化'];
  console.log(cols.map(c => c.padEnd(22)).join(''));
  console.log('─'.repeat(70));
  const rows = [
    ['全物件数', `${sBefore.n}件`, `${sAfter.n}件`, `+${sAfter.n - sBefore.n}件`],
    ['全体 平均', `${Math.round(sBefore.avg/1000)}千円`, `${Math.round(sAfter.avg/1000)}千円`, `${Math.round((sAfter.avg-sBefore.avg)/1000) >= 0 ? '+' : ''}${Math.round((sAfter.avg-sBefore.avg)/1000)}千円`],
    ['全体 中央値', `${Math.round(sBefore.med/1000)}千円`, `${Math.round(sAfter.med/1000)}千円`, `${Math.round((sAfter.med-sBefore.med)/1000) >= 0 ? '+' : ''}${Math.round((sAfter.med-sBefore.med)/1000)}千円`],
    ['類似 件数', `${sBefore.simN}件`, `${sAfter.simN}件`, `+${sAfter.simN - sBefore.simN}件`],
    ['類似 平均', `${Math.round(sBefore.simAvg/1000)}千円`, `${Math.round(sAfter.simAvg/1000)}千円`, `${Math.round((sAfter.simAvg-sBefore.simAvg)/1000) >= 0 ? '+' : ''}${Math.round((sAfter.simAvg-sBefore.simAvg)/1000)}千円`],
    ['類似 中央値', `${Math.round(sBefore.simMed/1000)}千円`, `${Math.round(sAfter.simMed/1000)}千円`, `${Math.round((sAfter.simMed-sBefore.simMed)/1000) >= 0 ? '+' : ''}${Math.round((sAfter.simMed-sBefore.simMed)/1000)}千円`],
    ['類似㎡単価平均', `${sBefore.simAvgPpsm.toLocaleString()}円/㎡`, `${sAfter.simAvgPpsm.toLocaleString()}円/㎡`, `${sAfter.simAvgPpsm - sBefore.simAvgPpsm >= 0 ? '+' : ''}${sAfter.simAvgPpsm - sBefore.simAvgPpsm}円`],
  ];
  rows.forEach(r => console.log(r.map((c,i) => c.padEnd(i===0?16:22)).join('')));

  console.log('\n▶ フジマンション 206号室 の相場位置（浦安追加後）\n');
  const dpctBefore = ((TARGET.rent - sBefore.simMed) / sBefore.simMed * 100).toFixed(1);
  const dpctAfter  = ((TARGET.rent - sAfter.simMed)  / sAfter.simMed  * 100).toFixed(1);
  const ppsmDiffBefore = ((tPpsm - sBefore.simAvgPpsm) / sBefore.simAvgPpsm * 100).toFixed(1);
  const ppsmDiffAfter  = ((tPpsm - sAfter.simAvgPpsm)  / sAfter.simAvgPpsm  * 100).toFixed(1);

  console.log(`  本物件 家賃      : 97,000円 / ㎡単価 ${tPpsm.toLocaleString()}円/㎡`);
  console.log(`\n  追加前（葛西+西葛西）: 類似中央値${Math.round(sBefore.simMed/1000)}千円 → 本物件 ${parseFloat(dpctBefore)>=0?'+':''}${dpctBefore}%`);
  console.log(`  追加後（+浦安）     : 類似中央値${Math.round(sAfter.simMed/1000)}千円 → 本物件 ${parseFloat(dpctAfter)>=0?'+':''}${dpctAfter}%`);
  console.log(`  ㎡単価 追加前       : 市場平均${sBefore.simAvgPpsm.toLocaleString()}円/㎡ → 本物件 ${parseFloat(ppsmDiffBefore)>=0?'+':''}${ppsmDiffBefore}%`);
  console.log(`  ㎡単価 追加後       : 市場平均${sAfter.simAvgPpsm.toLocaleString()}円/㎡ → 本物件 ${parseFloat(ppsmDiffAfter)>=0?'+':''}${ppsmDiffAfter}%`);

  // 浦安の類似物件リスト
  const uSim = urayasuUnits.filter(u =>
    (u.madori==='1K'||u.madori==='1R'||u.madori==='ワンルーム') && u.menseki && u.menseki>=20 && u.menseki<=40
  ).sort((a,b) => a.rent - b.rent);

  console.log(`\n▶ 浦安駅 類似物件リスト（1R/1K 20-40㎡, ${uSim.length}件）\n`);
  console.log(`${'物件名'.padEnd(24)} ${'間取'.padEnd(5)} ${'面積'.padEnd(7)} ${'家賃'.padEnd(8)} ${'㎡単価'.padEnd(10)} ${'最寄駅'}`);
  console.log('─'.repeat(80));
  uSim.slice(0, 15).forEach(u => {
    const name = (u.name || '').replace(/^賃貸(マンション|アパート)/, '').substring(0, 22);
    const st   = u.station.substring(0, 22);
    const ppsm = u.menseki ? Math.round(u.rent / u.menseki) : 0;
    console.log(`${name.padEnd(24)} ${(u.madori||'').padEnd(5)} ${(u.menseki?u.menseki+'㎡':'').padEnd(7)} ${Math.round(u.rent/1000)+'千円'.padEnd(8)} ${(ppsm+'円/㎡').padEnd(10)} ${st}`);
  });

  fs.writeFileSync('/home/user/Claude-code/urayasu-comparison.json', JSON.stringify({
    stations: { kasai: kasaiUnits, nishikasai: nishiUnits, urayasu: urayasuUnits },
    stats: { kasai: sKasai, nishikasai: sNishi, urayasu: sAfter }
  }, null, 2));
  console.log('\n結果を urayasu-comparison.json に保存しました。');

  // ===== DB保存 =====
  const db = initDb();
  const stationData = [
    { key: 'kasai',      label: '葛西駅',   items: kasai      },
    { key: 'nishikasai', label: '西葛西駅', items: nishikasai },
    { key: 'urayasu',    label: '浦安駅',   items: urayasu    },
  ];
  for (const { key, label, items } of stationData) {
    const totalRooms = items.reduce((n, p) => n + (p.rooms?.length || 0), 0);
    const sessionId = insertSession(db, {
      search_area:     key,
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
    console.log(`[DB保存] ${label}: session#${sessionId}`);
  }
  db.close();
  console.log('DBへの保存完了。');
})();
