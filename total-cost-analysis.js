const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');

// ===== フジマンション 補助計算 =====
const TARGET = {
  name: 'フジマンションイーストファイブ 206号室',
  rent: 97000,
  kanri: 0,
  menseki: 30.03,
  madori: '1K',
  station: '葛西駅 徒歩6分',
  shiki: 0,
  rei: 0,
  chukai: 97000 * 1.1,           // 仲介手数料 1.1ヶ月
  shoudoku: 38500,                 // 入居時消毒（必須）
  cleaning: 38500,                 // 退去クリーニング
  hosho_initial: 97000 * 0.4,     // 保証会社 初回40%
  hosho_renewal: 10000,            // 保証会社 更新 1万/年
  koushin_ryou: 97000,             // 更新料 新賃料1ヶ月 / 2年
  hoken: 15000 / 12,              // 火災保険概算 年15,000円
};

// 補助計算（賃料のみ対象、上限5万）
const subsidy_gross = Math.min(TARGET.rent * 0.5, 50000);         // 48,500円
const subsidy_net   = Math.round(subsidy_gross * 0.8);             // 38,800円（課税後）
const net_rent      = TARGET.rent - subsidy_net;                   // 58,200円
const total_gross   = TARGET.rent + TARGET.kanri;                  // 97,000円（市場比較用）
const total_net_base = net_rent + TARGET.kanri;                    // 58,200円

// 月割り固定費
const monthly_hosho_renewal  = Math.round(TARGET.hosho_renewal / 12);    // 833円/月
const monthly_koushin        = Math.round(TARGET.koushin_ryou / 24);     // 4,042円/月
const monthly_hoken          = Math.round(TARGET.hoken);                  // 1,250円/月
const monthly_amort          = monthly_hosho_renewal + monthly_koushin + monthly_hoken; // 約6,125円

const total_net_true = total_net_base + monthly_amort;             // 真の実質月額

