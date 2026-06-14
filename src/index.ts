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
  console.log('  SUUMO 東京メトロ東西線 賃貸物件調査（募集中物件のみ）');
  console.log('  条件: 1K/1R, 家賃10万円以下, 築10年以内');
  console.log('='.repeat(100));
  console.log('');
  console.log('【比較基準: 現在の申込物件】');
  console.log(`  ${CURRENT_PROPERTY.name}`);
  console.log(`  賃料 ${fmt(CURRENT_PROPERTY.rent)}円 / 管理費 ${fmt(CURRENT_PROPERTY.management)}円`);
  console.log(`  ${CURRENT_PROPERTY.area}㎡  ${CURRENT_PROPERTY.builtYear} (築19年)`);
  console.log(`  実質月額 ${fmt(CURRENT_PROPERTY.effectiveCost)}円`);
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

  // 実質月額が比較基準以下の候補（検証済み）
  const candidates = properties.filter((p) => p.effectiveCost <= CURRENT_PROPERTY.effectiveCost);
  const available = candidates.filter((p) => p.available);
  const excluded = candidates.filter((p) => !p.available);

  console.log('');
  console.log(
    `取得 ${properties.length} 件 / 実質月額 ${fmt(CURRENT_PROPERTY.effectiveCost)}円以下の候補 ${candidates.length} 件 ` +
      `→ うち募集中 ${available.length} 件 / 除外 ${excluded.length} 件`
  );
  console.log('');

  // ─── 募集中の候補テーブル（築年数が新しい順）───
  const SEP = '─'.repeat(120);
  const HEADER = [
    truncate('物件名', 22),
    truncate('住所', 14),
    truncate('最寄り駅', 16),
    '間',
    truncate('㎡', 6),
    truncate('賃料', 8),
    truncate('管理費', 6),
    truncate('敷/礼', 9),
    truncate('築年', 6),
    truncate('実質月額', 9),
    truncate('情報更新日', 10),
  ].join('│');

  console.log('━━━ 募集中（実質月額が現在以下・築浅）━━━');
  console.log(SEP);
  console.log(HEADER);
  console.log(SEP);

  for (const p of available) {
    const station = (p.stations[0] ?? '').replace('東京メトロ東西線/', '');
    const row = [
      truncate(p.name, 22),
      truncate(p.address.replace('東京都', ''), 14),
      truncate(station, 16),
      p.layout.padEnd(1),
      truncate(p.area > 0 ? `${p.area}` : '-', 6),
      truncate(`${fmt(p.rent)}`, 8),
      truncate(p.management > 0 ? `${fmt(p.management)}` : '-', 6),
      truncate(`${p.deposit}/${p.keyMoney}`, 9),
      truncate(p.builtYear, 6),
      truncate(`${fmt(p.effectiveCost)}`, 9),
      truncate(p.infoUpdated ?? '-', 10),
    ].join('│');
    console.log(row);
  }
  console.log(SEP);
  console.log('【実質月額 = 0.6×賃料 + 管理費】（家賃補助50%・課税20%計算済み）');
  console.log('');

  // ─── 除外された候補（募集終了・期限切れ等）───
  if (excluded.length > 0) {
    console.log(`━━━ 除外: 募集が確認できなかった候補 ${excluded.length} 件 ━━━`);
    for (const p of excluded) {
      const station = (p.stations[0] ?? '').replace('東京メトロ東西線/', '');
      console.log(
        `  ✕ ${truncate(p.name, 24)} ${truncate(station, 16)} 実質${fmt(p.effectiveCost)}円  → ${p.verifyNote}`
      );
    }
    console.log('');
  }

  // ─── 募集中物件の詳細 ───
  if (available.length > 0) {
    console.log(`━━━ 募集中物件の詳細 ${available.length} 件（築年数が新しい順）━━━`);
    for (const p of available) {
      const station = (p.stations[0] ?? '').replace('東京メトロ東西線/', '');
      const diffCost = CURRENT_PROPERTY.effectiveCost - p.effectiveCost;
      console.log(`\n  📍 ${p.name}`);
      console.log(`     ${p.address}  ${station}`);
      console.log(`     ${p.layout} / ${p.area}㎡ / ${p.builtYear} / ${p.structure}`);
      console.log(`     賃料 ${fmt(p.rent)}円 + 管理費 ${p.management > 0 ? fmt(p.management) + '円' : 'なし'}`);
      console.log(`     実質月額 ${fmt(p.effectiveCost)}円 (現在比 ▼${fmt(diffCost)}円)`);
      console.log(`     敷金 ${p.deposit} / 礼金 ${p.keyMoney}`);
      console.log(`     情報更新日 ${p.infoUpdated} / 次回更新予定 ${p.nextUpdate}`);
      console.log(`     ${p.url}`);
    }
    console.log('');
  } else {
    console.log('募集中の物件が見つかりませんでした。');
    console.log('');
  }
}

main().catch(console.error);
