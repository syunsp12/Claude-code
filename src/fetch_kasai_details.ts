import { chromium } from '@playwright/test';

const URLS = [
  { name: '葛西駅5階建築18年（葛西5分）', url: 'https://suumo.jp/chintai/jnc_000107239142/?bc=100513070311' },
  { name: 'グランクオール南砂町ウェスト（南砂町10分）', url: 'https://suumo.jp/chintai/jnc_000106569329/?bc=100502409178' },
  { name: 'CRASTINE南砂町（南砂町8分）', url: 'https://suumo.jp/chintai/jnc_000107819296/?bc=100511982070' },
  { name: 'MYSメゾン南砂（南砂町13分）', url: 'https://suumo.jp/chintai/jnc_000107406610/?bc=100510846289' },
  { name: 'ハーモニーテラス西葛西（西葛西10分）', url: 'https://suumo.jp/chintai/jnc_000107982451/?bc=100512772041' },
  { name: '南砂町駅4階建築2年（南砂町10分）', url: 'https://suumo.jp/chintai/jnc_000106862806/?bc=100504664937' },
  { name: 'レジデンストーキョー南砂（南砂町3分）', url: 'https://suumo.jp/chintai/jnc_000107588281/?bc=100500157923' },
];

async function fetchProperty(context: import('@playwright/test').BrowserContext, name: string, url: string) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!resp || resp.status() >= 400) {
      return { name, url, error: `HTTP ${resp?.status()}` };
    }

    const data = await page.evaluate(() => {
      const txt = (el: Element | null): string =>
        el ? ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';

      const pairs: Record<string, string> = {};
      document.querySelectorAll('th').forEach((th) => {
        const label = (th as HTMLElement).innerText?.replace(/\s+/g, '').trim() ?? '';
        const td = th.nextElementSibling as HTMLElement | null;
        const val = td ? td.innerText?.replace(/\s+/g, ' ').trim() : '';
        if (label && val) pairs[label] = val;
      });

      const bodyText = (document.body as HTMLElement).innerText;

      // 賃料・管理費・敷礼・面積・間取り etc.
      const rentLine = bodyText.match(/賃料[・\s]*(?:初期費用)?\s*\n?\s*([\d.]+)万円/);
      const mgmtLine = bodyText.match(/管理費[・\s]*共益費\s*\n?\s*([\d,万\-]+(?:円)?)/);

      return {
        h1: txt(document.querySelector('h1')),
        pairs,
        bodySnippet: bodyText.slice(0, 2500),
      };
    });

    return { name, url, ...data };
  } catch (e) {
    return { name, url, error: (e as Error).message.slice(0, 80) };
  } finally {
    await page.close();
  }
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

  const results = await Promise.all(
    URLS.map(({ name, url }) => fetchProperty(context, name, url))
  );

  for (const r of results) {
    console.log('\n' + '='.repeat(80));
    console.log(`■ ${r.name}`);
    console.log(`  URL: ${r.url}`);
    if ((r as any).error) {
      console.log(`  ERROR: ${(r as any).error}`);
      continue;
    }
    console.log(`  H1: ${(r as any).h1}`);
    console.log('\n--- 物件概要 ---');
    const pairs = (r as any).pairs as Record<string, string>;
    const keys = ['賃料・初期費用', '管理費・共益費', '敷金/礼金', '間取り', '専有面積', '向き', '築年数', '建物種別', '保証会社', 'ほか初期費用', 'ほか諸費用', '備考', '部屋の特徴・設備', '仲介手数料'];
    for (const [k, v] of Object.entries(pairs)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log('\n--- 本文（先頭2500字）---');
    console.log((r as any).bodySnippet);
  }

  await browser.close();
}

main().catch(console.error);