// パース関数
function parseRent(s) {
  if (!s && s !== 0) return null;
  if (typeof s === 'number') return s;
  const m = (s+'').match(/([\d.]+)万円/);
  if (m) return Math.round(parseFloat(m[1]) * 10000);
  const m2 = (s+'').match(/([\d,]+)円/);
  if (m2) return parseInt(m2[1].replace(',', ''));
  if ((s+'').match(/^[\d.]+$/)) return parseFloat(s);
  return 0;
}
function parseMenseki(s) {
  if (typeof s === 'number') return s;
  if (!s) return null;
  const m = (s+'').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

// ===== 既存データ読み込み =====
const kasaiRaw    = JSON.parse(fs.readFileSync('/home/user/Claude-code/kasai-results.json'));
const urayasuRaw  = JSON.parse(fs.readFileSync('/home/user/Claude-code/urayasu-comparison.json'));

// kasai-results.json: suumo配列（rooms配列あり）
function expandKasai(items, sourceLabel) {
  const units = [];
  items.forEach(item => {
    (item.rooms || []).forEach(r => {
      const rent  = parseRent(r.rent);
      const kanri = parseRent(r.kanri) || 0;
      const total = rent + kanri;
      const menseki = parseMenseki(r.menseki);
      if (rent && total <= 130000 && rent > 30000) {
        units.push({
          name: item.name, address: item.address,
          station: item.allStation || item.nearest || '',
          ageText: item.ageText || '',
          floor: r.floor, madori: r.madori, menseki,
          rent, kanri, total,
          shiki: r.shiki, rei: r.rei,
          source: sourceLabel,
        });
      }
    });
  });
  return units;
}

// urayasu-comparison.json: stations.{kasai, nishikasai, urayasu}（既にunit展開済み）
function expandUrayasuUnits(units, sourceLabel) {
  return units.map(u => ({
    ...u,
    rent:  parseRent(u.rent)  || 0,
    kanri: parseRent(u.kanri) || 0,
    total: (parseRent(u.rent) || 0) + (parseRent(u.kanri) || 0),
    source: sourceLabel,
  })).filter(u => u.rent > 30000 && u.total <= 130000);
}

// データ統合
const kasaiUnits     = expandKasai(kasaiRaw.suumo.filter(i => (i.allStation||'').includes('葛西') && !(i.allStation||'').includes('西葛西')), '葛西駅');
const nishiUnits     = expandKasai(kasaiRaw.suumo.filter(i => (i.allStation||'').includes('西葛西')), '西葛西駅');
const urayasuUnits   = expandUrayasuUnits(urayasuRaw.stations.urayasu, '浦安駅');

// 重複除去してマージ
function dedup(units) {
  const seen = new Set();
  return units.filter(u => {
    const key = `${u.name}_${u.rent}_${u.kanri}_${u.floor}_${u.madori}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const allUnits = dedup([
  ...expandKasai(kasaiRaw.suumo, 'SUUMO'),
  ...expandUrayasuUnits(urayasuRaw.stations.kasai,     '葛西駅'),
  ...expandUrayasuUnits(urayasuRaw.stations.nishikasai,'西葛西駅'),
  ...expandUrayasuUnits(urayasuRaw.stations.urayasu,   '浦安駅'),
]);

// ===== 統計計算 =====
function stats(units) {
  if (!units.length) return { n:0, avg:0, med:0, q1:0, q3:0, avgPpsm:0 };
  const totals  = units.map(u => u.total).sort((a,b)=>a-b);
  const avg     = Math.round(totals.reduce((s,v)=>s+v,0)/totals.length);
  const med     = totals[Math.floor(totals.length/2)];
  const q1      = totals[Math.floor(totals.length*0.25)];
  const q3      = totals[Math.floor(totals.length*0.75)];
  const ppsmArr = units.filter(u=>u.menseki).map(u=>u.total/u.menseki);
  const avgPpsm = ppsmArr.length ? Math.round(ppsmArr.reduce((s,v)=>s+v,0)/ppsmArr.length) : 0;
  return { n:units.length, avg, med, q1, q3, avgPpsm };
}

// 類似物件フィルタ（1R/1K 20-40㎡）
function isSimilar(u) {
  return ['1K','1R','ワンルーム'].includes(u.madori) && u.menseki && u.menseki >= 20 && u.menseki <= 40;
}

const allSim       = dedup([...allUnits]).filter(isSimilar);
const kasaiSim     = dedup([...kasaiUnits,   ...expandUrayasuUnits(urayasuRaw.stations.kasai,     '葛西駅')]).filter(isSimilar);
const nishiSim     = dedup([...nishiUnits,   ...expandUrayasuUnits(urayasuRaw.stations.nishikasai,'西葛西駅')]).filter(isSimilar);
const urayasuSim   = urayasuUnits.filter(isSimilar);

const stAll        = stats(allUnits);
const stSim        = stats(allSim);
const stKasaiSim   = stats(kasaiSim);
const stNishiSim   = stats(nishiSim);
const stUrayasuSim = stats(urayasuSim);

const targetPpsm = Math.round(total_gross / TARGET.menseki);
const targetNetPpsm = Math.round(total_net_true / TARGET.menseki);

// ===== レポート出力 =====
console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║   葛西・西葛西・浦安 賃貸相場分析（家賃＋管理費 合計コストベース）     ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');

console.log('\n▶ 補助計算（フジマンション 206号室）\n');
console.log('  ┌──────────────────────────────────────────────────┐');
console.log(`  │ 賃料                      ${String(TARGET.rent.toLocaleString()+'円').padStart(12)} │`);
console.log(`  │ 管理費                    ${String(TARGET.kanri.toLocaleString()+'円').padStart(12)} │`);
console.log(`  │ 市場比較用 合計（総額）   ${String(total_gross.toLocaleString()+'円').padStart(12)} │`);
console.log('  ├──────────────────────────────────────────────────┤');
console.log(`  │ 補助額 （賃料×50%）      ${String(subsidy_gross.toLocaleString()+'円').padStart(12)} │`);
console.log(`  │ 補助課税後（×0.8）       ${String(subsidy_net.toLocaleString()+'円').padStart(12)} │`);
console.log(`  │ 賃料ネット                ${String(net_rent.toLocaleString()+'円').padStart(12)} │`);
console.log(`  │ 管理費（補助対象外）      ${String(TARGET.kanri.toLocaleString()+'円').padStart(12)} │`);
console.log(`  │ 基本ネット月額            ${String(total_net_base.toLocaleString()+'円').padStart(12)} │`);
console.log('  ├──────────────────────────────────────────────────┤');
console.log(`  │ 更新料月割 (97千÷24月)   ${String(('+'+monthly_koushin.toLocaleString()+'円').padStart(12))} │`);
console.log(`  │ 保証更新料月割 (1万÷12)  ${String(('+'+monthly_hosho_renewal.toLocaleString()+'円').padStart(12))} │`);
console.log(`  │ 火災保険月割 (1.5万÷12)  ${String(('+'+monthly_hoken.toLocaleString()+'円').padStart(12))} │`);
console.log('  ├──────────────────────────────────────────────────┤');
console.log(`  │ 真の実質月額              ${String(total_net_true.toLocaleString()+'円').padStart(12)} │`);
console.log(`  │ 実質㎡単価 (÷30.03㎡)   ${String(targetNetPpsm.toLocaleString()+'円/㎡').padStart(12)} │`);
console.log('  └──────────────────────────────────────────────────┘');

console.log('\n\n▶ 駅別 相場統計（家賃＋管理費 合計、1R/1K 20-40㎡）\n');
console.log(`${'駅'.padEnd(10)} ${'件数'.padEnd(5)} ${'合計平均'.padEnd(9)} ${'合計中央値'.padEnd(11)} ${'㎡単価平均'}`);
console.log('─'.repeat(55));
for (const [label, s] of [
  ['葛西駅',   stKasaiSim],
  ['西葛西駅', stNishiSim],
  ['浦安駅',   stUrayasuSim],
  ['3駅合計',  stSim],
]) {
  console.log(`${label.padEnd(10)} ${String(s.n+'件').padEnd(5)} ${(Math.round(s.avg/1000)+'千円').padEnd(9)} ${(Math.round(s.med/1000)+'千円').padEnd(11)} ${s.avgPpsm.toLocaleString()}円/㎡`);
}

console.log('\n\n▶ フジマンション 206号室 の相場評価（合計コストベース）\n');
console.log('  ─── 市場（家賃＋管理費 合計）と 本物件グロス（97千円）の比較 ───\n');
const vsAllAvg  = ((total_gross - stSim.avg)  / stSim.avg  * 100).toFixed(1);
const vsAllMed  = ((total_gross - stSim.med)  / stSim.med  * 100).toFixed(1);
const vsPpsm    = ((targetPpsm - stSim.avgPpsm) / stSim.avgPpsm * 100).toFixed(1);
console.log(`  市場 合計平均       ${Math.round(stSim.avg/1000)}千円  → 本物件グロス ${parseFloat(vsAllAvg)>=0?'+':''}${vsAllAvg}%`);
console.log(`  市場 合計中央値     ${Math.round(stSim.med/1000)}千円  → 本物件グロス ${parseFloat(vsAllMed)>=0?'+':''}${vsAllMed}%`);
console.log(`  市場 ㎡単価平均     ${stSim.avgPpsm.toLocaleString()}円/㎡ → 本物件グロス ${parseFloat(vsPpsm)>=0?'+':''}${vsPpsm}%`);

console.log('\n  ─── 市場（家賃＋管理費 合計）と 本物件ネット（実質月額）の比較 ───\n');
const vsNetAvg  = ((total_net_true - stSim.avg)  / stSim.avg  * 100).toFixed(1);
const vsNetMed  = ((total_net_true - stSim.med)  / stSim.med  * 100).toFixed(1);
const vsNetPpsm = ((targetNetPpsm - stSim.avgPpsm) / stSim.avgPpsm * 100).toFixed(1);
console.log(`  市場 合計平均       ${Math.round(stSim.avg/1000)}千円  → 本物件ネット ${parseFloat(vsNetAvg)>=0?'+':''}${vsNetAvg}%`);
console.log(`  市場 合計中央値     ${Math.round(stSim.med/1000)}千円  → 本物件ネット ${parseFloat(vsNetMed)>=0?'+':''}${vsNetMed}%`);
console.log(`  市場 ㎡単価平均     ${stSim.avgPpsm.toLocaleString()}円/㎡ → 本物件ネット ${parseFloat(vsNetPpsm)>=0?'+':''}${vsNetPpsm}%`);

// 判定
const dpct = parseFloat(vsAllMed);
const dpctNet = parseFloat(vsNetMed);
let grossVerdict, netVerdict;

if (dpct <= -10) grossVerdict = '★★★ かなり割安';
else if (dpct <= -3) grossVerdict = '★★☆ やや割安';
else if (dpct <= 5)  grossVerdict = '★★☆ ほぼ相場通り';
else if (dpct <= 12) grossVerdict = '★☆☆ やや割高';
else grossVerdict = '☆☆☆ 割高';

if (dpctNet <= -30)   netVerdict = '★★★ 圧倒的に割安';
else if (dpctNet <= -20) netVerdict = '★★★ 大幅割安';
else if (dpctNet <= -10) netVerdict = '★★☆ 割安';
else if (dpctNet <= 0)   netVerdict = '★★☆ ほぼ相場通り以下';
else netVerdict = '★☆☆ 相場以上だが補助で吸収';

console.log('\n\n▶ 総合判定\n');
console.log(`  グロス（補助なし） : ${grossVerdict}`);
console.log(`    → 合計中央値比 ${parseFloat(vsAllMed)>=0?'+':''}${vsAllMed}% / ㎡単価比 ${parseFloat(vsPpsm)>=0?'+':''}${vsPpsm}%`);
console.log(`\n  ネット（補助込み） : ${netVerdict}`);
console.log(`    → 実質${total_net_true.toLocaleString()}円 / 合計中央値${Math.round(stSim.med/1000)}千円比 ${parseFloat(vsNetMed)>=0?'+':''}${vsNetMed}%`);
console.log(`    → 実質㎡単価 ${targetNetPpsm.toLocaleString()}円/㎡ vs 市場${stSim.avgPpsm.toLocaleString()}円/㎡`);

// 合計コストTop20 類似物件
console.log('\n\n▶ 類似物件リスト（1R/1K 20-40㎡, 合計コスト昇順, 上位20件）\n');
const sortedSim = [...allSim].sort((a,b)=>a.total-b.total);
console.log(`${'物件名'.padEnd(22)} ${'間取'.padEnd(5)} ${'面積'.padEnd(7)} ${'家賃'.padEnd(7)} ${'管理費'.padEnd(6)} ${'合計'.padEnd(7)} ${'㎡単価'.padEnd(8)} ${'最寄駅'}`);
console.log('─'.repeat(100));
sortedSim.slice(0,20).forEach((u,i) => {
  const name = (u.name||'').replace(/^賃貸(マンション|アパート)/,'').substring(0,20);
  const st   = u.station.substring(0,22);
  const ppsm = u.menseki ? Math.round(u.total/u.menseki) : 0;
  console.log(
    `${String(i+1).padEnd(3)}${name.padEnd(22)} ${(u.madori||'').padEnd(5)} ${(u.menseki?u.menseki+'㎡':'').padEnd(7)} ` +
    `${Math.round(u.rent/1000)+'千'.padEnd(7)} ${(u.kanri>0?Math.round(u.kanri/1000)+'千':'-').padEnd(6)} ` +
    `${Math.round(u.total/1000)+'千'.padEnd(7)} ${(ppsm+'円/㎡').padEnd(8)} ${st}`
  );
});

// フジマンションの位置
console.log('\n  ▶ 参考: フジマンション 206号室');
console.log(`     グロス: 97千 + 0 = 97千円 / ㎡単価${targetPpsm}円/㎡（上位${sortedSim.filter(u=>u.total<total_gross).length+1}位/${allSim.length}件）`);
console.log(`     ネット: 実質${total_net_true.toLocaleString()}円 / ㎡単価${targetNetPpsm}円/㎡（市場の類似物件全てより安い）`);

// 「合計97千円以下」でフジマンションより安い物件
const cheaper = sortedSim.filter(u => u.total < total_gross);
console.log(`\n  フジマンション（グロス97千円）より合計コストが安い類似物件: ${cheaper.length}件 / ${allSim.length}件中`);
if (cheaper.length > 0) {
  console.log('  → これらは面積・設備・構造・立地で劣る可能性が高い:');
  cheaper.slice(0,8).forEach(u => {
    const name = (u.name||'').replace(/^賃貸(マンション|アパート)/,'').substring(0,18);
    const st = u.station.substring(0,20);
    console.log(`     ${name.padEnd(20)} 合計${Math.round(u.total/1000)}千円 ${(u.menseki||'-')+'㎡'} ${u.madori} ${st}`);
  });
}
