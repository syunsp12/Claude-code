import { chromium } from '@playwright/test';

const SCRATCHPAD = '/tmp/claude-0/-home-user-Claude-code/6f3207bf-3ea7-55af-a1bb-4167dee73464/scratchpad';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--ignore-certificate-errors',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
    locale: 'ja-JP',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();
  const url = 'https://www.century21.jp/rent/tokyo/13123/detail/058601-45969c';
  console.log('アクセス中:', url);
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('HTTP Status:', resp?.status());
  await page.waitForTimeout(3000);

  await page.screenshot({ path: `${SCRATCHPAD}/c21_page.png`, fullPage: false });
  console.log('スクリーンショット保存完了');

  const data = await page.evaluate(() => {
    const imgs: { src: string; alt: string }[] = [];
    document.querySelectorAll('img').forEach((img) => {
      const src = (img as HTMLImageElement).src ?? '';
      const alt = (img as HTMLImageElement).alt ?? '';
      if (src && !src.startsWith('data:') && src.length > 20) {
        imgs.push({ src, alt });
      }
    });
    const bodyText = (document.body as HTMLElement).innerText;
    return { title: document.title, imgs, bodySnippet: bodyText.slice(0, 3000) };
  });

  console.log('Title:', data.title);
  console.log('\n--- 画像URL ---');
  data.imgs.forEach((img, i) => console.log(`[${i + 1}] ${img.alt || '(no alt)'}: ${img.src}`));

  await browser.close();
}
main().catch(console.error);
