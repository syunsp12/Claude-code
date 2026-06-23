import { chromium } from '@playwright/test';

// 葛西・西葛西・南砂町 1K/1R 10万円以下 全ページ取得
// ra=013 = 葛西駅, ra=012 = 西葛西駅, rn=0025 = 南砂町駅
const BASE_URL =
  'https://suumo.jp/jj/chintai/ichiran/FR301FC001/?ar=030&bs=040&ra=013&ra=012&rn=0025&cb=0.0&ct=10.0&md=01&md=02&pc=100';

const TARGET_STATIONS = ['葛西駅', '西葛西駅', '南砂町駅'];

// フジマンション系列を示すキーワード（名前に含まれる場合除外）
const FUJI_KEYWORDS = ['フジマンション', 'フジ・マンション', 'フジハイツ', 'フジコーポ', 'フジレジデンス'];

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
  structure: string;
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

async function scrapeOnePage(page: any, url: string): Promise<{ props: Property[]; hasNext: boolean }> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  return await page.evaluate(() => {
    const txt = (el: Element | null): string =>
      el ? ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim() : '';

    const props: any[] = [];
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
        props.push({ name, address, stations, builtYear, structure, rooms });
      }
    });

    // 次ページ有無
    const nextBtn = document.querySelector('.pagination-parts li.pagination-parts__next a, [class*="pagination"] a[href*="page="]');
    const hasNext = !!nextBtn;

    return { props, hasNext };
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

  const allProps: Property[] = [];
  const MAX_PAGES = 5;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? BASE_URL : `${BASE_URL}&page=${p}`;
    console.log(`ページ ${p} 取得中...`);
    const { props, hasNext } = await scrapeOnePage(page, url);
    allProps.push(...props);
    console.log(`  → ${props.length} 件取得`);
    if (!hasNext) {
      console.log(`  → 最終ページ（${p}ページ）`);
      break;
    }
  }

  console.log(`\n全取得: ${allProps.length} 物件`);

  // 対象駅フィルタ
  const stationFiltered = allProps.filter((p) =>
    p.stations.some((s) => TARGET_STATIONS.some((t) => s.includes(t)))
  );
  console.log(`駅絞り込み後: ${stationFiltered.length} 物件`);

  // フジマンション系列除外
  const nonFuji = stationFiltered.filter((p) =>
    !FUJI_KEYWORDS.some((kw) => p.name.includes(kw))
  );
  const fujiCount = stationFiltered.length - nonFuji.length;
  console.log(`フジ系除外: ${fujiCount} 件 → 残り ${nonFuji.length} 物件\n`);

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
  for (const prop of nonFuji) {
    for (const r of prop.rooms) {
      const rent = parseRent(r.rent);
      const mgmt = parseRent(r.management);
      const area = parseArea(r.area);
      const builtYearNum = parseBuiltYearNum(prop.builtYear);
      const effectiveCost = Math.round(rent * 0.6 + mgmt);
      entries.push({
        name: prop.name,
        address: prop.address.replace('東京都', '').replace('千葉県', ''),
        station: (prop.stations[0] ?? '').replace('東京メトロ東西線/', ''),
        layout: r.layout,
        area,
        rent,
        management: mgmt,
        effectiveCost,
        deposit: r.deposit,
        keyMoney: r.keyMoney,
        builtYear: prop.builtYear,
        builtYearNum,
        structure: prop.structure,
        url: r.url,
      });
    }
  }

  // 実質月額昇順、同額なら築年新しい順
  entries.sort((a, b) => a.effectiveCost - b.effectiveCost || b.builtYearNum - a.builtYearNum);

  // URL重複除去
  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    if (seen.has(e.url)) return false;
    seen.add(e.url);
    return true;
  });

  const fmt = (n: number) => n.toLocaleString('ja-JP');
  const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);

  console.log('='.repeat(140));
  console.log('  葛西・西葛西・南砂町 1K/1R 10万円以下（フジ系除外）実質月額順');
  console.log('  ※実質月額 = 0.6×賃料 + 管理費   ★ = フジマンション(58,200円)以下');
  console.log('='.repeat(140));

  const SEP = '─'.repeat(140);
  const HDR = [
    trunc('物件名', 26),
    trunc('最寄り駅', 18),
    trunc('住所', 14),
    '間',
    trunc('㎡', 6),
    trunc('賃料', 8),
    trunc('管理費', 7),
    trunc('敷/礼', 9),
    trunc('築年', 9),
    trunc('構造', 6),
    trunc('実質月額', 9),
  ].join('│');

  console.log(SEP);
  console.log(HDR);
  console.log(SEP);

  for (const e of unique) {
    const marker = e.effectiveCost <= 58200 ? '★' : ' ';
    const row = [
      trunc(e.name, 26),
      trunc(e.station, 18),
      trunc(e.address, 14),
      e.layout.padEnd(2),
      trunc(e.area > 0 ? `${e.area}` : '-', 6),
      trunc(fmt(e.rent), 8),
      trunc(e.management > 0 ? fmt(e.management) : '-', 7),
      trunc(`${e.deposit}/${e.keyMoney}`, 9),
      trunc(e.builtYear, 9),
      trunc(e.structure, 6),
      trunc(fmt(e.effectiveCost), 9),
    ].join('│');
    console.log(`${marker}${row}`);
  }
  console.log(SEP);
  console.log(`合計 ${unique.length} 室\n`);

  // 詳細: 実質65,000円以下
  const details = unique.filter((e) => e.effectiveCost <= 65000);
  console.log(`\n━━━ 詳細リスト (実質月額65,000円以下 ${details.length}件) ━━━`);
  for (const e of details) {
    const diff = 58200 - e.effectiveCost;
    console.log(`\n  【${e.name}】`);
    console.log(`  ${e.layout} / ${e.area}㎡ / ${e.builtYear} / ${e.structure}`);
    console.log(`  ${e.address}  ${e.station}`);
    console.log(`  賃料 ${fmt(e.rent)}円 + 管理費 ${e.management > 0 ? fmt(e.management) + '円' : 'なし'}`);
    console.log(`  実質月額 ${fmt(e.effectiveCost)}円  ${diff >= 0 ? `(フジ比 ▼${fmt(diff)}円)` : `(フジ比 ▲${fmt(-diff)}円)`}`);
    console.log(`  敷金 ${e.deposit} / 礼金 ${e.keyMoney}`);
    console.log(`  ${e.url}`);
  }

  await browser.close();
}

main().catch(console.error);
