import { chromium } from 'playwright';

const DELAY_MS = 1500;
const MAX_JOBS = 25;
const BASE_URL = 'https://justjoin.it';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function scrapeJustJoinIT(role = '') {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });

  const results = [];

  try {
    const listPage = await context.newPage();
    await listPage.goto(`${BASE_URL}/all-locations`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Debug — see what the page actually looks like
    const pageTitle = await listPage.title();
    const bodyPreview = await listPage.evaluate(() => document.body.innerText.slice(0, 500));
    const cardCount = await listPage.evaluate(() =>
      document.querySelectorAll('a[href*="/job-offer/"]').length
    );
    console.log('Page title:', pageTitle);
    console.log('Body preview:', bodyPreview);
    console.log('Job cards found:', cardCount);

    await listPage.waitForSelector('a[href*="/job-offer/"]', { timeout: 15000 });

    const listings = await listPage.evaluate((max) => {
      const cards = document.querySelectorAll('a[href*="/job-offer/"]');
      const seen = new Set();
      const jobs = [];

      for (const card of cards) {
        if (jobs.length >= max) break;
        const url = card.href;
        if (!url || seen.has(url)) continue;
        seen.add(url);

        const title =
          card.querySelector('h2, h3, [class*="title"], [class*="Title"]')?.innerText?.trim() || '';
        const company =
          card.querySelector('[class*="company"], [class*="Company"]')?.innerText?.trim() || '';
        const location =
          card.querySelector('[class*="location"], [class*="city"]')?.innerText?.trim() || '';

        if (!title) continue;
        jobs.push({ url, title, company, location });
      }
      return jobs;
    }, MAX_JOBS);

    console.log('Listings extracted:', listings.length);
    if (listings.length > 0) console.log('First listing:', JSON.stringify(listings[0]));

    await listPage.close();

    // Filter by role keyword before visiting detail pages
    const filtered = role
      ? listings.filter(j => j.title.toLowerCase().includes(role.toLowerCase()))
      : listings;

    console.log('After role filter:', filtered.length);

    const detailPage = await context.newPage();

    for (const listing of filtered) {
      try {
        await detailPage.goto(listing.url, {
          waitUntil: 'networkidle',
          timeout: 20000,
        });

        const description = await detailPage.evaluate(() => {
          const el =
            document.querySelector('[class*="description"]') ||
            document.querySelector('[class*="jobDescription"]') ||
            document.querySelector('article') ||
            document.querySelector('main');
          return el ? el.innerText.trim().slice(0, 3000) : '';
        });

        results.push({
          id: listing.url,
          title: listing.title,
          company: listing.company,
          location: listing.location,
          description,
          url: listing.url,
          source: 'JustJoinIT',
        });

        await sleep(DELAY_MS);
      } catch (err) {
        console.error(`Failed: ${listing.url} — ${err.message}`);
        results.push({
          id: listing.url,
          title: listing.title,
          company: listing.company,
          location: listing.location,
          description: '',
          url: listing.url,
          source: 'JustJoinIT',
        });
      }
    }

    await detailPage.close();
  } finally {
    await browser.close();
  }

  return results;
}
