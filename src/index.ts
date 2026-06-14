import { scrapeProperties } from './scraper';
import { CURRENT_PROPERTY } from './types';

function fmt(n: number): string {
  return n.toLocaleString('ja-JP');
}

function pad(str: string, len: number): string {
  // simple space padding for monospace display
  return str.slice(0, len).padEnd(len, ' ');
}

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('  SUUMO 東京都 賃貸物件スクレイパー');
  console.log('  条件: 1K/1R, 家賃10万円以下, 築10年以内');
  console.log('='.repeat(80));
  console.log('');
  console.log('[現在の申込物件]');
  console.log(`  ${CURRENT_PROPERTY.name}`);
  console.log(`  賃料: ${fmt(CURRENT_PROPERTY.rent)}円  管理費: ${fmt(CURRENT_PROPERTY.management)}円`);
  console.log(`  面積: ${CURRENT_PROPERTY.area}㎡  築年: ${CURRENT_PROPERTY.builtYear}`);
  console.log(`  実質月額: ${fmt(CURRENT_PROPERTY.effectiveCost)}円  実質¥/㎡: ${fmt(CURRENT_PROPERTY.effectiveCostPerSqm)}円`);
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

  console.log(`取得件数: ${properties.length} 件（実質月額の安い順）`);
  console.log('');

  // Header
  const header = [
    pad('物件名', 20),
    pad('住所', 18),
    pad('最寄り駅', 16),
    pad('間取', 4),
    pad('㎡', 6),
    pad('賃料', 8),
    pad('管理費', 6),
    pad('築年', 10),
    pad('実質月額', 9),
    pad('¥/㎡', 6),
  ].join('│');

  const sep = '-'.repeat(header.length);
  console.log(sep);
  console.log(header);
  console.log(sep);

  for (const p of properties) {
    const station = p.stations[0] ?? '';
    const isCheaper = p.effectiveCost < CURRENT_PROPERTY.effectiveCost;
    const isCheaperPerSqm = p.effectiveCostPerSqm < CURRENT_PROPERTY.effectiveCostPerSqm;
    const marker = isCheaper && isCheaperPerSqm ? '★' : isCheaper ? '↓' : '';

    const row = [
      pad(p.name, 20),
      pad(p.address.replace('東京都', ''), 18),
      pad(station, 16),
      pad(p.layout, 4),
      pad(`${p.area}`, 6),
      pad(`${fmt(p.rent)}`, 8),
      pad(p.management > 0 ? `${fmt(p.management)}` : '-', 6),
      pad(p.builtYear, 10),
      pad(`${fmt(p.effectiveCost)}`, 9),
      pad(`${fmt(p.effectiveCostPerSqm)}`, 6),
    ].join('│');

    console.log(row + (marker ? `  ${marker}` : ''));
  }

  console.log(sep);
  console.log('★: 実質月額も¥/㎡も現在物件より有利  ↓: 実質月額のみ有利');
  console.log('');
  console.log('【実質月額】= 0.6×賃料 + 管理費  ※家賃補助50%・課税20%を考慮');
  console.log('');

  // Summary: properties that are better than current
  const better = properties.filter(
    (p) => p.effectiveCost <= CURRENT_PROPERTY.effectiveCost && p.effectiveCostPerSqm < CURRENT_PROPERTY.effectiveCostPerSqm
  );
  if (better.length > 0) {
    console.log(`【現在物件より有利な物件: ${better.length} 件】`);
    for (const p of better) {
      const diff = CURRENT_PROPERTY.effectiveCost - p.effectiveCost;
      const diffPerSqm = CURRENT_PROPERTY.effectiveCostPerSqm - p.effectiveCostPerSqm;
      console.log(
        `  ${p.name.slice(0, 24)}  実質: ${fmt(p.effectiveCost)}円 (▼${fmt(diff)}円)  ¥/㎡: ${fmt(p.effectiveCostPerSqm)} (▼${fmt(diffPerSqm)})  ${p.url}`
      );
    }
    console.log('');
  }
}

main().catch(console.error);
