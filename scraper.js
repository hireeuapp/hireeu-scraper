import { chromium } from 'playwright';

const MAX_JOBS = 30;
const DELAY_MS = 800;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// JustJoinIT — intercept the internal API calls the SPA makes.
// The old /api/offers endpoint is dead since late 2023.
// The current site is a React/MUI SPA. Best approach: intercept
// the XHR/fetch calls it fires to its own backend for JSON data.
// ─────────────────────────────────────────────────────────────
export async function scrapeJustJoinIT(role = '') {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  let capturedJobs = [];

  // Intercept API responses before they reach the DOM
  context.on('response', async (response) => {
    const url = response.url();
    if (
      (url.includes('justjoin.it') || url.includes('jjit')) &&
      (url.includes('/offers') || url.includes('/jobs') || url.includes('/listings') || url.includes('/search'))
    ) {
      try {
        const ct = response.headers()['content-type'] || '';
        if (!ct.includes('json')) return;
        const data = await response.json();
        const items = Array.isArray(data)
          ? data
          : data.data || data.offers || data.jobs || data.results || [];
        if (items.length > 0) {
          console.log(`[JJIT] Intercepted ${items.length} jobs from ${url}`);
          capturedJobs.push(...items);
        }
      } catch (_) {}
    }
  });

  const page = await context.newPage();
  const searchUrl = role
    ? `https://justjoin.it/job-offers?keyword=${encodeURIComponent(role)}`
    : 'https://justjoin.it/job-offers';

  try {
    console.log(`[JJIT] Navigating to ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 45000 });
    await sleep(3000);

    // Fallback: scrape rendered DOM if interception got nothing
    if (capturedJobs.length === 0) {
      console.log('[JJIT] No XHR jobs captured — falling back to DOM scrape');
      capturedJobs = await page.evaluate(() => {
        const jobs = [];
        const selectors = [
          'a[href*="/job-offer/"]',
          'a[href*="/offers/"]',
          '[data-index] a',
          'li[data-id] a',
        ];
        let cards = [];
        for (const sel of selectors) {
          cards = [...document.querySelectorAll(sel)];
          if (cards.length > 0) break;
        }
        const seen = new Set();
        for (const card of cards) {
          if (jobs.length >= 40) break;
          const url = card.href;
          if (!url || seen.has(url)) continue;
          seen.add(url);

          const title =
            card.querySelector('h2,h3,h4,[class*="title"],[class*="Title"]')
              ?.innerText?.trim() || '';
          const logo = card.querySelector('img[alt]');
          const spans = card.querySelectorAll('span,p');
          const company =
            (logo?.alt && logo.alt !== title ? logo.alt : null) ||
            spans[0]?.innerText?.trim() || '';
          const location = spans[1]?.innerText?.trim() || '';

          if (!title) continue;
          jobs.push({ slug: url.split('/').pop(), title, companyName: company, city: location, link: url });
        }
        return jobs;
      });
      console.log(`[JJIT] DOM scraped ${capturedJobs.length} cards`);
    }
  } catch (err) {
    console.error('[JJIT] Page load error:', err.message);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  if (capturedJobs.length === 0) {
    console.warn('[JJIT] Zero results');
    return [];
  }

  const roleLower = role.toLowerCase();
  const roleWords = roleLower.split(/\s+/).filter(w => w.length > 1);

  const normalised = capturedJobs.map(j => ({
    id: j.slug || j.id || j.link || String(Math.random()),
    title: j.title || j.jobTitle || '',
    company: j.companyName || j.company || '',
    location: j.city || j.location || 'Poland',
    description: [
      j.title,
      j.companyName,
      ...(j.requiredSkills || j.skills || []),
      j.workplaceType || '',
      j.experienceLevel || '',
    ].filter(Boolean).join(' — '),
    applyUrl: j.link || (j.slug ? `https://justjoin.it/job-offer/${j.slug}` : ''),
    source: 'Poland',
  }));

  const filtered = role
    ? normalised.filter(j => roleWords.some(w => j.title.toLowerCase().includes(w)))
    : normalised;

  console.log(`[JJIT] Returning ${filtered.length} jobs`);
  return filtered.slice(0, MAX_JOBS);
}

// ─────────────────────────────────────────────────────────────
// NoFluffJobs — secondary source, Poland-focused, partially SSR
// ─────────────────────────────────────────────────────────────
export async function scrapeNoFluffJobs(role = '') {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });

  const results = [];

  try {
    const page = await context.newPage();
    const searchUrl = role
      ? `https://nofluffjobs.com/jobs?criteria=city%3Dpoland+keyword%3D${encodeURIComponent(role)}`
      : 'https://nofluffjobs.com/jobs?criteria=city%3Dpoland';

    console.log(`[NFJ] Navigating to ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await sleep(2500);

    const jobs = await page.evaluate(() => {
      const cards = document.querySelectorAll(
        'a[href*="/job/"], [class*="posting-list-item"] a, nfj-postings-list a'
      );
      const seen = new Set();
      const out = [];

      for (const card of cards) {
        if (out.length >= 25) break;
        const url = card.href
          ? (card.href.startsWith('http') ? card.href : 'https://nofluffjobs.com' + card.href)
          : null;
        if (!url || seen.has(url) || !url.includes('/job/')) continue;
        seen.add(url);

        const title =
          card.querySelector('[class*="title"],[class*="Title"],h3,h2,strong')
            ?.innerText?.trim() || card.innerText?.split('\n')[0]?.trim() || '';
        const lines = (card.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
        const company = lines[1] || '';
        const location = lines[2] || 'Poland';

        if (!title) continue;
        out.push({ url, title, company, location });
      }
      return out;
    });

    console.log(`[NFJ] Scraped ${jobs.length} cards`);

    for (const job of jobs) {
      results.push({
        id: job.url,
        title: job.title,
        company: job.company,
        location: job.location,
        description: `${job.title} at ${job.company} — ${job.location}`,
        applyUrl: job.url,
        source: 'Poland',
      });
      await sleep(DELAY_MS);
    }

    await page.close();
  } catch (err) {
    console.error('[NFJ] Error:', err.message);
  } finally {
    await context.close();
    await browser.close();
  }

  return results.slice(0, MAX_JOBS);
}

// ─────────────────────────────────────────────────────────────
// Combined scrape — runs both sources, deduplicates by title+company
// ─────────────────────────────────────────────────────────────
export async function scrapeAll(role = '') {
  console.log(`[scrapeAll] Starting for role: "${role}"`);

  const [jjitResult, nfjResult] = await Promise.allSettled([
    scrapeJustJoinIT(role),
    scrapeNoFluffJobs(role),
  ]);

  const allJobs = [
    ...(jjitResult.status === 'fulfilled' ? jjitResult.value : []),
    ...(nfjResult.status === 'fulfilled' ? nfjResult.value : []),
  ];

  if (jjitResult.status === 'rejected') console.error('[JJIT] Failed:', jjitResult.reason);
  if (nfjResult.status === 'rejected') console.error('[NFJ] Failed:', nfjResult.reason);

  const seen = new Set();
  const deduped = allJobs.filter(j => {
    const key = `${j.title.toLowerCase().trim()}|${j.company.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[scrapeAll] Unique jobs: ${deduped.length}`);
  return deduped;
}
