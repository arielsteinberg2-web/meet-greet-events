/**
 * validate-existing-events.js
 * Checks every event in live-events.json against Wikipedia to verify
 * the player is a known public figure. Removes events that fail.
 *
 * Run once:  node scripts/validate-existing-events.js
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_FILE = path.join(__dirname, '../data/live-events.json');

// Seeds that are hand-curated — always keep regardless of Wikipedia
const ALWAYS_KEEP = new Set([
  'wwe1','wwe2','cta_wwe_boston1','cta_80swrestling1','pba_steiner1',
  'pba_goldberg1','pba_brethart1','scx1','fi1','fi2','fi3','fi4',
  'pba_tkachuk1','pba_brethart1','eb1','eb2','eb3','pba_rickflair1',
]);

const NOTABLE_RE = /\b(athlete|player|actor|actress|singer|rapper|musician|author|writer|wrestler|boxer|politician|comedian|chef|model|director|producer|executive|entrepreneur|celebrity|influencer|coach|nba|nfl|mlb|nhl|mma|ufc|wwe|hall of fame|footballer|golfer|tennis|swimmer|gymnast|olympian)\b/i;
const NOT_PERSON_RE = /\b(country|sovereign state|nation|city|town|municipality|village|county|state|province|region|island|continent|ocean|river|mountain|organization|company|corporation|band|group|duo|trio|franchise|team)\b/i;

async function checkWikipedia(name) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'MeetGreetEvents/1.0' } });
    clearTimeout(t);
    if (!r.ok) return { known: false, reason: `no Wikipedia article (HTTP ${r.status})` };
    const data = await r.json();
    if (data.type === 'disambiguation') return { known: false, reason: 'disambiguation page' };
    const desc    = (data.description || '').toLowerCase();
    const extract = (data.extract    || '').toLowerCase();
    if (/\b(country|sovereign state|nation|city|town|municipality|village|county|state|province|region|island|continent|ocean|river|mountain|organization|company|corporation|hotel|restaurant|school|university|song|album|film|movie|book|novel|television|tv series|podcast|band|group|duo|trio|franchise|team)\b/i.test(extract))
      return { known: false, reason: 'Wikipedia article is a place/org/media, not a person' };
    if (NOTABLE_RE.test(desc) || NOTABLE_RE.test(extract)) return { known: true };
    return { known: false, reason: `article exists but not a public figure: "${(data.description||data.extract||'').slice(0,80)}"` };
  } catch {
    return { known: true, reason: 'network timeout — keeping' }; // permissive on timeout
  }
}

async function main() {
  const raw  = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const events = Array.isArray(raw) ? raw : raw.events;
  const isWrapped = !Array.isArray(raw);

  console.log(`Validating ${events.length} events against Wikipedia…\n`);

  const keep   = [];
  const remove = [];

  for (const ev of events) {
    // Always keep hand-curated seeds and non-Eventbrite sources
    if (ALWAYS_KEEP.has(ev.id) || ev.source !== 'eventbrite.com') {
      keep.push(ev);
      continue;
    }

    const { known, reason } = await checkWikipedia(ev.player);
    if (known) {
      keep.push(ev);
      console.log(`  ✓ ${ev.player}`);
    } else {
      remove.push(ev);
      console.log(`  ✗ REMOVING "${ev.player}" — ${reason}`);
    }

    // Polite delay between Wikipedia calls
    await new Promise(r => setTimeout(r, 300));
  }

  const result = isWrapped ? { ...raw, events: keep } : keep;
  fs.writeFileSync(DATA_FILE, JSON.stringify(result, null, 2), 'utf8');

  console.log(`\nDone. Kept: ${keep.length}  Removed: ${remove.length}`);
  if (remove.length > 0) {
    console.log('\nRemoved events:');
    remove.forEach(e => console.log(`  - [${e.id}] ${e.player} | ${e.notes}`));
  }
}

main().catch(console.error);
