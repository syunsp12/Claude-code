import { chromium } from '@playwright/test';

const TARGETS = [
  { label: '①南砂町 築2年 1K', url: 'https://suumo.jp/chintai/jnc_000106862806/?bc=100504664937' },
  { label: '②グランクオール南砂町ウェスト 築3年 1K', url: 'https://suumo.jp/chintai/jnc_000106569329/?bc=100502409178' },
  { label: '③MYSメゾン南砂 築5年 1R', url: 'https://suumo.jp/chintai/jnc_000098355803/?bc=100508590321' },
  { label: '④Green Hill東陽町 築5年 1R', url: 'https://suumo.jp/chintai/jnc_000106801749/?bc=100510324535' },
  { label: '⑤木場駅 築6年 1R (東陽5)', url: 'https://suumo.jp/chintai/jnc_000107138048/?bc=100509549456' },
];

function txt(el: Element): string {
  return (el as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() ?? el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

async function getDetail(page: import('@playwright/test').Page, label: string, url: string) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`【${label}】`);
  console.log(`${url}`);
  console.log('═'.repeat(80));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const data = await page.evaluate(() => {
    function innerTxt(el: Element): string {
      return (el as HTMLElement).innerText?.replace(/\s+/g, ' ').trim()
        ?? el.textContent?.replace(/\s+/g, ' ').trim()
        ?? '';
    }

    // 物件名
    const name = innerTxt(document.querySelector('h1') ?? document.createElement('span'));

    // 賃料・敷礼
    const rentBlock = document.querySelector('.detailbody-summary, .chintai-bukken-price, [class*="rent-price"]');
    const rentText = rentBlock ? innerTxt(rentBlock) : '';

    // 基本情報テーブル（所在地・駅・間取り・面積・階・築年・向き・建物種別）
    const infoRows: string[] = [];
    document.querySelectorAll('.detailbody-info table tr').forEach((row) => {
      const cells = Array.from(row.querySelectorAll('th, td')).map((c) => innerTxt(c));
      if (cells.length >= 2) infoRows.push(cells.join(': '));
    });
    // fallback: look for the summary table
    if (infoRows.length === 0) {
      document.querySelectorAll('table tr').forEach((row) => {
        const ths = Array.from(row.querySelectorAll('th'));
        const tds = Array.from(row.querySelectorAll('td'));
        ths.forEach((th, i) => {
          const label = innerTxt(th);
          const val = tds[i] ? innerTxt(tds[i]) : '';
          if (label && val) infoRows.push(`${label}: ${val}`);
        });
      });
    }

    // 部屋の特徴・設備 (find by heading text)
    let features = '';
    document.querySelectorAll('h2, h3, .heading, [class*="head"]').forEach((el) => {
      if (innerTxt(el).includes('特徴') || innerTxt(el).includes('設備')) {
        const parent = el.closest('section') ?? el.parentElement?.parentElement ?? el.parentElement;
        if (parent) {
          features = innerTxt(parent).replace(innerTxt(el), '').trim();
        }
      }
    });

    // 物件概要 (th/td pairs)
    const overview: string[] = [];
    document.querySelectorAll('th').forEach((th) => {
      const label = innerTxt(th);
      const td = th.nextElementSibling as HTMLElement | null;
      const val = td ? innerTxt(td) : '';
      if (label && val && label.length < 20 && val.length < 300) {
        overview.push(`${label}: ${val}`);
      }
    });

    // POINT / コメント
    let point = '';
    document.querySelectorAll('*').forEach((el) => {
      const t = innerTxt(el);
      if (t === 'POINT') {
        const parent = el.parentElement?.parentElement ?? el.parentElement;
        if (parent) point = innerTxt(parent).replace('POINT', '').trim().slice(0, 800);
      }
    });

    // 仲介・保証・初期費用 (備考欄)
    const remarks: string[] = [];
    document.querySelectorAll('th').forEach((th) => {
      const label = innerTxt(th);
      if (['仲介手数料', '保証会社', 'ほか初期費用', 'ほか諸費用', '備考', '契約期間'].some((k) => label.includes(k))) {
        const td = th.nextElementSibling as HTMLElement | null;
        const val = td ? innerTxt(td) : '';
        if (val) remarks.push(`${label}: ${val}`);
      }
    });

    return { name, rentText, infoRows, features, overview, point, remarks };
  });

  console.log(`物件名: ${data.name}`);
  if (data.rentText) console.log(`費用: ${data.rentText.slice(0, 200)}`);

  if (data.infoRows.length > 0) {
    console.log('\n--- 基本情報 ---');
    data.infoRows.slice(0, 15).forEach((r) => console.log(r));
  }

  if (data.features) {
    console.log('\n--- 部屋の特徴・設備 ---');
    console.log(data.features.slice(0, 1200));
  }

  if (data.overview.length > 0) {
    console.log('\n--- 物件概要 ---');
    data.overview.slice(0, 25).forEach((r) => console.log(r));
  }

  if (data.remarks.length > 0) {
    console.log('\n--- 初期費用・契約条件 ---');
    data.remarks.forEach((r) => console.log(r));
  }

  if (data.point) {
    console.log('\n--- POINT ---');
    console.log(data.point);
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    for (const { label, url } of TARGETS) {
      await getDetail(page, label, url);
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
