import { chromium } from '@playwright/test';

const SUUMO_URL =
  'https://suumo.jp/jj/chintai/ichiran/FR301FC001/' +
  '?ar=030&bs=040&ta=13&kb=1&mb=10&mt=tm&cn=0' +
  '&shkr1=03&shkr2=03' +
  '&nen=10' +
  '&pc=50';

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

  console.log('Navigating to:', SUUMO_URL);
  const response = await page.goto(SUUMO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('Status:', response?.status());
  console.log('URL after redirect:', page.url());

  // Save screenshot
  await page.screenshot({ path: 'debug_screenshot.png', fullPage: false });
  console.log('Screenshot saved to debug_screenshot.png');

  // Get page title and body text preview
  const title = await page.title();
  console.log('Title:', title);

  // Check for various selectors
  const selectors = [
    '.cassetteitem',
    '.property_unit',
    '.property-list',
    '.js-property-list',
    '[class*="cassette"]',
    '[class*="property"]',
    '.result',
    '#js-bukkenList',
    '.bukkenList',
    'article',
  ];

  for (const sel of selectors) {
    const count = await page.$$(sel).then(els => els.length);
    if (count > 0) console.log(`Selector "${sel}": ${count} elements`);
  }

  // Print first 2000 chars of body HTML to understand structure
  const bodyHtml = await page.$eval('body', el => el.innerHTML.slice(0, 3000));
  console.log('\n--- Body HTML (first 3000 chars) ---');
  console.log(bodyHtml);

  await browser.close();
}

main().catch(console.error);
