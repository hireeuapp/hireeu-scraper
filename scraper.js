import { chromium } from 'playwright';

const DELAY_MS = 1500;
const MAX_PER_SITE = 20;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── JustJoinIT ──────────────────────────────────────────────────────────────
async function scrapeJustJoinIT(context, role) {
  const results = [];
  const listPage = await context.newPage();

  try {
    const url = role
      ? `https://justjoin.it/all-locations?keyword=${encodeURIComponent(role)}`
      : 'https://justjoin.it/all-locations';

    await listPage.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
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
        const title = card.querySelector('h3')?.innerText?.trim() || '';
        const spans = card.querySelectorAll('span');
        const company = [...spans].map(s => s.innerText?.trim())
          .find(t => t && !t.includes('Salary') && !t.match(/^[\d,\s]+$/) && t.length > 1) || '';
        const location = spans[1]?.innerText?.trim() || '';
        if (!title) continue;
        jobs.push({ url, title, company, location });
      }
      return jobs;
    }, MAX_PER_SITE);

    await listPage.close();

    const detailPage = await context.newPage();
    for (const listing of listings) {
      try {
        await detailPage.goto(listing.url, { waitUntil: 'networkidle', timeout: 20000 });
        const description = await detailPage.evaluate(() => {
          const el = document.querySelector('[class*="description"]') ||
            document.querySelector('article') || document.querySelector('main');
          return el ? el.innerText.trim().slice(0, 3000) : '';
        });
        results.push({
          id: 'jjit_' + encodeURIComponent(listing.url),
          title: listing.title,
          company: listing.company,
          location: listing.location,
          description,
          applyUrl: listing.url,
          source: 'JustJoinIT',
        });
        await sleep(DELAY_MS);
      } catch (err) {
        console.error(`JJIT detail failed: ${err.message}`);
        results.push({ id: 'jjit_' + encodeURIComponent(listing.url), ...listing, applyUrl: listing.url, description: '', source: 'JustJoinIT' });
      }
    }
    await detailPage.close();
  } catch (err) {
    console.error('JustJoinIT scrape failed:', err.message);
    try { await listPage.close(); } catch {}
  }

  console.log(`JustJoinIT: ${results.length} jobs`);
  return results;
}

// ── NoFluffJobs ─────────────────────────────────────────────────────────────
// No detail page visits — their pages crash the container due to heavy JS
// Listing cards already contain enough data (title, company, location, url)
async function scrapeNoFluffJobs(context, role) {
  const results = [];
  const page = await context.newPage();

  try {
    const url = role
      ? `https://nofluffjobs.com/pl?criteria=keyword%3D${encodeURIComponent(role)}`
      : 'https://nofluffjobs.com/pl';

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('a[href*="/pl/job/"]', { timeout: 15000 });

    const listings = await page.evaluate((max) => {
      const cards = document.querySelectorAll('a[href*="/pl/job/"]');
      const seen = new Set();
      const jobs = [];
      for (const card of cards) {
        if (jobs.length >= max) break;
        const href = card.href;
        if (!href || seen.has(href)) continue;
        seen.add(href);
        const title = card.querySelector('h3, h2, [class*="title"]')?.innerText?.trim() || '';
        const company = card.querySelector('[class*="company"], [class*="employer"]')?.innerText?.trim() || '';
        const location = card.querySelector('[class*="location"], [class*="city"]')?.innerText?.trim() || '';
        if (!title) continue;
        jobs.push({ url: href, title, company, location });
      }
      return jobs;
    }, MAX_PER_SITE);

    await page.close();

    // Push directly from listing data — no detail page visits
    for (const listing of listings) {
      results.push({
        id: 'nfj_' + encodeURIComponent(listing.url),
        title: listing.title,
        company: listing.company,
        location: listing.location,
        description: '',
        applyUrl: listing.url,
        source: 'NoFluffJobs',
      });
    }
  } catch (err) {
    console.error('NoFluffJobs scrape failed:', err.message);
    try { await page.close(); } catch {}
  }

  console.log(`NoFluffJobs: ${results.length} jobs`);
  return results;
}

