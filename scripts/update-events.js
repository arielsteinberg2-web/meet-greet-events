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

// ── API KEYS (from GitHub Secrets) ───────────────────────────────────────────
const API_KEY_1 = process.env.SERPAPI_KEY_1;
const API_KEY_2 = process.env.SERPAPI_KEY_2;

if (!API_KEY_1) {
  console.error('No SERPAPI_KEY_1 env var set. Add it as a GitHub Secret.');
  process.exit(1);
}

// ── QUERIES — rotated daily, 3/day × 31 days = ~93/month (under 100 free limit)
const ALL_QUERIES = [
  { q: 'soccer football player meet greet autograph signing 2026',             lang: 'en' },
  { q: 'NBA basketball player autograph signing meet greet 2026',              lang: 'en' },
  { q: 'celebrity actor musician meet greet fan signing event 2026',           lang: 'en' },
  { q: 'comic con celebrity autograph photo op fan meet 2026',                 lang: 'en' },
  { q: 'WWE MMA boxing fighter meet greet autograph fan event 2026',           lang: 'en' },
  { q: 'NFL MLB NBA autograph signing card show convention 2026',              lang: 'en' },
  { q: 'athlete book signing tour meet author 2026',                           lang: 'en' },
  { q: 'sports star memoir autobiography book tour signing 2026',              lang: 'en' },
  { q: 'futbolista firma libros presentacion libro 2026',                      lang: 'es' },
  { q: 'sportif dédicace livre signature rencontre auteur 2026',               lang: 'fr' },
  { q: 'calciatore firma copie presentazione libro autobiografia 2026',        lang: 'it' },
  { q: 'Sportler Buchsignierung Buchmesse Lesung Autobiografie 2026',          lang: 'de' },
  { q: 'sporter boekpresentatie handtekening signeersessie 2026',              lang: 'nl' },
  { q: 'atleta lançamento livro sessão autógrafos autobiografia 2026',         lang: 'pt' },
  { q: 'firma autografos futbolista OR autografi calciatore 2026',             lang: 'en' },
  { q: 'meet and greet sports player autograph signing 2026',                  lang: 'en' },
];
// Split queries evenly between two keys — first 8 on key 1, last 8 on key 2
const QUERIES = ALL_QUERIES;

const RELEVANT_WORDS = [
  'meet','sign','greet','autograph','dinner','firma','dédicace','autografi',
  'incontro','légende','leyenda','autogramm','signing','book signing',
  'book tour','vip package','vip meet','fan event','fan day',
  'player appearance','athlete appearance',
  'firma libros','firma copie','buchsignierung','signeersessie',
  'sessão autógrafos','lançamento livro','presentación libro','presentazione libro',
];

const LANG_NAMES = { fr:'French', it:'Italian', es:'Spanish', de:'German' };

// ── PLAYER NAME EXTRACTOR ────────────────────────────────────────────────────
// Returns "First Last" style name from a title/snippet, or null if none found.
const NAME_SKIP = new Set([
  'Meet','Greet','Sign','Signing','Autograph','Event','Show','Expo','Fest','Fan',
  'Hall','Fame','World','Series','Spring','Summer','Fall','Winter','Card','Auto',
  'North','South','East','West','New','York','Los','Las','San','Join','The',
  'Get','Buy','Our','All','For','With','From','This','That','More','Just',
  'View','Post','Live','Register','Buy','Tickets','Photo','Only','Also',
  'Comic','Con','Convention','Appearances','Upcoming','Legends','Legend',
  'Sports','Athletes','Athlete','Players','Player','Stars','Guest','Guests',
]);
function extractPlayerName(title, snippet) {
  for (const text of [title, snippet]) {
    if (!text) continue;
    // Look for "Firstname Lastname" (2-3 capitalized words, no digits)
    const matches = text.match(/\b([A-Z][a-zÀ-ÿ'\-]+(?:\s+[A-Z][a-zÀ-ÿ'\-]+){1,2})\b/g) || [];
    for (const m of matches) {
      if (/\d/.test(m)) continue;
      const words = m.split(' ');
      if (words.some(w => NAME_SKIP.has(w))) continue;
      // Must look like a human name (not all-caps, not too short)
      if (words[0].length < 2 || words[1].length < 2) continue;
      return m;
    }
  }
  return null;
}

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

    const isBook  = /book signing|book tour|presents his book|firma libros|firma copie|d[eé]dicace.*livre|buchsignierung|signeersessie|sess[aã]o.*aut[oó]grafos|lançamento.*livro|autobiography|memoir|presentaci[oó]n.*libro|presentazione.*libro/.test(combined);
    const isBball = !isBook && /basketball|nba/.test(combined);
    const isPol   = !isBook && !isBball && /senator|president|governor|politician/.test(combined);
    const isCeleb = !isBook && !isBball && !isPol && /actor|actress|musician|singer|comedian|comic.?con|fan.?expo|celebrity/.test(combined);
    const isOther = !isBook && !isBball && !isPol && !isCeleb && /gymnast|olympic|nfl|mlb|baseball|nhl|hockey|mma|ufc|boxing|wwe|card show/.test(combined);

    const playerName = extractPlayerName(res.title, res.snippet);
    if (!playerName) continue; // skip events with no identifiable player name

    const eventDate = guessDate(combined);
    if (!eventDate) continue; // skip events with no guessable date

    out.push({
      id:     `live_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      player: playerName,
      sport:  isBook ? 'book' : isBball ? 'basketball' : isPol ? 'politics' : isCeleb ? 'celeb' : isOther ? 'other' : 'soccer',
      date:   eventDate,
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

  for (const [i, { q, lang }] of QUERIES.entries()) {
    // First 5 queries use KEY_1, last 5 use KEY_2 (falls back to KEY_1 if KEY_2 missing)
    const key = (i < 8 || !API_KEY_2) ? API_KEY_1 : API_KEY_2;
    console.log(`  Searching [key${i < 8 || !API_KEY_2 ? 1 : 2}]: "${q.substring(0, 60)}"`);
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&num=10&api_key=${key}`;
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
