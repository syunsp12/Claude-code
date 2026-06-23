import { chromium } from '@playwright/test';

const URLS = [
  { name: 'プレール・ドゥーク東陽町', url: 'https://www.homes.co.jp/chintai/b-1554390001886/' },
  { name: '中野富士見町駅7分マンション', url: 'https://www.homes.co.jp/chintai/b-1416500025683/' },
  { name: 'アルフレンテ 201', url: 'https://www.homes.co.jp/chintai/b-1420590119904/' },
];

async function fetchProperty(context: any, name: string, url: string) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!resp || resp.status() >= 400) {
      return { name, url, error: `HTTP ${resp?.status()}` };
    }
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const txt = (el: Element | null): string =>
        el ? ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';

      // th/td pairs
      const pairs: Record<string, string> = {};
      document.querySelectorAll('th, dt').forEach((th) => {
        const label = (th as HTMLElement).innerText?.replace(/\s+/g, '').trim() ?? '';
        const next = th.nextElementSibling as HTMLElement | null;
        const val = next ? next.innerText?.replace(/\s+/g, ' ').trim() : '';
        if (label && val) pairs[label] = val;
      });

      // table rows (label/value style)
      document.querySelectorAll('table tr').forEach((tr) => {
        const ths = tr.querySelectorAll('th');
        const tds = tr.querySelectorAll('td');
        ths.forEach((th, i) => {
          const label = (th as HTMLElement).innerText?.replace(/\s+/g, '').trim() ?? '';
          const td = tds[i] as HTMLElement | undefined;
          const val = td ? td.innerText?.replace(/\s+/g, ' ').trim() : '';
          if (label && val) pairs[label] = val;
        });
      });

      const bodyText = (document.body as HTMLElement).innerText;
      return {
        h1: txt(document.querySelector('h1')),
        title: document.title,
        pairs,
        bodySnippet: bodyText.slice(0, 5000),
      };
    });

    return { name, url, ...data };
  } catch (e) {
    return { name, url, error: (e as Error).message.slice(0, 120) };
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
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });

  for (const { name, url } of URLS) {
    const r = await fetchProperty(context, name, url);
    console.log('\n' + '='.repeat(80));
    console.log(`■ ${r.name}`);
    console.log(`  URL: ${r.url}`);
    if ((r as any).error) {
      console.log(`  ERROR: ${(r as any).error}`);
      continue;
    }
    console.log(`  Title: ${(r as any).title}`);
    console.log(`  H1: ${(r as any).h1}`);
    console.log('\n--- 物件概要 (pairs) ---');
    for (const [k, v] of Object.entries((r as any).pairs as Record<string, string>)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log('\n--- 本文（先頭5000字）---');
    console.log((r as any).bodySnippet);
  }

  await browser.close();
}

main().catch(console.error);
