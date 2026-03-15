#!/usr/bin/env node
/**
 * update-events.js
 * Runs on GitHub Actions once a week (Sunday 08:00 UTC).
 * Calls SerpAPI, writes data/live-events.json → Cloudflare Pages auto-deploys.
 * Uses ~10 queries/run × 4 runs/month = ~40 searches/month (under 100 free limit).
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE  = join(__dirname, '../data/live-events.json');

// ── API KEY (from GitHub Secrets) ────────────────────────────────────────────
const API_KEY = process.env.SERPAPI_KEY_1;

if (!API_KEY) {
  console.error('No SERPAPI_KEY_1 env var set. Add it as a GitHub Secret.');
  process.exit(1);
}

// ── QUERIES — rotated daily, 3/day × 31 days = ~93/month (under 100 free limit)
const ALL_QUERIES = [
  { q: 'soccer football player meet greet autograph signing 2026',     lang: 'en' },
  { q: 'NBA basketball player autograph signing meet greet 2026',      lang: 'en' },
  { q: 'celebrity actor musician meet greet fan signing event 2026',   lang: 'en' },
  { q: 'comic con celebrity autograph photo op fan meet 2026',         lang: 'en' },
  { q: 'WWE MMA boxing fighter meet greet autograph fan event 2026',   lang: 'en' },
  { q: 'NFL MLB NBA autograph signing card show convention 2026',      lang: 'en' },
  { q: 'fan expo celebrity guest autograph signing 2026',              lang: 'en' },
  { q: 'athlete autograph signing VIP fan experience 2026',            lang: 'en' },
  { q: 'firma autografos futbolista OR autografi calciatore 2026',     lang: 'en' },
  { q: 'meet and greet sports player autograph signing 2026',          lang: 'en' },
];
// Pick 3 queries for today based on day-of-year, cycling through all 10
const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(),0,0)) / 86400000);
const QUERIES = [0,1,2].map(i => ALL_QUERIES[(dayOfYear * 3 + i) % ALL_QUERIES.length]);

const RELEVANT_WORDS = [
  'meet','sign','greet','autograph','dinner','firma','dédicace','autografi',
  'incontro','légende','leyenda','autogramm','signing','book signing',
  'book tour','vip package','vip meet','fan event','fan day',
  'player appearance','athlete appearance',
];

const LANG_NAMES = { fr:'French', it:'Italian', es:'Spanish', de:'German' };

// ── DATE GUESSER ─────────────────────────────────────────────────────────────
function guessDate(t) {
  const m = {
    january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
  };
  for (const [n, v] of Object.entries(m)) {
    const x = t.match(new RegExp(n + '\\s+(\\d{1,2})[,\\s]+2026'));
    if (x) return `2026-${v}-${x[1].padStart(2,'0')}`;
  }
  return null;
}

// ── FETCH ─────────────────────────────────────────────────────────────────────
async function fetchWithRetry(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.status === 401 || r.status === 402 || r.status === 429) return null;
      if (!r.ok) return null;
      const data = await r.json();
      if (data.error && /run out|quota|credit|limit/i.test(data.error)) return null;
      return data;
    } catch { /* retry */ }
  }
  return null;
}

function parseOrganic(data, lang) {
  const out = [];
  for (const res of (data.organic_results || [])) {
    const combined = (res.title + ' ' + (res.snippet || '')).toLowerCase();
    if (!RELEVANT_WORDS.some(w => combined.includes(w))) continue;
    if (!combined.includes('2026')) continue;
    if (!res.link) continue;
    if (/mail-?in signing|ship your|private signing/.test(combined)) continue;

    const isBball = /basketball|nba/.test(combined);
    const isPol   = !isBball && /senator|president|governor|politician/.test(combined);
    const isCeleb = !isBball && !isPol && /actor|actress|musician|singer|comedian|comic.?con|fan.?expo|celebrity/.test(combined);
    const isOther = !isBball && !isPol && !isCeleb && /gymnast|olympic|nfl|mlb|baseball|nhl|hockey|mma|ufc|boxing|wwe|card show/.test(combined);

    out.push({
      id:     `live_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      player: res.title.substring(0, 80),
      sport:  isBball ? 'basketball' : isPol ? 'politics' : isCeleb ? 'celeb' : isOther ? 'other' : 'soccer',
      date:   guessDate(combined) || new Date().toISOString().split('T')[0],
      venue:  '',
      city:   '',
      link:   res.link,
      notes:  (res.snippet || '').substring(0, 200) + (lang !== 'en' ? ` [${LANG_NAMES[lang] || lang}]` : ''),
      source: res.displayed_link || 'Web search',
    });
  }
  return out;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Starting update — ${new Date().toISOString()}`);

  const results = [];

  for (const { q, lang } of QUERIES) {
    console.log(`  Searching: "${q.substring(0, 60)}"`);
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&num=10&api_key=${API_KEY}`;
    const data = await fetchWithRetry(url);
    if (data) {
      const found = parseOrganic(data, lang);
      console.log(`    → ${found.length} results`);
      results.push(...found);
    } else {
      console.log(`    → no data (quota or error)`);
    }
    await new Promise(r => setTimeout(r, 1100));
  }

  // De-duplicate by link
  const seen   = new Set();
  const unique = results.filter(e => {
    if (!e.link || seen.has(e.link)) return false;
    seen.add(e.link);
    return true;
  });

  // Filter to future events only
  const today = new Date(); today.setHours(0,0,0,0);
  const future = unique.filter(e => new Date(e.date + 'T12:00:00') >= today);

  console.log(`Found ${future.length} live events (from ${results.length} raw results)`);

  mkdirSync(join(__dirname, '../data'), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: future.length,
    events: future,
  }, null, 2));

  console.log(`Written to ${OUT_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
