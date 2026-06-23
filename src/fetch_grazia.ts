import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--ignore-certificate-errors',
      '--no-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    extraHTTPHeaders: {
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
  });

  // Bot検出回避
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();

  const url = 'https://www.homes.co.jp/chintai/room/fbd6aa5bdc7febaa3b78782bf4f7b34c510b20bb/';
  console.log('アクセス中:', url);

  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('HTTP Status:', resp?.status());
  await page.waitForTimeout(3000);

  // スクリーンショット
  await page.screenshot({
    path: '/tmp/claude-0/-home-user-Claude-code/6f3207bf-3ea7-55af-a1bb-4167dee73464/scratchpad/grazia_page.png',
    fullPage: false,
  });

  const data = await page.evaluate(() => {
    const txt = (el: Element | null): string =>
      el ? ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim() : '';

    // 画像URL収集
    const imgs: { src: string; alt: string }[] = [];
    document.querySelectorAll('img').forEach((img) => {
      const src = (img as HTMLImageElement).src ?? '';
      const alt = (img as HTMLImageElement).alt ?? '';
      if (src && !src.startsWith('data:') && src.length > 30) {
        imgs.push({ src, alt });
      }
    });

    // th/td pairs
    const pairs: Record<string, string> = {};
    document.querySelectorAll('th').forEach((th) => {
      const label = (th as HTMLElement).innerText?.replace(/\s+/g, '').trim() ?? '';
      const td = th.nextElementSibling as HTMLElement | null;
      const val = td ? (td as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() : '';
      if (label && val) pairs[label] = val;
    });

    const bodyText = (document.body as HTMLElement).innerText;
    return { title: document.title, pairs, imgs, bodySnippet: bodyText.slice(0, 5000) };
  });

  console.log('Title:', data.title);

  console.log('\n--- 画像URL（物件写真と思われるもの） ---');
  const photoImgs = data.imgs.filter((img) =>
    img.src.includes('img') || img.src.includes('photo') || img.src.includes('room') || img.src.includes('mansion') || img.src.includes('homes')
  ).slice(0, 30);
  photoImgs.forEach((img, i) => console.log(`[${i + 1}] ${img.alt || '(no alt)'}: ${img.src}`));

  console.log('\n--- 物件情報 ---');
  for (const [k, v] of Object.entries(data.pairs)) {
    console.log(`  ${k}: ${v}`);
  }

  console.log('\n--- 本文（先頭5000字）---');
  console.log(data.bodySnippet);

  await browser.close();
}

main().catch(console.error);
