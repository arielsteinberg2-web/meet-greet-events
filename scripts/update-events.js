#!/usr/bin/env node
/**
 * update-events.js
 * Runs on GitHub Actions every 6 hours.
 * Queries Eventbrite API for meet & greet / fan experience events,
 * writes data/live-events.json → Cloudflare Pages auto-deploys.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE  = join(__dirname, '../data/live-events.json');

// ── API TOKEN (from GitHub Secrets) ─────────────────────────────────────────
const EB_TOKEN = process.env.EVENTBRITE_TOKEN;

if (!EB_TOKEN) {
  console.error('No EVENTBRITE_TOKEN env var set. Add it as a GitHub Secret.');
  process.exit(1);
}

const BASE = 'https://www.eventbriteapi.com/v3';

// ── SEARCH KEYWORDS ──────────────────────────────────────────────────────────
const QUERIES = [
  'meet and greet',
  'autograph signing',
  'VIP fan experience',
  'fan meet greet',
  'player signing',
  'athlete appearance',
  'celebrity meet greet',
  'book signing',
  'fan experience',
  'photo op',
];

// ── SPORT CLASSIFIER ─────────────────────────────────────────────────────────
function classifySport(text) {
  const t = text.toLowerCase();
  if (/basketball|nba|nbl/.test(t))                          return 'basketball';
  if (/senator|congress|president|governor|politician/.test(t)) return 'politics';
  if (/actor|actress|musician|singer|comedian|comic.?con|fan.?expo|celebrity/.test(t)) return 'celeb';
  if (/gymnast|olympic|swimmer|nfl|mlb|baseball|nhl|hockey|mma|ufc|boxing|wwe/.test(t)) return 'other';
  return 'soccer';
}

// ── FETCH HELPERS ─────────────────────────────────────────────────────────────
async function fetchJSON(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${EB_TOKEN}` },
    });
    clearTimeout(t);
    if (!r.ok) {
      console.warn(`  HTTP ${r.status} for ${url.substring(0, 80)}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn(`  Fetch error: ${e.message}`);
    return null;
  }
}

// ── PARSE EVENTBRITE RESULTS ─────────────────────────────────────────────────
function parseEvents(data) {
  const out = [];
  for (const ev of (data?.events || [])) {
    if (!ev.name?.text) continue;
    if (ev.status === 'canceled' || ev.listed === false) continue;

    const start   = ev.start?.local || ev.start?.utc || '';
    const isoDate = start ? start.split('T')[0] : new Date().toISOString().split('T')[0];

    // Skip past events
    if (new Date(isoDate) < new Date(new Date().toISOString().split('T')[0])) continue;

    const venueName = ev.venue?.name || '';
    const city      = ev.venue?.address?.city || '';
    const country   = ev.venue?.address?.country || '';
    const cityStr   = [city, country].filter(Boolean).join(', ');

    out.push({
      id:     `eb_${ev.id}`,
      player: ev.name.text.substring(0, 80),
      sport:  classifySport(ev.name.text + ' ' + (ev.description?.text || '')),
      date:   isoDate,
      venue:  venueName,
      city:   cityStr,
      link:   ev.url || '',
      notes:  (ev.description?.text || '').replace(/\s+/g, ' ').substring(0, 200),
      source: 'Eventbrite',
    });
  }
  return out;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Starting update — ${new Date().toISOString()}`);

  const results = [];
  const today = new Date().toISOString().split('T')[0];

  for (const q of QUERIES) {
    console.log(`  Searching: "${q}"`);
    const url = `${BASE}/events/search/?q=${encodeURIComponent(q)}&start_date.range_start=${today}T00:00:00&expand=venue&page_size=50`;
    const data = await fetchJSON(url);
    if (data) {
      const found = parseEvents(data);
      console.log(`    → ${found.length} events`);
      results.push(...found);
    }
    await new Promise(r => setTimeout(r, 500)); // 0.5s between requests
  }

  // De-duplicate by event ID
  const seen  = new Set();
  const unique = results.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  console.log(`Found ${unique.length} live events (from ${results.length} raw results)`);

  mkdirSync(join(__dirname, '../data'), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: unique.length,
    events: unique,
  }, null, 2));

  console.log(`Written to ${OUT_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
