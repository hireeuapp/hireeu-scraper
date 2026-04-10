import express from 'express';
import { scrapeJustJoinIT } from './scraper.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Simple secret check so random people can't abuse your server
const SECRET = process.env.SCRAPER_SECRET;

app.get('/scrape', async (req, res) => {
  if (SECRET && req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const role = req.query.role || '';

  try {
    console.log(`Scraping JustJoinIT for: "${role}"`);
    const jobs = await scrapeJustJoinIT(role);
    console.log(`Done — ${jobs.length} jobs returned`);
    res.json({ jobs });
  } catch (err) {
    console.error('Scrape failed:', err.message);
    res.status(500).json({ error: err.message, jobs: [] });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Scraper server running on port ${PORT}`));
