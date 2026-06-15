/**
 * フジマンションイーストファイブ 206号室 再評価
 * DB全データ（9駅）を使用、家賃＋管理費 合計コストベース
 */
const { openDb } = require('./db');
process.env.NODE_NO_WARNINGS = '1';

// ===== 対象物件 =====
const TARGET = {
  name:       'フジマンションイーストファイブ 206号室',
  station:    '葛西駅 徒歩6分',
  rent:       97000,
  kanri:      0,
  menseki:    30.03,
  madori:     '1K',
  structure:  'SRC',
  buildYear:  2007,
  floors:     5,
  // 初期費用
  shiki: 0, rei: 0,
  chukai:         97000 * 1.1,   // 仲介1.1ヶ月
  shodoku:        38500,          // 消毒
  hosho_initial:  97000 * 0.4,   // 保証会社初回40%
  hosho_renewal:  10000,          // 保証更新/年
  koushin_ryou:   97000,          // 更新料/2年（1ヶ月）
  hoken:          15000 / 12,     // 火災保険月割
};

// ===== 補助計算 =====
const subsidy_gross  = Math.min(TARGET.rent * 0.5, 50000);   // 48,500円
const subsidy_net    = Math.round(subsidy_gross * 0.8);       // 38,800円（課税後）
const net_rent       = TARGET.rent - subsidy_net;             // 58,200円
const total_gross    = TARGET.rent + TARGET.kanri;            // 97,000円
const total_net_base = net_rent + TARGET.kanri;               // 58,200円

const monthly_hosho_renewal = Math.round(TARGET.hosho_renewal / 12);
const monthly_koushin       = Math.round(TARGET.koushin_ryou / 24);
const monthly_hoken         = Math.round(TARGET.hoken);
const monthly_amort         = monthly_hosho_renewal + monthly_koushin + monthly_hoken;
const total_net_true        = total_net_base + monthly_amort;  // 64,325円
const net_ppsm              = Math.round(total_net_true / TARGET.menseki);

// ===== DB クエリ =====
const db = openDb();

// 全部屋（重複除去・最新スナップショット）
const allRooms = db.prepare(`
  SELECT
    p.name, p.address, p.nearest_station, p.walk_min,
    p.build_year, p.total_floors, p.structure,
    r.floor, r.madori, r.menseki,
    r.rent, r.kanri,
    (r.rent + COALESCE(r.kanri, 0)) AS total_cost,
    r.shiki, r.rei,
    MAX(s.scraped_at) AS scraped_at,
    s.search_area
  FROM room_snapshots r
  JOIN properties p ON r.property_id = p.id
  JOIN scrape_sessions s ON r.session_id = s.id
  GROUP BY r.property_id, r.floor, r.madori, r.menseki
  ORDER BY total_cost ASC
`).all();

// 1R/1K 20-40㎡ の類似物件
const similar = allRooms.filter(r =>
  ['1K','1R','ワンルーム'].includes(r.madori) &&
  r.menseki >= 20 && r.menseki <= 40
);

// ===== 統計計算 =====
function stats(rows) {
  const totals = rows.map(r => r.total_cost).sort((a, b) => a - b);
  if (!totals.length) return null;
  const n      = totals.length;
  const avg    = Math.round(totals.reduce((s, v) => s + v, 0) / n);
  const median = totals[Math.floor(n / 2)];
  const q1     = totals[Math.floor(n * 0.25)];
  const q3     = totals[Math.floor(n * 0.75)];
  const ppsmArr = rows.filter(r => r.menseki).map(r => r.total_cost / r.menseki);
  const avgPpsm = ppsmArr.length ? Math.round(ppsmArr.reduce((s, v) => s + v, 0) / ppsmArr.length) : 0;
  return { n, avg, median, q1, q3, avgPpsm };
}

// 駅グループ定義
const STATION_GROUPS = [
  { key: 'kasai',          label: '葛西駅',    pref: '東京' },
  { key: 'nishikasai',     label: '西葛西駅',  pref: '東京' },
  { key: 'kiba',           label: '木場駅',    pref: '東京' },
  { key: 'monzen',         label: '門前仲町駅', pref: '東京' },
  { key: 'minamisunacho',  label: '南砂町駅',  pref: '東京' },
  { key: 'urayasu',        label: '浦安駅',    pref: '千葉' },
  { key: 'myoden',         label: '妙典駅',    pref: '千葉' },
  { key: 'gyotoku',        label: '行徳駅',    pref: '千葉' },
  { key: 'minamigyotoku',  label: '南行徳駅',  pref: '千葉' },
];

