import express from 'express';
import { scrapeAllSites } from './scraper.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ── In-memory cache ──────────────────────────────────────────────────────────
// Key: normalised role string  →  { jobs, cachedAt, status }
// status: 'pending' | 'done' | 'error'
const cache = new Map();

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function cacheKey(role) {
  return role.trim().toLowerCase();
}

function isFresh(entry) {
  return entry && (Date.now() - entry.cachedAt) < CACHE_TTL_MS;
}

// ── Background scrape helper ─────────────────────────────────────────────────
function triggerScrape(role) {
  const key = cacheKey(role);

  // Already running or fresh result — do nothing
  const existing = cache.get(key);
  if (existing && (existing.status === 'pending' || isFresh(existing))) return;

  // Mark as pending immediately so parallel requests don't double-fire
  cache.set(key, { status: 'pending', jobs: [], cachedAt: Date.now() });

  console.log(`[cache] Starting background scrape for: "${role}"`);

  scrapeAllSites(role)
    .then(jobs => {
      console.log(`[cache] Scrape done for "${role}" — ${jobs.length} jobs`);
      cache.set(key, { status: 'done', jobs, cachedAt: Date.now() });
    })
    .catch(err => {
      console.error(`[cache] Scrape failed for "${role}":`, err.message);
      cache.set(key, { status: 'error', jobs: [], cachedAt: Date.now() });
    });
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Original blocking endpoint (kept for backward compat / manual use)
app.get('/scrape', async (req, res) => {
  const role = req.query.role || '';
  try {
    console.log(`[sync] Scraping for: "${role}"`);
    const jobs = await scrapeAllSites(role);
    console.log(`[sync] Done — ${jobs.length} jobs`);
    // Also populate the cache so /scrape-cached benefits
    cache.set(cacheKey(role), { status: 'done', jobs, cachedAt: Date.now() });
    res.json({ jobs });
  } catch (err) {
    console.error('[sync] Scrape failed:', err.message);
    res.status(500).json({ error: err.message, jobs: [] });
  }
});

// Fire-and-forget: triggers a background scrape, returns immediately
// Response: { triggered: true } or { triggered: false, reason: '...' }
app.get('/scrape-async', (req, res) => {
  const role = req.query.role || '';
  if (!role) return res.status(400).json({ error: 'Missing role' });

  const key = cacheKey(role);
  const existing = cache.get(key);

  if (existing?.status === 'pending') {
    return res.json({ triggered: false, reason: 'already_pending' });
  }
  if (isFresh(existing)) {
    return res.json({ triggered: false, reason: 'cache_fresh' });
  }

  triggerScrape(role);
  res.json({ triggered: true });
});

// Return cached results (or empty if not ready yet)
// Response: { status, jobs, cachedAt }
app.get('/scrape-cached', (req, res) => {
  const role = req.query.role || '';
  if (!role) return res.status(400).json({ error: 'Missing role' });

  const key = cacheKey(role);
  const entry = cache.get(key);

  if (!entry) {
    // Nothing in cache — kick off a scrape for next time
    triggerScrape(role);
    return res.json({ status: 'pending', jobs: [], cachedAt: null });
  }

  if (!isFresh(entry)) {
    // Stale — refresh in background, return old results for now
    triggerScrape(role);
    return res.json({ status: 'stale', jobs: entry.jobs, cachedAt: entry.cachedAt });
  }

  res.json({ status: entry.status, jobs: entry.jobs, cachedAt: entry.cachedAt });
});

// Cache status / debug
app.get('/cache-status', (req, res) => {
  const entries = [];
  for (const [key, val] of cache.entries()) {
    entries.push({
      role: key,
      status: val.status,
      jobCount: val.jobs.length,
      ageSeconds: Math.round((Date.now() - val.cachedAt) / 1000),
      fresh: isFresh(val),
    });
  }
  res.json({ entries, count: entries.length });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Scraper server running on port ${PORT}`));
