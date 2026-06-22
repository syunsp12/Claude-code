import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('https://suumo.jp/chintai/bc_100512389558/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  const data = await page.evaluate(() => {
    const txt = (el: Element | null): string =>
      el ? ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';

    const pairs: string[] = [];
    document.querySelectorAll('th').forEach((th) => {
      const label = txt(th);
      const val = txt(th.nextElementSibling);
      if (label && val) pairs.push(`${label}: ${val}`);
    });

    let point = '';
    document.querySelectorAll('*').forEach((el) => {
      if (txt(el) === 'POINT') {
        const p = el.parentElement?.parentElement ?? el.parentElement;
        if (p) point = txt(p).replace('POINT', '').trim().slice(0, 1000);
      }
    });

    const bodyText = (document.body as HTMLElement).innerText.replace(/\n{3,}/g, '\n\n').trim();

    return {
      h1: txt(document.querySelector('h1')),
      pairs,
      point,
      bodyText,
    };
  });

  console.log('物件名:', data.h1);
  console.log('\n=== 物件概要 ===');
  data.pairs.forEach((p) => console.log(p));
  console.log('\n=== POINT ===');
  console.log(data.point);
  console.log('\n=== 本文抜粋 (1500-5500文字) ===');
  console.log(data.bodyText.slice(1500, 5500));
  console.log('\n=== 本文抜粋 (0-1500文字) ===');
  console.log(data.bodyText.slice(0, 1500));
  await browser.close();
}

main().catch(console.error);