// ── EnglishJobs.pl ──────────────────────────────────────────────────────────
async function scrapeEnglishJobs(context, role) {
  const results = [];
  const page = await context.newPage();

  try {
    const url = role
      ? `https://englishjobs.pl/jobs/all?q=${encodeURIComponent(role)}`
      : 'https://englishjobs.pl/jobs/all';

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Log the page HTML to debug selectors
    const bodyPreview = await page.evaluate(() => document.body.innerText.slice(0, 800));
    console.log('EnglishJobs body preview:', bodyPreview);

    const linkCount = await page.evaluate(() =>
      document.querySelectorAll('a').length
    );
    console.log('EnglishJobs total links:', linkCount);

    // Try broader selector — englishjobs uses /offer/ or /job/ paths
    const listings = await page.evaluate((max) => {
      // Try multiple link patterns
      const selectors = ['a[href*="/job/"]', 'a[href*="/offer/"]', 'a[href*="/oferta/"]'];
      let cards = [];
      for (const sel of selectors) {
        const found = [...document.querySelectorAll(sel)];
        if (found.length > 0) { cards = found; break; }
      }

      const seen = new Set();
      const jobs = [];
      for (const card of cards) {
        if (jobs.length >= max) break;
        const href = card.href;
        if (!href || seen.has(href) || href.includes('/jobs/')) continue;
        seen.add(href);

        // Walk up to find a container with more info
        const container = card.closest('li, article, div[class*="card"], div[class*="job"], div[class*="offer"]') || card;
        const title =
          container.querySelector('h2, h3, h4, [class*="title"], [class*="position"]')?.innerText?.trim() ||
          card.innerText?.trim().split('\n')[0] || '';
        const company = container.querySelector('[class*="company"], [class*="employer"]')?.innerText?.trim() || '';
        const location = container.querySelector('[class*="location"], [class*="city"], [class*="place"]')?.innerText?.trim() || '';

        if (!title || title.length < 3) continue;
        jobs.push({ url: href, title, company, location });
      }
      return jobs;
    }, MAX_PER_SITE);

    console.log(`EnglishJobs listings found: ${listings.length}`);
    await page.close();

    const detailPage = await context.newPage();
    for (const listing of listings) {
      try {
        await detailPage.goto(listing.url, { waitUntil: 'networkidle', timeout: 20000 });
        const { description, company, location } = await detailPage.evaluate(() => {
          const desc = document.querySelector('[class*="description"]') ||
            document.querySelector('article') || document.querySelector('main');
          const company = document.querySelector('[class*="company"]')?.innerText?.trim() || '';
          const location = document.querySelector('[class*="location"]')?.innerText?.trim() || '';
          return {
            description: desc ? desc.innerText.trim().slice(0, 3000) : '',
            company,
            location,
          };
        });
        results.push({
          id: 'ej_' + encodeURIComponent(listing.url),
          title: listing.title,
          company: company || listing.company,
          location: location || listing.location,
          description,
          applyUrl: listing.url,
          source: 'EnglishJobs.pl',
        });
        await sleep(DELAY_MS);
      } catch (err) {
        console.error(`EJ detail failed: ${err.message}`);
        results.push({ id: 'ej_' + encodeURIComponent(listing.url), ...listing, applyUrl: listing.url, description: '', source: 'EnglishJobs.pl' });
      }
    }
    await detailPage.close();
  } catch (err) {
    console.error('EnglishJobs scrape failed:', err.message);
    try { await page.close(); } catch {}
  }

  console.log(`EnglishJobs.pl: ${results.length} jobs`);
  return results;
}

// ── Main export ─────────────────────────────────────────────────────────────
export async function scrapeAllSites(role = '') {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });

  let results = [];

  try {
    const jjit = await scrapeJustJoinIT(context, role);
    const nfj  = await scrapeNoFluffJobs(context, role);
    const ej   = await scrapeEnglishJobs(context, role);
    results = [...jjit, ...nfj, ...ej];
  } finally {
    await browser.close();
  }

  console.log(`Total scraped: ${results.length} jobs`);
  return results;
}
