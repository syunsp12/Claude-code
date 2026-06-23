import { chromium, BrowserContext } from '@playwright/test';

// 葛西・西葛西・南砂町駅を東西線で絞り込み、築年数制限なし、1K/1R、10万円以下
// cn=0 で築年数指定なし
// cn パラメータなし = 築年数制限なし
const SEARCH_URL =
  'https://suumo.jp/jj/chintai/ichiran/FR301FC001/?ar=030&bs=040&ra=013&ra=012&rn=0025&cb=0.0&ct=10.0&md=01&md=02&pc=100';

// 対象駅キーワード
const TARGET_STATIONS = ['葛西駅', '西葛西駅', '南砂町駅'];

interface RoomRow {
  layout: string;
  area: string;
  rent: string;
  management: string;
  deposit: string;
  keyMoney: string;
  url: string;
}

interface Property {
  name: string;
  address: string;
  stations: string[];
  builtYear: string;
  builtYearNum: number;
  structure: string;
  floor: string;
  rooms: RoomRow[];
}

function parseRent(s: string): number {
  const m = s.replace(/,/g, '').match(/[\d.]+/);
  if (!m) return 0;
  const n = parseFloat(m[0]);
  return s.includes('万') ? Math.round(n * 10000) : Math.round(n);
}

function parseArea(s: string): number {
  const m = s.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

function parseBuiltYearNum(s: string): number {
  const m = s.match(/(\d{4})年/);
  return m ? parseInt(m[1]) : 0;
}

async function scrapeOnePage(page: any, url: string): Promise<Property[]> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  return await page.evaluate(() => {
    const txt = (el: Element | null): string =>
      el ? ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim() : '';

    const results: any[] = [];
    document.querySelectorAll('.cassetteitem').forEach((card) => {
      const name = txt(card.querySelector('.cassetteitem_content-title'));
      const address = txt(card.querySelector('.cassetteitem_detail-col1'));
      const stationsEl = card.querySelectorAll('.cassetteitem_detail-col2 .cassetteitem_detail-text');
      const stations = Array.from(stationsEl).map((el) => txt(el));
      const col3Divs = card.querySelectorAll('.cassetteitem_detail-col3 div');
      const builtYear = txt(col3Divs[0] ?? null);
      const structure = txt(col3Divs[1] ?? null);

      const rooms: any[] = [];
      card.querySelectorAll('tbody tr.js-cassette_link').forEach((row) => {
        const layout = txt(row.querySelector('.cassetteitem_madori'));
        const areaEl = txt(row.querySelector('.cassetteitem_menseki'));
        const rentEl = txt(row.querySelector('.cassetteitem_price--rent .cassetteitem_other-emphasis'));
        const mgmtEl = txt(row.querySelector('.cassetteitem_price--administration'));
        const depEl = txt(row.querySelector('.cassetteitem_price--deposit'));
        const keyEl = txt(row.querySelector('.cassetteitem_price--gratuity'));
        const linkEl = row.querySelector('a.js-cassette_link_href') as HTMLAnchorElement | null;
        const href = linkEl?.href ?? '';

        const normalized = layout.replace('ワンルーム', '1R');
        if (/^1[KR]$/.test(normalized)) {
          rooms.push({ layout: normalized, area: areaEl, rent: rentEl, management: mgmtEl, deposit: depEl, keyMoney: keyEl, url: href });
        }
      });

      if (rooms.length > 0) {
        results.push({ name, address, stations, builtYear, structure, rooms });
      }
    });
    return results;
  });
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  console.log('SUUMO検索中（葛西・西葛西・南砂町, 1K/1R, 10万円以下, 築年数制限なし）...');
  const rawProps = await scrapeOnePage(page, SEARCH_URL);
  console.log(`全結果: ${rawProps.length} 件`);

  // 対象駅でフィルタ
  const filtered = rawProps.filter((p) =>
    p.stations.some((s: string) => TARGET_STATIONS.some((t) => s.includes(t)))
  );
  console.log(`葛西・西葛西・南砂町絞り込み: ${filtered.length} 件\n`);

  // 各部屋を個別のエントリに展開
  interface Entry {
    name: string;
    address: string;
    station: string;
    layout: string;
    area: number;
    rent: number;
    management: number;
    effectiveCost: number;
    deposit: string;
    keyMoney: string;
    builtYear: string;
    builtYearNum: number;
    structure: string;
    url: string;
  }

  const entries: Entry[] = [];
  for (const p of filtered) {
    for (const r of p.rooms) {
      const rent = parseRent(r.rent);
      const mgmt = parseRent(r.management);
      const area = parseArea(r.area);
      const builtYearNum = parseBuiltYearNum(p.builtYear);
      const effectiveCost = Math.round(rent * 0.6 + mgmt);
      entries.push({
        name: p.name,
        address: p.address.replace('東京都', '').replace('千葉県', ''),
        station: (p.stations[0] ?? '').replace('東京メトロ東西線/', ''),
        layout: r.layout,
        area,
        rent,
        management: mgmt,
        effectiveCost,
        deposit: r.deposit as string,
        keyMoney: r.keyMoney as string,
        builtYear: p.builtYear as string,
        builtYearNum,
        structure: p.structure as string,
        url: r.url,
      });
    }
  }

  // 実質月額でソート
  entries.sort((a, b) => a.effectiveCost - b.effectiveCost || b.builtYearNum - a.builtYearNum);

  // 重複URLを除去
  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    if (seen.has(e.url)) return false;
    seen.add(e.url);
    return true;
  });

  const fmt = (n: number) => n.toLocaleString('ja-JP');
  const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);

  console.log('='.repeat(130));
  console.log('  葛西・西葛西・南砂町 1K/1R 10万円以下 全物件一覧（実質月額順）');
  console.log('  ※実質月額 = 0.6×賃料 + 管理費（家賃補助50%・課税20%）');
  console.log('  ※フジマンション基準: 実質58,200円');
  console.log('='.repeat(130));

  const SEP = '─'.repeat(130);
  const HEADER = [
    trunc('物件名', 24),
    trunc('最寄り駅', 18),
    trunc('住所', 12),
    '間',
    trunc('㎡', 6),
    trunc('賃料', 8),
    trunc('管理費', 6),
    trunc('敷/礼', 9),
    trunc('築年', 8),
    trunc('構造', 6),
    trunc('実質月額', 9),
  ].join('│');

  console.log(SEP);
  console.log(HEADER);
  console.log(SEP);

  for (const e of unique) {
    const marker = e.effectiveCost <= 58200 ? '★' : ' ';
    const row = [
      trunc(e.name, 24),
      trunc(e.station, 18),
      trunc(e.address, 12),
      e.layout.padEnd(1),
      trunc(e.area > 0 ? `${e.area}` : '-', 6),
      trunc(fmt(e.rent), 8),
      trunc(e.management > 0 ? fmt(e.management) : '-', 6),
      trunc(`${e.deposit}/${e.keyMoney}`, 9),
      trunc(e.builtYear.replace('年', '年\n').split('\n')[0], 8),
      trunc(e.structure, 6),
      trunc(fmt(e.effectiveCost), 9),
    ].join('│');
    console.log(`${marker}${row}`);
  }
  console.log(SEP);
  console.log(`★ = フジマンション実質月額(58,200円)以下`);
  console.log(`\n合計 ${unique.length} 室\n`);

  // 詳細（実質月額65,000円以下のみ）
  const details = unique.filter((e) => e.effectiveCost <= 65000);
  console.log(`\n━━━ 詳細 (実質月額65,000円以下 ${details.length}件) ━━━`);
  for (const e of details) {
    const diff = 58200 - e.effectiveCost;
    console.log(`\n  📍 ${e.name} [${e.layout} / ${e.area}㎡ / ${e.builtYear} / ${e.structure}]`);
    console.log(`     ${e.address}  ${e.station}`);
    console.log(`     賃料 ${fmt(e.rent)}円 + 管理費 ${e.management > 0 ? fmt(e.management) + '円' : 'なし'}`);
    console.log(`     実質月額 ${fmt(e.effectiveCost)}円  ${diff >= 0 ? `(フジ比 ▼${fmt(diff)}円)` : `(フジ比 ▲${fmt(-diff)}円)`}`);
    console.log(`     敷金 ${e.deposit} / 礼金 ${e.keyMoney}`);
    console.log(`     ${e.url}`);
  }

  await browser.close();
}

main().catch(console.error);
