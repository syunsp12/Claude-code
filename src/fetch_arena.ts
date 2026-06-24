import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
    locale: 'ja-JP',
  });
  const page = await context.newPage();
  const url = 'https://suumo.jp/chintai/bc_100513255984/';
  console.log('アクセス中:', url);
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('HTTP Status:', resp?.status());
  await page.waitForTimeout(3000);

  const data = await page.evaluate(() => {
    const pairs: Record<string, string> = {};
    document.querySelectorAll('th').forEach((th) => {
      const label = (th as HTMLElement).innerText?.replace(/\s+/g, '').trim() ?? '';
      const td = th.nextElementSibling as HTMLElement | null;
      const val = td ? (td as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() : '';
      if (label && val) pairs[label] = val;
    });
    document.querySelectorAll('dt').forEach((dt) => {
      const label = (dt as HTMLElement).innerText?.replace(/\s+/g, '').trim() ?? '';
      const dd = dt.nextElementSibling as HTMLElement | null;
      const val = dd ? (dd as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() : '';
      if (label && val) pairs[label] = val;
    });
    const bodyText = (document.body as HTMLElement).innerText;
    return { title: document.title, pairs, bodySnippet: bodyText.slice(0, 10000) };
  });

  console.log('Title:', data.title);
  console.log('\n--- 物件情報 (th/dt pairs) ---');
  for (const [k, v] of Object.entries(data.pairs)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log('\n--- 本文 ---');
  console.log(data.bodySnippet);

  await browser.close();
}
main().catch(console.error);
