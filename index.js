import express from 'express';
import { scrapeAll, scrapeJustJoinIT, scrapeNoFluffJobs } from './scraper.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Main endpoint — runs both JustJoinIT + NoFluffJobs, returns deduplicated results
app.get('/scrape', async (req, res) => {
  const role = req.query.role || '';
  try {
    console.log(`Scraping all sources for: "${role}"`);
    const jobs = await scrapeAll(role);
    console.log(`Done — ${jobs.length} jobs returned`);
    res.json({ jobs });
  } catch (err) {
    console.error('Scrape failed:', err.message);
    res.status(500).json({ error: err.message, jobs: [] });
  }
});

// Individual source endpoints (useful for debugging)
app.get('/scrape/jjit', async (req, res) => {
  const role = req.query.role || '';
  try {
    const jobs = await scrapeJustJoinIT(role);
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: err.message, jobs: [] });
  }
});

app.get('/scrape/nofluff', async (req, res) => {
  const role = req.query.role || '';
  try {
    const jobs = await scrapeNoFluffJobs(role);
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: err.message, jobs: [] });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Scraper server running on port ${PORT}`));