// 駅別に最新セッション部屋を取得
function getRoomsForArea(area) {
  return db.prepare(`
    SELECT r.madori, r.menseki,
           r.rent, r.kanri,
           (r.rent + COALESCE(r.kanri,0)) AS total_cost,
           p.walk_min, p.build_year, p.nearest_station
    FROM room_snapshots r
    JOIN properties p ON r.property_id = p.id
    JOIN scrape_sessions s ON r.session_id = s.id
    WHERE s.search_area = ?
      AND s.scraped_at = (SELECT MAX(scraped_at) FROM scrape_sessions WHERE search_area = ?)
  `).all(area, area);
}

const stationStats = STATION_GROUPS.map(g => {
  const rooms = getRoomsForArea(g.key);
  const simRooms = rooms.filter(r =>
    ['1K','1R','ワンルーム'].includes(r.madori) && r.menseki >= 20 && r.menseki <= 40
  );
  return { ...g, all: stats(rooms), sim: stats(simRooms) };
});

const globalSim = stats(similar);

// ===== 出力 =====
const W = 70;
const line = '─'.repeat(W);

console.log('\n╔' + '═'.repeat(W - 2) + '╗');
console.log('║   フジマンションイーストファイブ 206号室  総合再評価（9駅DBベース）' + '  ║');
console.log('╚' + '═'.repeat(W - 2) + '╝');

// --- 補助計算 ---
console.log('\n▶ 補助計算');
console.log(line);
console.log(`  家賃               : ${TARGET.rent.toLocaleString()}円`);
console.log(`  管理費             : ${TARGET.kanri.toLocaleString()}円`);
console.log(`  市場比較用 合計    : ${total_gross.toLocaleString()}円`);
console.log(`  補助額（賃料×50%）: ${subsidy_gross.toLocaleString()}円`);
console.log(`  補助課税後（×0.8）: ${subsidy_net.toLocaleString()}円`);
console.log(`  更新料月割 (÷24)  : +${monthly_koushin.toLocaleString()}円`);
console.log(`  保証更新月割 (÷12): +${monthly_hosho_renewal.toLocaleString()}円`);
console.log(`  火災保険月割 (÷12): +${monthly_hoken.toLocaleString()}円`);
console.log(`  ─────────────────────────────────`);
console.log(`  実質月額           : ${total_net_true.toLocaleString()}円`);
console.log(`  実質㎡単価         : ${net_ppsm.toLocaleString()}円/㎡`);

// --- 駅別統計（類似物件: 1R/1K 20-40㎡）---
console.log('\n▶ 駅別相場統計（1R/1K 20-40㎡, 家賃＋管理費 合計コスト）');
console.log(line);
console.log(`${'駅'.padEnd(12)} ${'都県'.padEnd(5)} ${'件数'.padEnd(5)} ${'平均'.padEnd(8)} ${'中央値'.padEnd(8)} ${'㎡単価'.padEnd(10)} ${'vs グロス97千'}`);
console.log(line);

for (const g of stationStats) {
  const s = g.sim;
  if (!s) { console.log(`${g.label.padEnd(12)} ${g.pref.padEnd(5)} ${'0件'.padEnd(5)}`); continue; }
  const diff = ((total_gross - s.median) / s.median * 100).toFixed(1);
  const sign = parseFloat(diff) >= 0 ? '+' : '';
  console.log(
    `${g.label.padEnd(12)} ${g.pref.padEnd(5)} ${String(s.n).padEnd(5)} ` +
    `${Math.round(s.avg / 1000) + '千'.padEnd(8)} ` +
    `${Math.round(s.median / 1000) + '千'.padEnd(8)} ` +
    `${(s.avgPpsm.toLocaleString() + '円/㎡').padEnd(10)} ` +
    `${sign}${diff}%`
  );
}
console.log(line);
const gs = globalSim;
const gDiff = ((total_gross - gs.median) / gs.median * 100).toFixed(1);
console.log(
  `${'【9駅合計】'.padEnd(12)} ${''.padEnd(5)} ${String(gs.n).padEnd(5)} ` +
  `${Math.round(gs.avg / 1000) + '千'.padEnd(8)} ` +
  `${Math.round(gs.median / 1000) + '千'.padEnd(8)} ` +
  `${(gs.avgPpsm.toLocaleString() + '円/㎡').padEnd(10)} ` +
  `${parseFloat(gDiff) >= 0 ? '+' : ''}${gDiff}%（グロス）/ ` +
  `${(((total_net_true - gs.median) / gs.median * 100)).toFixed(1)}%（ネット）`
);

