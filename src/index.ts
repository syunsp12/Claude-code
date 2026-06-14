import { scrapeProperties } from './scraper';
import { CURRENT_PROPERTY } from './types';

function fmt(n: number): string {
  return n.toLocaleString('ja-JP');
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str.padEnd(len);
  return str.slice(0, len - 1) + '…';
}

async function main() {
  console.log('');
  console.log('='.repeat(100));
  console.log('  SUUMO 東京メトロ東西線 賃貸物件調査');
  console.log('  条件: 1K/1R, 家賃10万円以下, 築10年以内');
  console.log('='.repeat(100));
  console.log('');
  console.log('【比較基準: 現在の申込物件】');
  console.log(`  ${CURRENT_PROPERTY.name}`);
  console.log(`  賃料 ${fmt(CURRENT_PROPERTY.rent)}円 / 管理費 ${fmt(CURRENT_PROPERTY.management)}円`);
  console.log(`  ${CURRENT_PROPERTY.area}㎡  ${CURRENT_PROPERTY.builtYear} (築19年)`);
  console.log(`  実質月額 ${fmt(CURRENT_PROPERTY.effectiveCost)}円  実質¥/㎡ ${fmt(CURRENT_PROPERTY.effectiveCostPerSqm)}円`);
  console.log('');

  let properties;
  try {
    properties = await scrapeProperties();
  } catch (err) {
    console.error('スクレイピングに失敗しました:', err);
    process.exit(1);
  }

  if (properties.length === 0) {
    console.log('条件に合う物件が見つかりませんでした。');
    return;
  }

  console.log(`取得件数: ${properties.length} 件  (実質月額の安い順、¥/㎡が比較基準より有利な物件は★表示)`);
  console.log('');

  const SEP = '─'.repeat(115);
  const HEADER = [
    truncate('物件名', 22),
    truncate('住所', 16),
    truncate('最寄り駅', 18),
    '間',
    truncate('㎡', 6),
    truncate('賃料', 8),
    truncate('管理費', 6),
    truncate('敷/礼', 9),
    truncate('築年', 6),
    truncate('実質月額', 9),
    '¥/㎡',
  ].join('│');

  console.log(SEP);
  console.log(HEADER);
  console.log(SEP);

  for (const p of properties) {
    const station = (p.stations[0] ?? '').replace('東京メトロ東西線/', '');
    const isCheaperCost = p.effectiveCost <= CURRENT_PROPERTY.effectiveCost;
    const isBetterPerSqm = p.effectiveCostPerSqm < CURRENT_PROPERTY.effectiveCostPerSqm;
    const marker = isCheaperCost && isBetterPerSqm ? '★' : isCheaperCost ? '↓' : '';

    const depositLabel = `${p.deposit}/${p.keyMoney}`;

    const row = [
      truncate(p.name, 22),
      truncate(p.address.replace('東京都', ''), 16),
      truncate(station, 18),
      p.layout.padEnd(1),
      truncate(p.area > 0 ? `${p.area}` : '-', 6),
      truncate(`${fmt(p.rent)}`, 8),
      truncate(p.management > 0 ? `${fmt(p.management)}` : '-', 6),
      truncate(depositLabel, 9),
      truncate(p.builtYear, 6),
      truncate(`${fmt(p.effectiveCost)}`, 9),
      p.effectiveCostPerSqm > 0 ? fmt(p.effectiveCostPerSqm) : '-',
    ].join('│');

    console.log(`${row}  ${marker}`);
  }

  console.log(SEP);
  console.log('★: 実質月額・¥/㎡ともに比較基準より有利  ↓: 実質月額のみ有利');
  console.log('');
  console.log('【実質月額 = 0.6×賃料 + 管理費】（家賃補助50%・課税20%計算済み）');
  console.log('');

  // Better than current
  const better = properties.filter(
    (p) => p.effectiveCost <= CURRENT_PROPERTY.effectiveCost && p.effectiveCostPerSqm < CURRENT_PROPERTY.effectiveCostPerSqm
  );

  if (better.length > 0) {
    console.log(`━━━ 比較基準より有利な物件: ${better.length} 件 ━━━`);
    for (const p of better) {
      const station = (p.stations[0] ?? '').replace('東京メトロ東西線/', '');
      const diffCost = CURRENT_PROPERTY.effectiveCost - p.effectiveCost;
      const diffPerSqm = CURRENT_PROPERTY.effectiveCostPerSqm - p.effectiveCostPerSqm;
      console.log(`\n  📍 ${p.name}`);
      console.log(`     ${p.address}  ${station}`);
      console.log(`     ${p.layout} / ${p.area}㎡ / ${p.builtYear}`);
      console.log(`     賃料 ${fmt(p.rent)}円 + 管理費 ${p.management > 0 ? fmt(p.management) + '円' : 'なし'}`);
      console.log(`     実質月額 ${fmt(p.effectiveCost)}円 (▼${fmt(diffCost)}円)  ¥/㎡ ${fmt(p.effectiveCostPerSqm)} (▼${fmt(diffPerSqm)})`);
      console.log(`     敷金 ${p.deposit} / 礼金 ${p.keyMoney}`);
      console.log(`     ${p.url}`);
    }
    console.log('');
  } else {
    console.log('比較基準より実質コストと¥/㎡の両方が有利な物件は見つかりませんでした。');
    console.log('(実質月額のみ有利な物件は ↓ マーク付きです)');
    console.log('');
  }
}

main().catch(console.error);
