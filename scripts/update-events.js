#!/usr/bin/env node
/**
 * update-events.js
 * Runs on GitHub Actions every 6 hours.
 * Calls SerpAPI + Google Events engine, parses results,
 * writes data/live-events.json → Cloudflare Pages auto-deploys.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE  = join(__dirname, '../data/live-events.json');

// ── API KEYS (from GitHub Secrets) ──────────────────────────────────────────
const API_KEYS = [
  process.env.SERPAPI_KEY_1,
  process.env.SERPAPI_KEY_2,
  process.env.SERPAPI_KEY_3,
].filter(Boolean);

if (!API_KEYS.length) {
  console.error('No SERPAPI_KEY_* env vars set. Add them as GitHub Secrets.');
  process.exit(1);
}

let keyIdx = 0;
const key = () => API_KEYS[keyIdx] || API_KEYS[0];
const rotateKey = () => { if (keyIdx < API_KEYS.length - 1) { keyIdx++; return true; } return false; };

// ── SHARED CONSTANTS (mirrors browser code) ─────────────────────────────────
const RELEVANT_WORDS = [
  'meet','sign','greet','autograph','dinner','firma','dédicace','autografi',
  'incontro','légende','leyenda','autogramm','signing','appari','book signing',
  'book tour','book launch','firma libro','dédicace livre','buchsign',
  'presentacion libro','vip package','vip meet','fan event','fan day',
  'player appearance','athlete appearance',
];

const LANG_NAMES = { fr:'French', it:'Italian', es:'Spanish', de:'German', pt:'Portuguese', nl:'Dutch', ja:'Japanese' };

const QUERIES = [
  // Soccer / Football
  { q:'soccer football player meet greet autograph signing 2026',          lang:'en' },
  { q:'football legends dinner autograph 2026 UK',                         lang:'en' },
  { q:'MLS soccer player meet greet fan event 2026',                       lang:'en' },
  { q:'firma autografos futbolista 2026',                                   lang:'es' },
  { q:'seance dedicaces footballeur 2026 france',                           lang:'fr' },
  { q:'firma autografi calciatore 2026',                                    lang:'it' },
  { q:'Autogrammstunde Fussball 2026',                                      lang:'de' },
  // Basketball
  { q:'NBA basketball player autograph signing meet greet 2026',           lang:'en' },
  { q:'basketball player fan event autograph New York 2026',               lang:'en' },
  // Other Sports
  { q:'Simone Biles autograph signing meet greet 2026',                    lang:'en' },
  { q:'olympic athlete gymnast autograph signing fan event 2026',          lang:'en' },
  // NYC-specific
  { q:'athlete autograph signing New York 2026',                           lang:'en' },
  // Venue-specific
  { q:'site:fitermansports.com autograph signing 2026',                    lang:'en' },
  { q:'site:cravetheauto.com autograph signing basketball soccer 2026',    lang:'en' },
  // Card shows
  { q:'NFL MLB NBA autograph signing card show convention 2026',           lang:'en' },
  { q:'sports card show celebrity guest autograph 2026 USA',               lang:'en' },
  // Celebrities
  { q:'celebrity actor musician meet greet fan signing event 2026',        lang:'en' },
  { q:'comic con celebrity autograph photo op fan meet 2026',              lang:'en' },
  { q:'fan expo celebrity guest autograph signing 2026',                   lang:'en' },
  { q:'site:fanexpohq.com celebrity guests photo op autograph 2026',       lang:'en' },
  // WWE / Boxing
  { q:'WWE WrestleMania fan experience autograph photo op 2026',           lang:'en' },
  { q:'boxing fighter meet greet autograph fan event 2026',                lang:'en' },
  { q:'MMA UFC fighter autograph signing fan event 2026',                  lang:'en' },
  // UK / Europe
  { q:'MCM Comic Con London celebrity guests photo ops autograph 2026',    lang:'en' },
  // Politics
  { q:'"Barack Obama" OR "Michelle Obama" book signing meet greet VIP 2026', lang:'en' },
  { q:'politician senator governor president meet greet book signing VIP 2026', lang:'en' },
  // Google Events engine queries (handled separately below)
];

const GE_QUERIES = [
  'meet and greet sports player 2026',
  'basketball autograph signing 2026',
  'soccer football legend meet greet 2026',
  'celebrity fan meet greet convention 2026',
  'athlete autograph fan event 2026 USA',
];

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

// ── FETCH HELPERS ────────────────────────────────────────────────────────────
async function fetchWithRetry(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.status === 401 || r.status === 402 || r.status === 429) {
        if (rotateKey()) continue;
        return null;
      }
      if (!r.ok) return null;
      const data = await r.json();
      if (data.error && /run out|quota|credit|limit/i.test(data.error)) {
        if (rotateKey()) continue;
        return null;
      }
      return data;
    } catch { /* timeout / network — retry */ }
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

    const isMailIn  = /mail-?in signing|ship your|mail order/.test(combined);
    const isPrivate = /private signing|private session|private autograph/.test(combined);
    if (isMailIn || isPrivate) continue;

    const isBball    = /basketball|nba|baloncesto/.test(combined);
    const isPolitics = !isBball && /senator|congressman|president|governor|politician|town hall|ministre|politico|diputado/.test(combined);
    const isCeleb    = !isBball && !isPolitics && /actor|actress|musician|singer|comedian|comic con|fan convention|fan expo|celebrity/.test(combined);
    const isOther    = !isBball && !isPolitics && !isCeleb && /gymnast|olympic|swimmer|nfl|mlb|baseball|nhl|hockey|card show/.test(combined);

    out.push({
      id:     `live_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      player: res.title.substring(0, 80),
      sport:  isBball ? 'basketball' : isPolitics ? 'politics' : isCeleb ? 'celeb' : isOther ? 'other' : 'soccer',
      date:   guessDate(combined) || new Date().toISOString().split('T')[0],
      venue:  '',
      city:   '',
      link:   res.link,
      notes:  (res.snippet || '').substring(0, 200) + (lang !== 'en' ? ` [${LANG_NAMES[lang] || lang}]` : ''),
      source: res.displayed_link || 'Web search',
      lang:   lang !== 'en' ? lang : undefined,
    });
  }
  return out;
}

function parseGoogleEvents(data) {
  const out = [];
  for (const ev of (data.events_results || [])) {
    const combined = ((ev.title || '') + ' ' + (ev.description || '')).toLowerCase();
    if (!RELEVANT_WORDS.some(w => combined.includes(w))) continue;
    const dateStr = ev.date?.start_date || ev.date?.when || '';
    const parsed  = dateStr ? new Date(dateStr) : null;
    const isoDate = parsed && !isNaN(parsed) ? parsed.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    if (parsed && parsed < new Date()) continue; // skip past events

    const combined2 = combined;
    const isBball = /basketball|nba/.test(combined2);
    const isCeleb = /actor|actress|musician|comic con|fan expo/.test(combined2);

    out.push({
      id:     `live_ge_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      player: (ev.title || '').substring(0, 80),
      sport:  isBball ? 'basketball' : isCeleb ? 'celeb' : 'soccer',
      date:   isoDate,
      venue:  ev.venue?.name || '',
      city:   ev.venue?.rating ? '' : (ev.venue?.name || ''),
      link:   ev.link || '',
      notes:  (ev.description || '').substring(0, 200),
      source: ev.venue?.name || 'Google Events',
    });
  }
  return out;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Starting update — ${new Date().toISOString()}`);
  console.log(`Using ${API_KEYS.length} API key(s)`);

  const results = [];

  // Web search queries (rate-limited: 1 req/sec to be safe)
  for (const { q, lang } of QUERIES) {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&num=10&api_key=${key()}`;
    const data = await fetchWithRetry(url);
    if (data) results.push(...parseOrganic(data, lang));
    await new Promise(r => setTimeout(r, 1100)); // 1.1 s between requests
  }

  // Google Events engine
  for (const q of GE_QUERIES) {
    const url = `https://serpapi.com/search.json?engine=google_events&q=${encodeURIComponent(q)}&api_key=${key()}`;
    const data = await fetchWithRetry(url);
    if (data) results.push(...parseGoogleEvents(data));
    await new Promise(r => setTimeout(r, 1100));
  }

  // De-duplicate by link
  const seen = new Set();
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
