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

        // Title is in h3
        const title = card.querySelector('h3')?.innerText?.trim() || '';

        // Company name is in the img alt with id="offerCardCompanyLogo"
        // but the alt is the job title — instead grab the first span after h3
        // which contains company name based on MUI structure
        const spans = card.querySelectorAll('span');
        const company = spans.length > 0 ? spans[0].innerText?.trim() : '';

        // Location: look for spans that contain city names
        // They appear after company in the card spans
        const location = spans.length > 1 ? spans[1].innerText?.trim() : '';

        if (!title) continue;
        jobs.push({ url, title, company, location });
      }
      return jobs;
    }, MAX_JOBS);

    console.log('Listings extracted:', listings.length);
    if (listings.length > 0) console.log('First listing:', JSON.stringify(listings[0]));

    await listPage.close();

    // Match role against title — keep filter loose, min word length 2
    const roleLower = role.toLowerCase();
    const roleWords = roleLower.split(/\s+/).filter(w => w.length > 1);

    const filtered = role
      ? listings.filter(j => roleWords.some(w => j.title.toLowerCase().includes(w)))
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
