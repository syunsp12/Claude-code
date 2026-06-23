import { chromium } from '@playwright/test';

const URLS = [
  { name: 'ファランドールカサイ 4階', url: 'https://suumo.jp/chintai/bc_100512987154/' },
  { name: 'アルカディア西葛西 4階', url: 'https://suumo.jp/chintai/bc_100512389558/' },
  { name: 'ＭＫＴ葛西 5階', url: 'https://suumo.jp/chintai/bc_100513079530/' },
  { name: 'ＢＥＬＬＡ ＶＩＳＴＡ 3階', url: 'https://suumo.jp/chintai/bc_100511484918/' },
  { name: 'コルザKII 2階', url: 'https://suumo.jp/chintai/bc_100506540701/' },
  { name: 'クリチェ 3階', url: 'https://suumo.jp/chintai/bc_100512492188/' },
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

      return {
        h1: txt(document.querySelector('h1')),
        pairs,
        bodyText: bodyText.slice(0, 4000),
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
    for (const [k, v] of Object.entries(pairs)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log('\n--- 本文抜粋 ---');
    console.log((r as any).bodyText);
  }

  await browser.close();
}

main().catch(console.error);
