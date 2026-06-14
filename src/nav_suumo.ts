import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_DIR = '/home/user/Claude-code';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function takeScreenshot(page: Page, filename: string): Promise<void> {
  const filepath = path.join(BASE_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  console.log(`Screenshot saved: ${filepath}`);
}

async function main() {
  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  try {
    // Step 1: Open SUUMO Tokyo rental page
    console.log('\n=== STEP 1: Opening SUUMO Tokyo rental page ===');
    await page.goto('https://suumo.jp/chintai/tokyo/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log('Current URL:', page.url());
    await takeScreenshot(page, 'suumo_step1.png');

    // Step 2: Find 路線/沿線 search links
    console.log('\n=== STEP 2: Looking for 路線/沿線 search ===');

    // Look for line/route search tabs or links
    const pageContent = await page.content();

    // Find 路線 related elements
    const routeLinks = await page.evaluate(() => {
      const links: { text: string; href: string; selector: string }[] = [];
      // Look for links with 路線 or 沿線 in text
      document.querySelectorAll('a').forEach((a) => {
        const text = a.textContent?.trim() || '';
        if (text.includes('路線') || text.includes('沿線') || text.includes('駅・路線')) {
          links.push({
            text,
            href: a.href,
            selector: a.className
          });
        }
      });
      return links.slice(0, 20);
    });
    console.log('Route search links found:', JSON.stringify(routeLinks, null, 2));

    // Also check for tab structures
    const tabs = await page.evaluate(() => {
      const tabItems: { text: string; href: string }[] = [];
      document.querySelectorAll('[class*="tab"], [class*="Tab"], [role="tab"]').forEach((el) => {
        tabItems.push({
          text: el.textContent?.trim() || '',
          href: (el as HTMLAnchorElement).href || ''
        });
      });
      return tabItems.slice(0, 20);
    });
    console.log('Tabs found:', JSON.stringify(tabs, null, 2));

    // Step 3: Try to find the 路線から探す (search by train line) section
    console.log('\n=== STEP 3: Navigating to 東西線 search ===');

    // Try clicking on 路線から探す or similar
    let clickedRoute = false;

    // Try various selectors for route search
    const routeSelectors = [
      'a:has-text("路線から")',
      'a:has-text("沿線から")',
      'a:has-text("駅・路線")',
      '[data-tracking*="route"]',
      '.searchByStation',
      '.js-searchByLine',
    ];

    for (const sel of routeSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          console.log(`Found route link with selector: ${sel}`);
          await el.click();
          await page.waitForTimeout(2000);
          clickedRoute = true;
          break;
        }
      } catch (e) {
        // continue
      }
    }

    if (!clickedRoute) {
      console.log('Could not find route link by common selectors, checking page structure...');
      // Log all anchor text to find the right one
      const allLinks = await page.evaluate(() => {
        const links: { text: string; href: string }[] = [];
        document.querySelectorAll('a').forEach((a) => {
          const text = a.textContent?.trim() || '';
          if (text.length > 0 && text.length < 50) {
            links.push({ text, href: a.href });
          }
        });
        return links.slice(0, 60);
      });
      console.log('All links on page:', JSON.stringify(allLinks, null, 2));
    }

    await takeScreenshot(page, 'suumo_step2.png');
    console.log('URL after step 2:', page.url());

    // Step 4: Try direct URL approach for 東西線
    // SUUMO uses ensen codes for train lines. 東西線 (Tokyo Metro) is typically ec=24010
    // Let's try to find the correct URL by navigating through the site
    console.log('\n=== STEP 4: Trying direct 東西線 URL ===');

    // Common SUUMO URL patterns for line search
    // Try Tokyo Metro Tozai Line
    const directUrl = 'https://suumo.jp/chintai/tokyo/eki/';
    await page.goto(directUrl, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('Navigated to:', page.url());

    // Look for 東西線 link
    const tozaiLink = await page.evaluate(() => {
      const links: { text: string; href: string }[] = [];
      document.querySelectorAll('a').forEach((a) => {
        const text = a.textContent?.trim() || '';
        if (text.includes('東西線') || text.includes('tozai')) {
          links.push({ text, href: a.href });
        }
      });
      return links;
    });
    console.log('東西線 links found:', JSON.stringify(tozaiLink, null, 2));
    await takeScreenshot(page, 'suumo_step3.png');

    // Step 5: Try the main SUUMO chintai search with line parameter
    console.log('\n=== STEP 5: Trying SUUMO line search URLs ===');

    // Try different URL patterns
    const urlsToTry = [
      'https://suumo.jp/chintai/tokyo/eki/dt_stn_1160/',  // potential station search
      'https://suumo.jp/chintai/ensen/tokyo/?rosen=24010', // line search with rosen code
      'https://suumo.jp/chintai/tokyo/ensen/',
    ];

    let workingUrl = '';
    for (const url of urlsToTry) {
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        const currentUrl = page.url();
        console.log(`Tried: ${url} -> ${currentUrl}`);
        const title = await page.title();
        console.log('Page title:', title);
        if (!currentUrl.includes('error') && !currentUrl.includes('404')) {
          workingUrl = currentUrl;
          break;
        }
      } catch (e) {
        console.log(`Failed: ${url}`);
      }
    }

    // Go back to main page and try navigating through UI
    console.log('\n=== STEP 6: Navigating SUUMO UI to find 東西線 ===');
    await page.goto('https://suumo.jp/chintai/tokyo/', { waitUntil: 'networkidle', timeout: 30000 });

    // Check the page HTML structure more carefully
    const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 5000));
    console.log('\nFirst 5000 chars of body HTML:');
    console.log(bodyHTML);

    await takeScreenshot(page, 'suumo_step4.png');

    // Step 7: Look for 路線 form/search on the page
    console.log('\n=== STEP 7: Checking for route search form ===');
    const forms = await page.evaluate(() => {
      const formInfo: { action: string; method: string; inputs: { name: string; type: string; value: string }[] }[] = [];
      document.querySelectorAll('form').forEach((form) => {
        const inputs: { name: string; type: string; value: string }[] = [];
        form.querySelectorAll('input, select').forEach((el) => {
          const input = el as HTMLInputElement;
          inputs.push({
            name: input.name || '',
            type: input.type || el.tagName,
            value: input.value || ''
          });
        });
        formInfo.push({
          action: form.action,
          method: form.method,
          inputs
        });
      });
      return formInfo;
    });
    console.log('Forms found:', JSON.stringify(forms, null, 2));

    // Step 8: Try to use SUUMO's search API or construct the correct URL
    console.log('\n=== STEP 8: Constructing 東西線 search URL ===');

    // SUUMO Tokyo Metro Tozai Line search
    // The pattern is usually: /chintai/ensen/[prefecture]/?rosen=[line_code]
    // or using the search form parameters

    // Let's try a known working SUUMO URL format
    const searchUrls = [
      'https://suumo.jp/chintai/tokyo/ensen/?rosen=0-3-135',
      'https://suumo.jp/chintai/ensen/tokyo/ec-00024010/?md=01&md=02&ms=0&ts=0400000',
    ];

    for (const url of searchUrls) {
      try {
        console.log(`Trying: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        console.log('Landed at:', page.url());
        const title = await page.title();
        console.log('Title:', title);
      } catch (e) {
        console.log('Failed:', url, e);
      }
    }

    await takeScreenshot(page, 'suumo_step5.png');

    // Step 9: Use SUUMO's actual search with form submission
    console.log('\n=== STEP 9: Using SUUMO search form ===');

    // Navigate to the Tokyo rental page and interact with the route search
    await page.goto('https://suumo.jp/chintai/tokyo/', { waitUntil: 'networkidle', timeout: 30000 });

    // Try to find and click 路線から検索 type button/tab
    const routeTabSelectors = [
      'text=路線から',
      'text=沿線から',
      'text=路線・沿線',
      '.tab-station',
      '#tab-station',
      '[href*="ensen"]',
    ];

    for (const sel of routeTabSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const text = await el.textContent();
          console.log(`Found element "${text}" with selector: ${sel}`);
          await el.click();
          await page.waitForTimeout(1500);
          console.log('Clicked, URL now:', page.url());
          await takeScreenshot(page, 'suumo_step6.png');
          break;
        }
      } catch (e) {
        // continue
      }
    }

    // Check for 東京メトロ and 東西線 on current page
    const metroLinks = await page.evaluate(() => {
      const links: { text: string; href: string }[] = [];
      document.querySelectorAll('a').forEach((a) => {
        const text = a.textContent?.trim() || '';
        if (text.includes('メトロ') || text.includes('東西') || text.includes('地下鉄')) {
          links.push({ text, href: a.href });
        }
      });
      return links;
    });
    console.log('Metro/Tozai links:', JSON.stringify(metroLinks, null, 2));

    // Step 10: Try direct search URL pattern used by SUUMO
    console.log('\n=== STEP 10: Trying known SUUMO URL patterns ===');

    // SUUMO uses specific codes. Let's try to find the right 東西線 URL
    // by checking the sitemap or using search
    const finalSearchUrl = 'https://suumo.jp/chintai/tokyo/eki/?rosen=ec-00024010&md%5B%5D=01&md%5B%5D=02&ts%5B%5D=0400000';

    // Actually let's try the standard SUUMO search URL format
    // The URL structure for line search is typically:
    // https://suumo.jp/chintai/ensen/[pref]/ec-[line_code]/?md[]=01&md[]=02&ts[]=0400000
    const tozaiSearchUrl = 'https://suumo.jp/chintai/ensen/tokyo/ec-00024010/?md%5B%5D=01&md%5B%5D=02&ts%5B%5D=0400000';

    console.log('Navigating to:', tozaiSearchUrl);
    await page.goto(tozaiSearchUrl, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('Final URL:', page.url());
    const finalTitle = await page.title();
    console.log('Final title:', finalTitle);
    await takeScreenshot(page, 'suumo_step7.png');

    // Step 11: Check result page structure
    console.log('\n=== STEP 11: Analyzing result page structure ===');
    const finalUrl = page.url();

    // Check if we have results
    const resultCount = await page.evaluate(() => {
      const countEl = document.querySelector('[class*="bukken-count"], [class*="result-count"], .js-bukkencount');
      return countEl?.textContent?.trim() || 'not found';
    });
    console.log('Result count element:', resultCount);

    // Get the body HTML
    const resultBodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 3000));
    console.log('\nFirst 3000 chars of result page body HTML:');
    console.log(resultBodyHTML);

    // Find property card selectors
    const propertySelectors = await page.evaluate(() => {
      const info: { selector: string; count: number; sample: string }[] = [];

      // Common SUUMO property card class names
      const selectorsToCheck = [
        '.cassetteitem',
        '[class*="cassette"]',
        '.property-item',
        '[class*="property"]',
        '.item-box',
        '[class*="item-box"]',
        '.bukken-item',
        '[class*="bukken"]',
        '.result-item',
        '[class*="result"]',
        'article',
        '[class*="listing"]',
      ];

      for (const sel of selectorsToCheck) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          info.push({
            selector: sel,
            count: els.length,
            sample: (els[0] as HTMLElement).className
          });
        }
      }
      return info;
    });
    console.log('\nProperty card selectors found:', JSON.stringify(propertySelectors, null, 2));

    // Try to extract first property data
    console.log('\n=== STEP 12: Extracting first property data ===');
    const firstProperty = await page.evaluate(() => {
      // Try cassette item first (common SUUMO pattern)
      const card = document.querySelector('.cassetteitem') ||
        document.querySelector('[class*="cassette"]') ||
        document.querySelector('.property-item');

      if (!card) return { error: 'No property card found' };

      const getText = (sel: string, parent: Element | Document = document) => {
        const el = parent.querySelector(sel);
        return el?.textContent?.trim() || '';
      };

      // SUUMO typical selectors
      return {
        cardClass: card.className,
        name: getText('.cassetteitem_content-title, [class*="content-title"], h2, h3', card),
        address: getText('.cassetteitem_detail-col1, [class*="address"], [class*="detail-col1"]', card),
        station: getText('.cassetteitem_detail-col2, [class*="station"], [class*="detail-col2"]', card),
        cardHTML: card.innerHTML.substring(0, 2000)
      };
    });
    console.log('First property data:', JSON.stringify(firstProperty, null, 2));

    // Step 13: Try different search URLs if the first attempt didn't work
    if (page.url() !== tozaiSearchUrl) {
      console.log('\n=== STEP 13: Trying alternative URL format ===');

      // Try another format
      const altUrl = 'https://suumo.jp/chintai/tokyo/ensen/?rosen=ec-00024010';
      await page.goto(altUrl, { waitUntil: 'networkidle', timeout: 30000 });
      console.log('Alt URL result:', page.url());
      await takeScreenshot(page, 'suumo_step8.png');
    }

    // Summary
    console.log('\n========== FINAL SUMMARY ==========');
    console.log('Final working URL:', page.url());
    console.log('\nTo search 東西線 with 1K/1R and under 10万円, use:');
    console.log('Parameters: md[]=01 (1R), md[]=02 (1K), ts[]=0400000 (under 10万)');

  } catch (error) {
    console.error('Error:', error);
    await takeScreenshot(page, 'suumo_error.png');
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