// --- グロス vs ネット評価 ---
console.log('\n▶ フジマンション 相場ポジション');
console.log(line);
const belowGross = similar.filter(r => r.total_cost < total_gross).length;
const belowNet   = similar.filter(r => r.total_cost < total_net_true).length;
console.log(`  類似物件 合計                 : ${similar.length}件`);
console.log(`  グロス(97千円)より安い物件数  : ${belowGross}件 / ${similar.length}件 (${(belowGross/similar.length*100).toFixed(0)}%)`);
console.log(`  ネット(64千円)より安い物件数  : ${belowNet}件 / ${similar.length}件 (${(belowNet/similar.length*100).toFixed(0)}%)`);
console.log(`  9駅合計中央値                 : ${Math.round(gs.median/1000)}千円`);
console.log(`  グロス vs 中央値              : ${parseFloat(gDiff)>=0?'+':''}${gDiff}%`);
console.log(`  ネット vs 中央値              : ${(((total_net_true-gs.median)/gs.median*100)).toFixed(1)}%`);
console.log(`  ネット㎡単価 vs 市場          : ${(((net_ppsm - gs.avgPpsm)/gs.avgPpsm*100)).toFixed(1)}% (${net_ppsm}円/㎡ vs ${gs.avgPpsm}円/㎡)`);

// --- 類似物件リスト（上位25件）---
console.log('\n▶ 類似物件リスト（1R/1K 20-40㎡, 合計コスト昇順, 上位25件）');
console.log(line);
console.log(`${'No'.padEnd(3)} ${'物件名'.padEnd(22)} ${'間取'.padEnd(5)} ${'㎡'.padEnd(6)} ${'家賃'.padEnd(6)} ${'管'.padEnd(5)} ${'合計'.padEnd(7)} ${'最寄駅'}`);
console.log(line);

// 重複除去済みの類似物件
const seen = new Set();
const dedupSim = [];
for (const r of similar) {
  const key = `${r.name}_${r.floor}_${r.madori}_${r.menseki}_${r.rent}`;
  if (!seen.has(key)) { seen.add(key); dedupSim.push(r); }
}

dedupSim.slice(0, 25).forEach((r, i) => {
  const name   = (r.name || '').substring(0, 20);
  const st     = (r.nearest_station || '').substring(0, 22);
  const total  = r.total_cost;
  const marker = total < total_net_true ? '  ' : total < total_gross ? '△ ' : '  ';
  console.log(
    `${marker}${String(i+1).padEnd(3)} ${name.padEnd(22)} ${(r.madori||'').padEnd(5)} ` +
    `${(r.menseki ? r.menseki + '㎡' : '-').padEnd(6)} ` +
    `${Math.round(r.rent/1000)+'千'.padEnd(6)} ` +
    `${(r.kanri ? Math.round(r.kanri/1000)+'千' : '0  ').padEnd(5)} ` +
    `${Math.round(total/1000)+'千'.padEnd(7)} ` +
    `${st}`
  );
});

console.log(`\n  △ = グロス97千円以下かつネット64千円超の物件`);
console.log(`  ▶ フジマンション: グロス97千円 / ネット64千円`);

// --- 総合判定 ---
console.log('\n▶ 総合判定');
console.log(line);
console.log(`
  補助なし（グロス 97,000円 ＋ 管理費 0円 = 97,000円）
  ─ 9駅合計中央値比: ${parseFloat(gDiff)>=0?'+':''}${gDiff}%
  ─ ${belowGross}/${similar.length}件（${(belowGross/similar.length*100).toFixed(0)}%）の類似物件がこれより安い
  ─ 判定: ★★☆  相場より若干高め（都内3駅が比較対象に加わったため）

  補助あり（ネット 実質 ${total_net_true.toLocaleString()}円 / ㎡単価 ${net_ppsm.toLocaleString()}円/㎡）
  ─ 9駅合計中央値比: ${(((total_net_true-gs.median)/gs.median*100)).toFixed(1)}%
  ─ ${belowNet}/${similar.length}件（${(belowNet/similar.length*100).toFixed(0)}%）の類似物件がこれより安い
  ─ 判定: ★★★  圧倒的割安（補助が継続する限り）
`);

db.close();
