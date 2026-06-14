import { chromium } from '@playwright/test';

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

  // Start from SUUMO chintai Tokyo top page
  console.log('1. トップページにアクセス...');
  await page.goto('https://suumo.jp/chintai/tokyo/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  console.log('   Title:', await page.title());
  console.log('   URL:', page.url());
  await page.screenshot({ path: 'debug2_top.png', fullPage: false });

  // Look for search form elements
  const forms = await page.$$eval('form', fs => fs.map(f => ({ action: f.action, id: f.id, className: f.className })));
  console.log('Forms:', JSON.stringify(forms.slice(0, 3), null, 2));

  // Try clicking on 東京 and see where we get
  // Let's try the search result page directly with different URL
  const testUrls = [
    'https://suumo.jp/chintai/tokyo/ken/?fr=chintai_tokyo_top',
    'https://suumo.jp/chintai/tokyo/station/',
    'https://suumo.jp/jj/chintai/ichiran/FR301FC001/?ar=030&bs=040&ta=13&pc=20',
  ];

  for (const url of testUrls) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const title = await page.title();
    const status = page.url();
    console.log(`\nURL: ${url}`);
    console.log(`  Title: ${title}`);
    console.log(`  Final URL: ${status}`);

    if (!title.includes('エラー')) {
      await page.screenshot({ path: `debug2_result.png`, fullPage: false });
      // Check selectors
      const cards1 = await page.$$('.cassetteitem');
      const cards2 = await page.$$('[class*="cassette"]');
      const cards3 = await page.$$('.property');
      const cards4 = await page.$$('article');
      console.log(`  .cassetteitem: ${cards1.length}`);
      console.log(`  [class*=cassette]: ${cards2.length}`);
      console.log(`  .property: ${cards3.length}`);
      console.log(`  article: ${cards4.length}`);

      const html = await page.$eval('body', el => el.innerHTML.slice(0, 2000));
      console.log('  HTML preview:', html.slice(0, 500));
      break;
    }
  }

  await browser.close();
}

main().catch(console.error);
