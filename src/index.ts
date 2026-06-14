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

  console.log(`取得件数: ${properties.length} 件  (築年数が新しい順。実質月額が比較基準以下の物件は★表示)`);
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
    const marker = isCheaperCost ? '★' : '';

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
  console.log('★: 実質月額が比較基準（58,200円）以下');
  console.log('');
  console.log('【実質月額 = 0.6×賃料 + 管理費】（家賃補助50%・課税20%計算済み）');
  console.log('');

  // Properties with effectiveCost <= current, sorted newest first (already sorted by scraper)
  const affordable = properties.filter((p) => p.effectiveCost <= CURRENT_PROPERTY.effectiveCost);

  if (affordable.length > 0) {
    console.log(`━━━ 実質月額が現在以下の築浅物件: ${affordable.length} 件（築年数が新しい順）━━━`);
    for (const p of affordable) {
      const station = (p.stations[0] ?? '').replace('東京メトロ東西線/', '');
      const diffCost = CURRENT_PROPERTY.effectiveCost - p.effectiveCost;
      console.log(`\n  📍 ${p.name}`);
      console.log(`     ${p.address}  ${station}`);
      console.log(`     ${p.layout} / ${p.area}㎡ / ${p.builtYear}`);
      console.log(`     賃料 ${fmt(p.rent)}円 + 管理費 ${p.management > 0 ? fmt(p.management) + '円' : 'なし'}`);
      console.log(`     実質月額 ${fmt(p.effectiveCost)}円 (▼${fmt(diffCost)}円)  ¥/㎡ ${p.effectiveCostPerSqm > 0 ? fmt(p.effectiveCostPerSqm) : '-'}`);
      console.log(`     敷金 ${p.deposit} / 礼金 ${p.keyMoney}`);
      console.log(`     ${p.url}`);
    }
    console.log('');
  } else {
    console.log('実質月額が現在以下の物件は見つかりませんでした。');
    console.log('');
  }
}

main().catch(console.error);
