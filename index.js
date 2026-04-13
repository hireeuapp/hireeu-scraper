import express from 'express';
import { scrapeAllSites } from './scraper.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/scrape', async (req, res) => {
  const role = req.query.role || '';

  try {
    console.log(`Scraping all sites for: "${role}"`);
    const jobs = await scrapeAllSites(role);
    console.log(`Done — ${jobs.length} jobs returned`);
    res.json({ jobs });
  } catch (err) {
    console.error('Scrape failed:', err.message);
    res.status(500).json({ error: err.message, jobs: [] });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Scraper server running on port ${PORT}`));
