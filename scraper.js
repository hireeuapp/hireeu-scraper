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

    // Debug: log the HTML of the first card so we can see real class names
    const firstCardHTML = await listPage.evaluate(() => {
      const card = document.querySelector('a[href*="/job-offer/"]');
      return card ? card.innerHTML.slice(0, 1000) : 'no card found';
    });
    console.log('First card HTML:', firstCardHTML);

    const listings = await listPage.evaluate((max) => {
      const cards = document.querySelectorAll('a[href*="/job-offer/"]');
      const seen = new Set();
      const jobs = [];

      for (const card of cards) {
        if (jobs.length >= max) break;
        const url = card.href;
        if (!url || seen.has(url)) continue;
        seen.add(url);

        // Try multiple selector strategies for title
        const title =
          card.querySelector('h2')?.innerText?.trim() ||
          card.querySelector('h3')?.innerText?.trim() ||
          card.querySelector('[class*="title"]')?.innerText?.trim() ||
          card.querySelector('[class*="Title"]')?.innerText?.trim() ||
          card.querySelector('[class*="name"]')?.innerText?.trim() ||
          card.querySelector('[class*="Name"]')?.innerText?.trim() ||
          // fallback: first non-empty text node
          [...card.querySelectorAll('div, span, p')]
            .map(el => el.childNodes)
            .flat()
            .filter(n => n.nodeType === 3 && n.textContent.trim().length > 3)
            .map(n => n.textContent.trim())[0] ||
          '';

        // Try multiple selector strategies for company
        const company =
          card.querySelector('[class*="company"]')?.innerText?.trim() ||
          card.querySelector('[class*="Company"]')?.innerText?.trim() ||
          card.querySelector('[class*="employer"]')?.innerText?.trim() ||
          card.querySelector('[class*="Employer"]')?.innerText?.trim() ||
          card.querySelector('[class*="firm"]')?.innerText?.trim() ||
          '';

        // Try multiple selector strategies for location
        const location =
          card.querySelector('[class*="location"]')?.innerText?.trim() ||
          card.querySelector('[class*="Location"]')?.innerText?.trim() ||
          card.querySelector('[class*="city"]')?.innerText?.trim() ||
          card.querySelector('[class*="City"]')?.innerText?.trim() ||
          card.querySelector('[class*="place"]')?.innerText?.trim() ||
          '';

        if (!title) continue;
        jobs.push({ url, title, company, location });
      }
      return jobs;
    }, MAX_JOBS);

    console.log('Listings extracted:', listings.length);
    if (listings.length > 0) console.log('First listing:', JSON.stringify(listings[0]));

    await listPage.close();

    // Loosened filter — match any word from role against title
    // Also skip filter entirely if role is very short (e.g. "QA")
    const roleLower = role.toLowerCase();
    const roleWords = roleLower.split(/\s+/).filter(w => w.length > 1);

    const filtered = role
      ? listings.filter(j => {
          const t = j.title.toLowerCase();
          return roleWords.some(w => t.includes(w));
        })
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
