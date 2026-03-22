#!/usr/bin/env node
/**
 * update-events.js
 * Runs on GitHub Actions daily at 08:00 UTC.
 * Calls SerpAPI, writes data/live-events.json → Cloudflare Pages auto-deploys.
 * ~16 constant queries + 3 rotating player queries per day, split across 2 API keys.
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

// ── CONSTANT QUERIES — run every day ─────────────────────────────────────────
const ALL_QUERIES = [
  { q: 'soccer football player meet greet autograph signing 2026',             lang: 'en' },
  { q: 'NBA basketball player autograph signing meet greet 2026',              lang: 'en' },
  { q: 'NBA Store New York meet greet player appearance autograph 2026',       lang: 'en' },
  { q: 'celebrity actor musician meet greet fan signing event 2026',           lang: 'en' },
  { q: 'WWE MMA boxing fighter meet greet autograph fan event 2026',           lang: 'en' },
  { q: 'athlete book signing tour meet author 2026',                           lang: 'en' },
  { q: 'futbolista firma libros presentacion libro 2026',                      lang: 'es' },
  { q: 'sportif dédicace livre signature rencontre auteur 2026',               lang: 'fr' },
  { q: 'calciatore firma copie presentazione libro autobiografia 2026',        lang: 'it' },
  { q: 'Sportler Buchsignierung Buchmesse Lesung Autobiografie 2026',          lang: 'de' },
  { q: 'Formula 1 F1 driver autograph signing fan zone meet greet 2026',       lang: 'en' },
  { q: 'F1 piloto firma autógrafos zona fans Grand Prix 2026',                 lang: 'es' },
  { q: 'F1 pilote dédicace zone fan Grand Prix autographe 2026',               lang: 'fr' },
  { q: 'Formula 1 pilota autografi firma zona fan Gran Premio 2026',           lang: 'it' },
  { q: 'firma autografos futbolista OR autografi calciatore 2026',             lang: 'en' },
  { q: 'meet and greet sports player autograph signing 2026',                  lang: 'en' },
  { q: 'site:cravetheauto.com autograph signing meet greet 2026',             lang: 'en' },
  { q: 'site:instagram.com gentlemanscutbourbon meet greet athlete signing',   lang: 'en' },
  { q: '"gentlemanscutbourbon" meet greet athlete autograph signing event',    lang: 'en' },
  // ── Organizers discovered via CraveTheAuto event pages ──
  { q: 'site:cardboardpromotions.com autograph signing meet greet',           lang: 'en' },
  { q: 'site:shopdynastysports.com autograph signing athlete appearance',      lang: 'en' },
  { q: 'site:tristarproductions.com autograph signing meet greet athlete',     lang: 'en' },
  { q: 'site:sportsworld-usa.com autograph signing athlete appearance',        lang: 'en' },
  { q: 'site:fathernsonssportsmemorabilia.com autograph signing appearance',   lang: 'en' },
  // ── New organizers discovered via deep scout ──
  { q: 'site:palmbeachautographs.com autograph signing public event',         lang: 'en' },
  { q: 'site:bighornautographs.com autograph signing athlete appearance',      lang: 'en' },
  { q: 'site:513autographs.com autograph signing athlete appearance',          lang: 'en' },
  { q: 'site:tsebuffalo.com autograph signing athlete appearance',             lang: 'en' },
  { q: 'site:signingshotline.com autograph appearance athlete 2026',           lang: 'en' },
  { q: 'site:sportscollectors.net signing appearance athlete 2026',            lang: 'en' },
  { q: 'site:legends7.co.uk evening dinner meet greet athlete 2026',          lang: 'en' },
  { q: 'site:authentic-autographs.com.au meet greet athlete signing 2026',    lang: 'en' },
  // ── UK event organizers ──
  { q: 'site:superstarspeakers.co.uk evening meet greet autograph 2026',      lang: 'en' },
  { q: 'site:greenmountevents.co.uk signing meet greet autograph 2026',       lang: 'en' },
  { q: 'site:worldwidesigningsevents.co.uk meet greet signing 2026',          lang: 'en' },
  { q: 'site:allstarsignings.com autograph signing meet greet 2026',          lang: 'en' },
  // ── Europe — Italian ──
  { q: 'site:operazionenostalgia.com raduno firma autografi 2026',            lang: 'it' },
  { q: 'site:cardfest.it meet greet VIP autografi campione 2026',             lang: 'it' },
  { q: 'firma autografi calciatore evento pubblico italia 2026',               lang: 'it' },
  { q: 'incontro tifosi calciatore firma autografi 2026',                      lang: 'it' },
  // ── Europe — Polish ──
  { q: 'site:galacticosshow.pl VIP meet greet legends 2026',                  lang: 'en' },
  { q: 'galacticos show Poland legends meet greet VIP 2026',                  lang: 'en' },
  // ── Europe — German ──
  { q: 'site:starbesuch.de Autogrammstunde Sportler 2026',                    lang: 'de' },
  { q: 'Autogrammstunde Fussball Sportler öffentlich 2026',                   lang: 'de' },
  { q: 'Signierstunde Fussballspieler Fan 2026',                              lang: 'de' },
  // ── Europe — French ──
  { q: 'séance dédicace footballeur sportif france belgique 2026',            lang: 'fr' },
  { q: 'rencontre fans joueur football dédicace 2026',                        lang: 'fr' },
  // ── Europe — Spanish ──
  { q: 'sesión firma autógrafos futbolista españa 2026',                      lang: 'es' },
  { q: 'encuentro fans jugador firma autógrafos 2026',                        lang: 'es' },
  // ── Europe — Dutch ──
  { q: 'signeersessie voetballer fan evenement 2026',                         lang: 'nl' },
  { q: 'handtekening sessie sporters publiek 2026',                           lang: 'nl' },
  // ── Europe — Portuguese ──
  { q: 'sessão autógrafos jogador futebol público 2026',                      lang: 'pt' },
  // ── Latin America — Spanish ──
  { q: 'firma autógrafos futbolista evento tienda 2026',                      lang: 'es' },
  { q: 'meet and greet futbolista latinoamerica 2026',                        lang: 'es' },
  { q: 'leyendas futbol partido firma autografos sudamerica 2026',            lang: 'es' },
  { q: 'site:puntoticket.com futbolista leyendas firma 2026',                 lang: 'es' },
  { q: 'site:superboletos.com meet greet futbolista 2026',                    lang: 'es' },
  { q: 'site:fanki.com.mx futbolista leyendas partido meet 2026',             lang: 'es' },
  { q: 'site:boletomovil.com firma autografos futbolista meet greet 2026',    lang: 'es' },
  { q: 'site:shopwss.com meet greet legend athlete event 2026',               lang: 'en' },
  { q: 'site:ll12.vip/event LALIGA legend meet greet watch party',           lang: 'en' },
  // ── Latin America — Portuguese (Brazil) ──
  { q: 'sessão autógrafos jogador futebol brasil evento 2026',                lang: 'pt' },
  { q: 'encontro fãs jogador futebol meet and greet brasil 2026',             lang: 'pt' },
  // ── Talks venues ──
  { q: 'site:92ny.org famous celebrity athlete speaker event 2026',           lang: 'en' },
  { q: 'site:sixthandi.org famous celebrity politician speaker event 2026',   lang: 'en' },
  { q: 'university commencement speaker 2026 celebrity athlete famous',       lang: 'en' },
  { q: 'commencement speaker 2026 announced famous celebrity',                lang: 'en' },
  { q: 'site:streicker.nyc sports celebrity speaker event 2026',              lang: 'en' },
  // ── Book signings — Italy ──
  { q: 'site:eventi.mondadoristore.it firma calciatore sportivo 2026',        lang: 'it' },
  { q: 'site:salonelibro.it firmacopie sportivo calciatore 2026',             lang: 'it' },
  { q: 'firmacopie calciatore campione presentazione libro 2026',              lang: 'it' },
  // ── Book signings — Spain ──
  { q: 'site:fnac.es firma de libros futbolista deportista 2026',             lang: 'es' },
  { q: 'site:ferialibromadrid.com firma futbolista deportista 2026',          lang: 'es' },
  { q: 'site:planetadelibros.com firma futbolista sant jordi 2026',           lang: 'es' },
  { q: 'firma libros futbolista sant jordi barcelona 2026',                    lang: 'es' },
  // ── Book signings — UK ──
  { q: 'site:waterstones.com football soccer sports author signing 2026',     lang: 'en' },
  { q: 'site:londonfestivaloffootballwriting.org event author 2026',          lang: 'en' },
  { q: 'football soccer autobiography book signing uk 2026',                   lang: 'en' },
  // ── Book signings aggregator — US ──
  { q: 'site:booksigningcentral.com sports athlete signing 2026',             lang: 'en' },
];

// ── INSTAGRAM ACCOUNTS — venue/organizer accounts to monitor via SerpAPI ──────
// 3 accounts checked per day, rotating through the full list every ~N/3 days.
const INSTAGRAM_ACCOUNTS = [
  // ── USA — multi-sport / card shows ──
  'cravetheauto',
  'cardvaultboston',
  'cardvaultsacramento',
  'cardvaultla',
  'dickssportinggoods',
  'shopwss',
  'fitermansports',
  'bighornautographs',
  'palmbeachautographs',
  'tsebuffalo',
  'nynjsportsworld',
  'woodbridgebrewingco',
  'tristar1',
  'halloffamesignings',
  'millcreeksports1991',
  'upperdecksports',
  'fanaticsfest',
  'nbastore',
  // ── UK — soccer / sports signing organizers ──
  'superstarspeakers_ltd',
  'allstarsignings',
  'iconsseries',
  'worldwide_signings',
  // ── Europe — soccer legends events ──
  'galacticosshowpolska2026',
  'starbesuch',
  'serieaoperazionenostalgia',
  'collectit.cardshow',
  // ── Spain — football signings ──
  'leyendasespanaoficial',
  'cardcracktcg',
  'casportsmarketing',
  'sportcoa_memorabilia',
];

// ── MONITORED PLAYERS — add names here to track them individually ─────────────
// 3 players are checked per day, rotating through the full list every ~N/3 days.
const MONITORED_PLAYERS = [
  'Andre Agassi',
  'Marcelo Vieira',
  'Paolo Maldini',
  'Alessandro Nesta',
  'Thierry Henry',
  'Kun Aguero',
  'Angel Di Maria',
  'Fabio Cannavaro',
  'Gianluigi Buffon',
  'Luis Suarez',
  'Romario',
  'Juan Veron',
  'Antoine Griezmann',
  'Sergio Ramos',
  'Steven Gerrard',
  'Hernan Crespo',
  'Ivan Rakitic',
  'Luka Modric',
];

// ── LL12 CITY MONITOR — direct-fetch every known city page daily ──────────────
// These pages are public (no login). New cities are also caught via the
// site:ll12.vip/event SerpAPI query which picks up newly-indexed slugs.
const LL12_CITIES = [
  { slug:'houston',       city:'Houston, TX' },
  { slug:'charlotte',     city:'Charlotte, NC' },
  { slug:'washington-dc', city:'Washington, DC' },
  { slug:'new-york',      city:'New York, NY' },
  { slug:'los-angeles',   city:'Los Angeles, CA' },
  { slug:'miami',         city:'Miami, FL' },
  { slug:'chicago',       city:'Chicago, IL' },
  { slug:'dallas',        city:'Dallas, TX' },
  { slug:'atlanta',       city:'Atlanta, GA' },
  { slug:'san-diego',     city:'San Diego, CA' },
  { slug:'san-francisco', city:'San Francisco, CA' },
  { slug:'las-vegas',     city:'Las Vegas, NV' },
  { slug:'denver',        city:'Denver, CO' },
];

function parseShortDate(html) {
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                   jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const m = html.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*[\s.,]+(\d{1,2})\b/i);
  if (!m) return null;
  const mo = months[m[1].toLowerCase().slice(0,3)];
  if (!mo) return null;
  const year = new Date().getFullYear();
  return `${year}-${mo}-${m[2].padStart(2,'0')}`;
}

async function fetchLL12Events() {
  const events = [];
  for (const { slug, city } of LL12_CITIES) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(`https://www.ll12.vip/event/${slug}`, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
      });
      clearTimeout(t);
      if (!r.ok) { console.log(`  LL12 ${slug}: HTTP ${r.status}`); continue; }
      const html = await r.text();

      if (/this event is over/i.test(html)) { console.log(`  LL12 ${slug}: past event`); continue; }

      // Player name: "WITH JULIO BAPTISTA AND HUGO SÁNCHEZ" / "WITH PATRICK KLUIVERT"
      const playerMatch = html.match(/\bWITH\s+([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s\-]+?)(?=\s*(?:[|<\n"]|AND\s[A-Z])|\s*$)/im);
      // Date: "Mar 22" / "April 4"
      const dateStr = guessDate(html.toLowerCase()) || parseShortDate(html);
      // Venue: after "Where:" line
      const venueMatch = html.match(/Where[:\s]+([^\n|<]{4,60})/i);

      if (!dateStr) { console.log(`  LL12 ${slug}: no date found`); continue; }

      const player = playerMatch
        ? playerMatch[1].trim().replace(/\s+/g, ' ')
        : 'LALIGA Legend';

      events.push({
        id:     `ll12_${slug}`,
        player: `${player} – El Partidazo Watch Party`,
        sport:  'soccer',
        date:   dateStr,
        venue:  venueMatch ? venueMatch[1].trim().replace(/\s+/g,' ') : '',
        city,
        link:   `https://www.ll12.vip/event/${slug}`,
        notes:  'El Partidazo LALIGA watch party. First 90 guests get a chance to meet a LALIGA legend + exclusive ElPartidazo scarf. Free RSVP via ll12.vip. Meet & greet not confirmed — limited to first 90 guests only.',
        source: 'll12.vip',
      });
      console.log(`  LL12 ${slug}: "${player}" on ${dateStr}`);
    } catch (e) {
      console.log(`  LL12 ${slug}: error — ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return events;
}

// ── CRAVETHEAUTO DIRECT CRAWL ─────────────────────────────────────────────────
// Fetches the main listing page and extracts event links.
// URL format encodes the date and slug: /autograph-appearances/MM/DD[-DD]/slug
// This catches new events same-day, before Google indexes them.
const CTA_EVENT_SLUGS = new Set([
  'show','expo','convention','con','fest','open','classic','challenge',
  'cup','championship','tournament','event','signing','appearances',
  'cardvault','superstars','capital','city','card','sports','world',
  'buffalo','dedham','chicago','boston','dallas','houston','miami',
]);
async function fetchCraveTheAuto() {
  const events = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch('https://www.cravetheauto.com/autograph-appearances', {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    });
    clearTimeout(t);
    if (!r.ok) { console.log(`  CraveTheAuto: HTTP ${r.status}`); return events; }
    const html = await r.text();

    // Match /autograph-appearances/MM/DD[-DD]/slug
    const linkPat = /href="(\/autograph-appearances\/(\d{2})\/(\d{2})(?:-\d{2})?\/([a-z0-9][a-z0-9-]+))"/gi;
    const seen = new Set();
    let m;
    while ((m = linkPat.exec(html)) !== null) {
      const [, path, month, day, slug] = m;
      const link = `https://www.cravetheauto.com${path}`;
      if (seen.has(link)) continue;
      seen.add(link);

      // Skip event/show slugs — these are shows, not player names
      const slugWords = slug.split('-').filter(w => !/^\d+$/.test(w));
      if (slugWords.length < 2) continue; // single word = location/show, not a player
      if (slugWords.some(w => CTA_EVENT_SLUGS.has(w))) continue;

      // Build date — skip if already past (CraveTheAuto keeps past events on their page)
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const year = now.getFullYear();
      const date = `${year}-${month}-${day}`;
      if (new Date(date + 'T00:00:00') < now) continue;

      // Convert slug to name: "roger-clemens-2" → "Roger Clemens" (digits already stripped)
      const player = slugWords
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      events.push({
        id:     `cta_${month}${day}_${slug}`,
        player,
        sport:  'other',
        date,
        venue:  '',
        city:   '',
        link,
        notes:  '',
        source: 'cravetheauto.com',
      });
    }
    console.log(`  CraveTheAuto direct: ${events.length} events found`);
  } catch (e) {
    console.log(`  CraveTheAuto direct: error — ${e.message}`);
  }
  return events;
}

// Pick 3 players to search today based on day-of-year rotation
const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
const PLAYERS_TODAY = [0, 1, 2].map(offset =>
  MONITORED_PLAYERS[(dayOfYear * 3 + offset) % MONITORED_PLAYERS.length]
);
const PLAYER_QUERIES = PLAYERS_TODAY.flatMap(name => [
  { q: `"${name}" meet greet autograph signing fan 2026`, lang: 'en' },
]);

// Pick 3 Instagram accounts to monitor today (rotating)
const ACCOUNTS_TODAY = [0, 1, 2].map(offset =>
  INSTAGRAM_ACCOUNTS[(dayOfYear * 3 + offset) % INSTAGRAM_ACCOUNTS.length]
);
const INSTAGRAM_QUERIES = ACCOUNTS_TODAY.map(account => ({
  q: `site:instagram.com/${account} autograph signing meet greet 2026`,
  lang: 'en',
}));

// Final query list: all constant + today's player queries + today's Instagram accounts
// Key split: first half on KEY_1, second half on KEY_2
const QUERIES = [...ALL_QUERIES, ...PLAYER_QUERIES, ...INSTAGRAM_QUERIES];
const SPLIT   = Math.ceil(QUERIES.length / 2);

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
    // Skip pure talk/interview events with no fan M&G component
    if (/in conversation with|in conversation:|a conversation with|talks? with|interview with|evening with.*broadway|broadway.*in conversation/.test(combined)
        && !/meet.?greet|autograph|signing|fan event|vip meet/.test(combined)) continue;

    // ── DOMAIN BLOCKLIST — known past/irrelevant events ───────────────────────
    const BLOCKED_DOMAINS = [
      'goldoveramericatour.com',  // 2024 tour — past
      'acmilan.com',              // rolling/generic page, not real confirmed events
    ];
    if (BLOCKED_DOMAINS.some(d => res.link.includes(d))) continue;

    const isBook   = /book signing|book tour|presents his book|firma libros|firma copie|d[eé]dicace.*livre|buchsignierung|signeersessie|sess[aã]o.*aut[oó]grafos|lançamento.*livro|autobiography|memoir|presentaci[oó]n.*libro|presentazione.*libro/.test(combined);
    const isBball  = !isBook && /basketball|nba/.test(combined);
    const isPol    = !isBook && !isBball && /senator|president|governor|politician/.test(combined);
    const isCeleb  = !isBook && !isBball && !isPol && /actor|actress|musician|singer|comedian|comic.?con|fan.?expo|celebrity/.test(combined);
    const isNFL    = /\bnfl\b|american football|super bowl|superbowl|touchdown|quarterback|wide receiver|running back|tight end|linebacker|defensive end|eagles|patriots|cowboys|chiefs|steelers|packers|bears|giants|ravens|broncos|seahawks|49ers|rams|chargers|raiders|dolphins|bills|bengals|browns|colts|jaguars|titans|texans|falcons|saints|panthers|buccaneers|vikings|lions|cardinals/.test(combined);
    const isOther  = !isBook && !isBball && !isPol && !isCeleb && !isNFL && /gymnast|olympic|mlb|baseball|nhl|hockey|mma|ufc|boxing|wwe|card show|formula.?1|formula one|\bf1\b|grand prix|f1 driver|f1 pilote|f1 pilota|formel 1/.test(combined);
    const isSoccer = !isBook && !isBball && !isPol && !isCeleb && !isNFL && !isOther && /\bsoccer\b|futbol|calcio|fútbol|\bfootballer\b|calciatore|\bfoot\b|ligue|premier league|bundesliga|serie a|la liga|champions league|\bcopa\b|\bmls\b|\bfifa\b/.test(combined);

    const playerName = extractPlayerName(res.title, res.snippet);
    if (!playerName) continue; // skip events with no identifiable player name

    const eventDate = guessDate(combined);
    if (!eventDate) continue; // skip events with no guessable date

    // Skip generic CraveTheAuto listing pages — seeds already cover these with deep links
    if (/cravetheauto\.com\/autograph-appearances\/?$/.test(res.link)) continue;

    out.push({
      id:     `live_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      player: playerName,
      sport:  isBook ? 'book' : isBball ? 'basketball' : isPol ? 'politics' : isCeleb ? 'celeb' : isNFL ? 'football' : isOther ? 'other' : isSoccer ? 'soccer' : 'other',
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
    const key = (i < SPLIT || !API_KEY_2) ? API_KEY_1 : API_KEY_2;
    console.log(`  Searching [key${i < SPLIT || !API_KEY_2 ? 1 : 2}]: "${q.substring(0, 60)}"`);
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

  // Direct-fetch LL12 city events (bypasses SerpAPI)
  console.log('Fetching LL12 city pages directly...');
  const ll12Events = await fetchLL12Events();
  console.log(`LL12 direct: ${ll12Events.length} upcoming events found`);
  results.push(...ll12Events);

  // Direct-crawl CraveTheAuto listing page (catches same-day additions before Google indexes)
  console.log('Fetching CraveTheAuto events directly...');
  const ctaEvents = await fetchCraveTheAuto();
  console.log(`CraveTheAuto direct: ${ctaEvents.length} events found`);
  results.push(...ctaEvents);

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
