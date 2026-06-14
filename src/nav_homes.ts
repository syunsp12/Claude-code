import { chromium } from 'playwright';
import * as fs from 'fs';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const URLS = [
  'https://www.homes.co.jp/chintai/tokyo/tozai/list/',
  'https://www.homes.co.jp/chintai/tokyo/',
  'https://www.homes.co.jp/chintai/list/?ar=030&bs=040&rosen=00039840',
];

interface PageResult {
  url: string;
  finalUrl: string;
  status: number | null;
  hasListings: boolean;
  screenshotPath: string;
  bodyHtml: string;
  selectors: Record<string, string>;
  listingCount: number;
  notes: string;
}

async function checkPage(browser: any, url: string, screenshotPath: string): Promise<PageResult> {
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  let status: number | null = null;

  page.on('response', (response: any) => {
    if (response.url() === url || response.url() === page.url()) {
      status = response.status();
    }
  });

  console.log(`\n=== Checking: ${url} ===`);

  try {
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    if (response) {
      status = response.status();
    }

    const finalUrl = page.url();
    console.log(`  Final URL: ${finalUrl}`);
    console.log(`  Status: ${status}`);

    // Wait a bit for dynamic content
    await page.waitForTimeout(2000);

    // Take screenshot
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`  Screenshot saved: ${screenshotPath}`);

    // Get body HTML (first 3000 chars)
    const bodyHtml = await page.evaluate(() => {
      return document.body.innerHTML.substring(0, 3000);
    });

    // Try to detect property listings with various selectors
    const selectorCandidates = {
      // Common HOMES property card selectors
      propertyCard: [
        '.mod-mergeBuilding--rent',
        '.mod-mergeBuilding',
        '.icoBox',
        '.listItem',
        '.bukken-list-item',
        '[class*="bukken"]',
        '[class*="property"]',
        '[class*="listing"]',
        '[class*="item--"]',
        '.item-box',
        '.cassetteItem',
        'article',
        '.mod-property',
        '[data-bukken]',
        '.search-result-item',
        '.result-item',
        'li.item',
      ],
      propertyName: [
        '.mod-mergeBuilding__title',
        '.bukken-name',
        '.property-name',
        '.building-name',
        'h2.name',
        '.name a',
        '[class*="buildingName"]',
        '[class*="name"]',
      ],
      address: [
        '.mod-mergeBuilding__address',
        '.address',
        '.bukken-address',
        '[class*="address"]',
        '[class*="Address"]',
      ],
      station: [
        '.mod-mergeBuilding__station',
        '.station',
        '.access',
        '[class*="station"]',
        '[class*="Station"]',
        '[class*="access"]',
      ],
      rent: [
        '.mod-mergeBuilding__rent',
        '.rent',
        '.price',
        '[class*="rent"]',
        '[class*="Rent"]',
        '[class*="price"]',
        '[class*="Price"]',
      ],
      managementFee: [
        '[class*="kanri"]',
        '[class*="management"]',
        '[class*="fee"]',
        '.kanrihi',
      ],
      floorPlan: [
        '[class*="madori"]',
        '[class*="floorPlan"]',
        '[class*="floor-plan"]',
        '.madori',
        '[class*="layout"]',
      ],
      area: [
        '[class*="menseki"]',
        '[class*="area"]',
        '[class*="Area"]',
        '.area',
      ],
      builtYear: [
        '[class*="chikunen"]',
        '[class*="built"]',
        '[class*="year"]',
        '.chikunen',
        '[class*="age"]',
      ],
    };

    const foundSelectors: Record<string, string> = {};
    let listingCount = 0;
    let hasListings = false;

    // Check each selector category
    for (const [category, selectors] of Object.entries(selectorCandidates)) {
      for (const selector of selectors) {
        try {
          const count = await page.locator(selector).count();
          if (count > 0) {
            console.log(`  Found ${count} elements for selector: ${selector} (category: ${category})`);
            if (!foundSelectors[category]) {
              foundSelectors[category] = selector;
              if (category === 'propertyCard') {
                listingCount = count;
              }
            }
            break;
          }
        } catch (e) {
          // ignore selector errors
        }
      }
    }

    // Check for known error/no-result indicators
    const pageTitle = await page.title();
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log(`  Page title: ${pageTitle}`);
    console.log(`  Page text preview: ${pageText.substring(0, 200)}`);

    // Determine if we have actual listings
    hasListings = listingCount > 0 ||
      (foundSelectors['propertyCard'] !== undefined) ||
      pageText.includes('件') && !pageText.includes('該当する物件がありません') && !pageText.includes('0件');

    // Also try to find any class names that look like property items
    const allClasses = await page.evaluate(() => {
      const elements = document.querySelectorAll('[class]');
      const classes = new Set<string>();
      elements.forEach(el => {
        el.className.split(' ').forEach((c: string) => {
          if (c && (c.includes('item') || c.includes('list') || c.includes('property') ||
              c.includes('bukken') || c.includes('building') || c.includes('cassette') ||
              c.includes('result') || c.includes('rent') || c.includes('chintai'))) {
            classes.add(c);
          }
        });
      });
      return Array.from(classes).slice(0, 50);
    });

    console.log(`  Relevant CSS classes found: ${allClasses.join(', ')}`);

    // Try to get the actual property count from page text
    const countMatch = pageText.match(/(\d+)件/);
    const reportedCount = countMatch ? parseInt(countMatch[1]) : 0;
    console.log(`  Reported listing count: ${reportedCount}`);

    if (reportedCount > 0) {
      hasListings = true;
    }

    const result: PageResult = {
      url,
      finalUrl,
      status,
      hasListings,
      screenshotPath,
      bodyHtml,
      selectors: foundSelectors,
      listingCount: Math.max(listingCount, reportedCount),
      notes: `Title: ${pageTitle} | Classes: ${allClasses.join(', ')}`,
    };

    await context.close();
    return result;

  } catch (err) {
    console.log(`  Error: ${err}`);
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
    await context.close();

    return {
      url,
      finalUrl: url,
      status,
      hasListings: false,
      screenshotPath,
      bodyHtml: '',
      selectors: {},
      listingCount: 0,
      notes: `Error: ${err}`,
    };
  }
}

