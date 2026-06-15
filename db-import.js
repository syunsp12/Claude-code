/**
 * 既存JSONファイルをSQLiteにインポートする
 * 対象:
 *   kasai-results.json     (SUUMO, rooms[]ネスト構造, rent=文字列)
 *   urayasu-comparison.json (SUUMO, ユニット展開済み, rent=数値)
 */
const fs   = require('fs');
const path = require('path');
const { initDb, upsertProperty, insertSession, insertRooms } = require('./db');

// node:sqlite の警告を抑制
process.env.NODE_NO_WARNINGS = '1';

const db = initDb();

// ===== 1. kasai-results.json =====
{
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'kasai-results.json'), 'utf-8'));
  const items = raw.suumo || [];

  const sessionId = insertSession(db, {
    search_area:     'kasai+nishikasai',
    search_madori:   '1R,1K,1LDK',
    search_max_rent: 120000,
    source:          'SUUMO',
    result_count:    items.reduce((n, p) => n + (p.rooms?.length || 0), 0),
  });

  let propCount = 0, roomCount = 0;
  for (const item of items) {
    if (!item.name && !(item.rooms?.length)) continue;
    const pid = upsertProperty(db, {
      name:        item.name,
      address:     item.address,
      station_info: item.allStation || item.nearest,
      ageText:     item.ageText,
      source:      'SUUMO',
    });
    if (item.rooms?.length) {
      insertRooms(db, pid, sessionId, item.rooms);
      roomCount += item.rooms.length;
    }
    propCount++;
  }
  console.log(`[kasai-results.json]  物件:${propCount}件 / 部屋:${roomCount}件 → session#${sessionId}`);
}

// ===== 2. urayasu-comparison.json =====
{
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'urayasu-comparison.json'), 'utf-8'));
  const stationMap = {
    kasai:      '葛西駅',
    nishikasai: '西葛西駅',
    urayasu:    '浦安駅',
  };

  for (const [key, label] of Object.entries(stationMap)) {
    const units = raw.stations?.[key] || [];
    if (!units.length) continue;

    const sessionId = insertSession(db, {
      search_area:     key,
      search_madori:   '1R,1K,1LDK',
      search_max_rent: 120000,
      source:          'SUUMO',
      result_count:    units.length,
    });

    let propCount = 0, roomCount = 0;
    for (const u of units) {
      if (!u.name) continue;
      const pid = upsertProperty(db, {
        name:        u.name,
        address:     u.address,
        station_info: u.station,
        ageText:     u.ageText,
        structure:   u.structure || null,
        source:      'SUUMO',
      });
      // urayasu-comparison は既にユニット展開済み
      insertRooms(db, pid, sessionId, [{
        floor:   u.floor,
        madori:  u.madori,
        menseki: u.menseki,
        rent:    u.rent,
        kanri:   u.kanri,
        shiki:   u.shiki,
        rei:     u.rei,
      }]);
      propCount++;
      roomCount++;
    }
    console.log(`[urayasu-comparison.json / ${label}]  物件:${propCount}件 / 部屋:${roomCount}件 → session#${sessionId}`);
  }
}

// ===== 確認クエリ =====
const { openDb } = require('./db');
const dbCheck = openDb();

const totals = dbCheck.prepare(`
  SELECT
    (SELECT COUNT(*) FROM scrape_sessions) AS sessions,
    (SELECT COUNT(*) FROM properties)      AS properties,
    (SELECT COUNT(*) FROM room_snapshots)  AS rooms
`).get();

console.log('\n--- DB 現在の件数 ---');
console.log(`セッション: ${totals.sessions}件`);
console.log(`物件:       ${totals.properties}件`);
console.log(`部屋:       ${totals.rooms}件`);
console.log(`DBファイル: ${path.join(__dirname, 'rental.db')}`);

db.close();
dbCheck.close();
