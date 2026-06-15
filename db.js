/**
 * 賃貸物件DB モジュール
 * Node.js 22 組み込み node:sqlite を使用
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'rental.db');

function openDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');
  return db;
}

function initDb() {
  const db = openDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS scrape_sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      scraped_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      search_area TEXT,          -- 'kasai' / 'nishikasai' / 'urayasu' etc.
      search_madori TEXT,        -- '1R,1K,1LDK'
      search_max_rent INTEGER,
      source      TEXT,          -- 'SUUMO' / 'HOMES'
      result_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS properties (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      address         TEXT,
      station_info    TEXT,      -- 全路線テキスト
      nearest_station TEXT,      -- 最寄り駅名のみ
      walk_min        INTEGER,
      age_text        TEXT,      -- 生テキスト "築6年 2階建"
      build_year      INTEGER,
      total_floors    INTEGER,
      structure       TEXT,      -- SRC/RC/木造/etc
      source          TEXT,      -- SUUMO/HOMES
      created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(name, address)
    );

    CREATE TABLE IF NOT EXISTS room_snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id),
      session_id  INTEGER NOT NULL REFERENCES scrape_sessions(id),
      floor       TEXT,
      madori      TEXT,
      menseki     REAL,
      rent        INTEGER,
      kanri       INTEGER,
      shiki       TEXT,
      rei         TEXT,
      scraped_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_room_prop    ON room_snapshots(property_id);
    CREATE INDEX IF NOT EXISTS idx_room_session ON room_snapshots(session_id);
    CREATE INDEX IF NOT EXISTS idx_room_scraped ON room_snapshots(scraped_at);
    CREATE INDEX IF NOT EXISTS idx_prop_station ON properties(nearest_station);
  `);
  return db;
}

// ---------- パース helpers ----------

function parseRent(val) {
  if (typeof val === 'number') return val;
  if (!val || val === '-') return 0;
  const m = String(val).match(/([\d.]+)万円/);
  if (m) return Math.round(parseFloat(m[1]) * 10000);
  const m2 = String(val).match(/([\d,]+)円/);
  if (m2) return parseInt(m2[1].replace(/,/g, ''));
  return 0;
}

function parseMenseki(val) {
  if (typeof val === 'number') return val;
  const m = String(val || '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function parseAgeText(ageText) {
  const year = new Date().getFullYear();
  const ageM = String(ageText || '').match(/築(\d+)年/);
  const floorM = String(ageText || '').match(/(\d+)階建/);
  return {
    buildYear:   ageM   ? year - parseInt(ageM[1])   : null,
    totalFloors: floorM ? parseInt(floorM[1])         : null,
  };
}

function parseStation(stationInfo) {
  // "東京メトロ東西線/葛西駅 歩8分 | JR..."
  const first = (stationInfo || '').split('|')[0].trim();
  const walkM = first.match(/歩(\d+)分/);
  // 駅名だけ抜く: "東京メトロ東西線/葛西駅 歩8分" → "葛西駅"
  const nameM = first.match(/\/([^/\s]+駅)/);
  return {
    nearest: first,
    nearestName: nameM ? nameM[1] : first,
    walkMin: walkM ? parseInt(walkM[1]) : null,
  };
}

// ---------- DB 書き込み ----------

function upsertProperty(db, prop) {
  const { buildYear, totalFloors } = parseAgeText(prop.age_text || prop.ageText);
  const stationRaw = prop.station_info || prop.allStation || prop.station || prop.nearest || '';
  const { nearest, walkMin } = parseStation(stationRaw);

  // INSERT OR IGNORE → 既存なら updated_at だけ更新
  db.prepare(`
    INSERT INTO properties
      (name, address, station_info, nearest_station, walk_min,
       age_text, build_year, total_floors, structure, source)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(name, address) DO UPDATE SET
      station_info    = excluded.station_info,
      nearest_station = excluded.nearest_station,
      walk_min        = excluded.walk_min,
      age_text        = excluded.age_text,
      build_year      = excluded.build_year,
      total_floors    = excluded.total_floors,
      structure       = excluded.structure,
      updated_at      = datetime('now','localtime')
  `).run(
    prop.name || '',
    prop.address || '',
    stationRaw,
    nearest,
    walkMin,
    prop.age_text || prop.ageText || '',
    buildYear,
    totalFloors,
    prop.structure || null,
    prop.source || null,
  );

  return db.prepare(`SELECT id FROM properties WHERE name=? AND address=?`)
    .get(prop.name || '', prop.address || '').id;
}

function insertSession(db, session) {
  return db.prepare(`
    INSERT INTO scrape_sessions (search_area, search_madori, search_max_rent, source, result_count)
    VALUES (?,?,?,?,?)
  `).run(
    session.search_area || null,
    session.search_madori || null,
    session.search_max_rent || null,
    session.source || null,
    session.result_count || 0,
  ).lastInsertRowid;
}

function insertRooms(db, propertyId, sessionId, rooms) {
  const stmt = db.prepare(`
    INSERT INTO room_snapshots (property_id, session_id, floor, madori, menseki, rent, kanri, shiki, rei)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  for (const r of rooms) {
    stmt.run(
      propertyId,
      sessionId,
      r.floor || null,
      r.madori || null,
      parseMenseki(r.menseki),
      parseRent(r.rent),
      parseRent(r.kanri),
      r.shiki || null,
      r.rei   || null,
    );
  }
}

// ---------- DB 読み込み ----------

/**
 * 最新セッションのルームスナップショット一覧を返す
 * @param {DatabaseSync} db
 * @param {object} opts - {madori: ['1K','1R'], minMenseki, maxMenseki}
 */
function queryLatestRooms(db, opts = {}) {
  const conditions = [];
  const params = [];

  if (opts.madori && opts.madori.length) {
    conditions.push(`r.madori IN (${opts.madori.map(() => '?').join(',')})`);
    params.push(...opts.madori);
  }
  if (opts.minMenseki != null) { conditions.push('r.menseki >= ?'); params.push(opts.minMenseki); }
  if (opts.maxMenseki != null) { conditions.push('r.menseki <= ?'); params.push(opts.maxMenseki); }
  if (opts.maxRent    != null) { conditions.push('r.rent <= ?');    params.push(opts.maxRent); }

  const where = conditions.length ? 'AND ' + conditions.join(' AND ') : '';

  // 同一部屋の最新スナップショット1件のみ取得（重複除去）
  return db.prepare(`
    SELECT
      p.name, p.address, p.nearest_station, p.walk_min,
      p.build_year, p.total_floors, p.structure,
      r.floor, r.madori, r.menseki,
      r.rent, r.kanri, (r.rent + COALESCE(r.kanri,0)) AS total_cost,
      r.shiki, r.rei,
      MAX(s.scraped_at) AS scraped_at, s.search_area
    FROM room_snapshots r
    JOIN properties p ON r.property_id = p.id
    JOIN scrape_sessions s ON r.session_id = s.id
    WHERE 1=1 ${where}
    GROUP BY r.property_id, r.floor, r.madori, r.menseki
    ORDER BY total_cost ASC
  `).all(...params);
}

module.exports = {
  openDb,
  initDb,
  upsertProperty,
  insertSession,
  insertRooms,
  queryLatestRooms,
  parseRent,
  parseMenseki,
  parseAgeText,
  parseStation,
};