async function main() {
  console.log('Starting HOMES navigation script...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox'],
  });

  const results: PageResult[] = [];

  for (let i = 0; i < URLS.length; i++) {
    const url = URLS[i];
    const screenshotPath = `/home/user/Claude-code/homes_step${i + 1}.png`;
    const result = await checkPage(browser, url, screenshotPath);
    results.push(result);
  }

  await browser.close();

  console.log('\n\n========== SUMMARY ==========\n');

  const workingUrls = results.filter(r => r.hasListings);

  if (workingUrls.length === 0) {
    console.log('NO working URLs found that return property listings.\n');
    results.forEach(r => {
      console.log(`URL: ${r.url}`);
      console.log(`  Final URL: ${r.finalUrl}`);
      console.log(`  Status: ${r.status}`);
      console.log(`  Has listings: ${r.hasListings}`);
      console.log(`  Notes: ${r.notes}`);
      console.log(`  Body HTML (first 3000 chars):\n${r.bodyHtml}\n`);
    });
  } else {
    console.log(`Found ${workingUrls.length} working URL(s):\n`);
    workingUrls.forEach(r => {
      console.log(`Working URL: ${r.url}`);
      console.log(`  Final URL: ${r.finalUrl}`);
      console.log(`  Status: ${r.status}`);
      console.log(`  Listing count: ${r.listingCount}`);
      console.log(`  CSS Selectors found:`);
      Object.entries(r.selectors).forEach(([cat, sel]) => {
        console.log(`    ${cat}: ${sel}`);
      });
      console.log(`  Notes: ${r.notes}`);
      console.log(`  Screenshot: ${r.screenshotPath}`);
      console.log('\n  Body HTML (first 3000 chars):');
      console.log(r.bodyHtml);
      console.log('\n');
    });
  }

  // Save full results to JSON
  const outputPath = '/home/user/Claude-code/homes_results.json';
  fs.writeFileSync(outputPath, JSON.stringify(results.map(r => ({
    ...r,
    bodyHtml: r.bodyHtml, // full 3000 chars
  })), null, 2));
  console.log(`\nFull results saved to: ${outputPath}`);
}

main().catch(console.error);
