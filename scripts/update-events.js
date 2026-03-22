#!/usr/bin/env node
/**
 * update-events.js
 * Runs on GitHub Actions daily at 08:00 UTC.
 * Calls SerpAPI, writes data/live-events.json → Cloudflare Pages auto-deploys.
 * ~16 constant queries + 3 rotating player queries per day, split across 2 API keys.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE  = join(__dirname, '../data/live-events.json');

// ── API KEYS (from GitHub Secrets) ───────────────────────────────────────────
const API_KEY_1     = process.env.SERPAPI_KEY_1;
const API_KEY_2     = process.env.SERPAPI_KEY_2;
const API_KEY_3     = process.env.SERPAPI_KEY_3;
const API_KEY_4     = process.env.SERPAPI_KEY_4;
const SERPER_KEY    = process.env.SERPER_KEY;      // optional — Google Search via serper.dev
const SERPER_KEY2   = process.env.SERPER_KEY_2;   // optional — second Serper key
const SEARCHAPI_KEY = process.env.SEARCHAPI_KEY;  // optional — Google Search via searchapi.io
const SCRAPER_KEY   = process.env.SCRAPERAPI_KEY; // optional — proxy for direct site fetches

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
  { q: 'site:store.epic.leapevent.tech autograph signing meet greet athlete', lang: 'en' },
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
  // ── Club fan tours — catch official club-run fan experiences (e.g. Casa Atleti) ──
  { q: 'LaLiga club fan tour USA meet greet fan experience 2026',              lang: 'en' },
  { q: 'soccer club fan weekend USA meet legends VIP experience 2026',         lang: 'en' },
  { q: 'Atletico Madrid Barcelona Real Madrid fan event meet greet USA 2026',  lang: 'en' },
  { q: 'Premier League club fan tour USA meet greet event 2026',               lang: 'en' },
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
  // ── Eventbrite — sports & celebrity meet & greet events ──
  { q: 'site:eventbrite.com autograph signing athlete meet greet 2026',       lang: 'en' },
  { q: 'site:eventbrite.com soccer football player meet greet fan 2026',      lang: 'en' },
  { q: 'site:eventbrite.com NBA basketball player signing appearance 2026',   lang: 'en' },
  { q: 'site:eventbrite.com WWE boxing MMA fighter meet greet signing 2026',  lang: 'en' },
  { q: 'site:eventbrite.com celebrity athlete book signing tour 2026',        lang: 'en' },
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
  // ── Club fan tours (official club accounts that run USA/international fan events) ──
  'atleticodemadrid',
  'fcbarcelona',
  'realmadrid',
  'acmilan',
  'juventus',
  'inter',
  'manchestercity',
  'manchesterunited',
  'arsenal',
  'chelseafc',
  'liverpoolfc',
  'psg',
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
      const html = await fetchDirect(`https://www.ll12.vip/event/${slug}`, 10000);
      if (!html) { console.log(`  LL12 ${slug}: failed`); continue; }

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

// ── SCRAPER API RENDERED FETCH ────────────────────────────────────────────────
// ScraperAPI with render=true — for JS-rendered pages (Squarespace etc.)
async function fetchRendered(url, timeoutMs = 45000) {
  if (!SCRAPER_KEY) return null;
  try {
    const proxyUrl = `http://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(url)}&render=true`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(proxyUrl, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) { console.log(`  fetchRendered: HTTP ${r.status} for ${url}`); return null; }
    return r.text();
  } catch (e) {
    console.log(`  fetchRendered error: ${e.message}`);
    return null;
  }
}

// ── CRAVETHEAUTO DIRECT CRAWL ─────────────────────────────────────────────────
// Fetches listing page (render=true), then each event page (render=true) to get:
//   - Real player name from page title (not slug)
//   - Venue + city from event metadata
//   - Sport detected from title keywords
//   - Event Verification Link (Instagram/social proof) as the outbound link
//   - Fallback: show website "click here" link, then CraveTheAuto page URL

function ctaDetectSport(text) {
  const t = text.toLowerCase();
  if (/\bnfl\b|quarterback|wide receiver|running back|linebacker|tight end|defensive end|super bowl|steelers|patriots|cowboys|chiefs|eagles|packers|bears|giants|ravens|seahawks|49ers|rams|chargers|raiders|dolphins|bills|bengals|browns|colts|jaguars|titans|texans|falcons|saints|panthers|buccaneers|vikings|lions|cardinals|broncos/.test(t)) return 'football';
  if (/\bnba\b|basketball|lakers|celtics|bulls|knicks|heat|warriors|nets|bucks|suns|nuggets|clippers|spurs|pistons|hawks|magic|wizards|hornets|pelicans|grizzlies|jazz|thunder|blazers|rockets|maverick/.test(t)) return 'basketball';
  if (/\bmlb\b|baseball|yankees|red sox|dodgers|cubs|mets|braves|astros|cardinals|giants|phillies|blue jays|orioles|nationals|padres|reds|pirates|tigers|royals|twins|white sox|brewers|rangers|athletics|mariners|angels/.test(t)) return 'baseball';
  if (/\bnhl\b|hockey|rangers|bruins|penguins|flyers|maple leafs|blackhawks|red wings|capitals|avalanche|lightning|golden knights|canadiens|oilers|canucks|flames|jets|wild|predators|blues|coyotes|sharks|ducks|kings|stars|hurricanes|sabres|senators|islanders/.test(t)) return 'other';
  if (/\bwwe\b|wrestling|raw|smackdown/.test(t)) return 'wrestling';
  if (/\bufc\b|mma|boxing/.test(t)) return 'wrestling';
  if (/soccer|football|mls|laliga|premier league|bundesliga|serie a|ligue 1/.test(t)) return 'soccer';
  return 'other';
}

function ctaPlayerFromTitle(rawTitle) {
  // CTA title format: "Show Name | PLAYER NAME Team/Context - Sport Label"
  //                or "PLAYER NAME Team/Context - Sport Label"
  // Player names are ALL CAPS; team/context is mixed-case after the name.
  const decoded = rawTitle.replace(/&amp;/gi, '&').replace(/&#\d+;/gi, ' ').trim();
  // Use the part after "|" if present
  let part = decoded.includes('|') ? decoded.split('|').slice(1).join('|').trim() : decoded;
  // Strip everything from " - " onward (sport label / context suffix)
  part = part.split(' - ')[0].trim();
  // Extract only the leading ALL-CAPS words (player name portion);
  // stops at the first mixed-case word (team/context like "Boston Red Sox")
  // Handles comma/& separated multi-player names: "BENITO SANTIAGO, JOHN CANDELARIA & DUFFY DYER"
  const capsMatch = part.match(/^([A-Z]{2,}(?:['.-][A-Z]+)*(?:\s+[A-Z]{2,}(?:['.-][A-Z]+)*)*(?:\s*[,&]\s*[A-Z]{2,}(?:['.-][A-Z]+)*(?:\s+[A-Z]{2,}(?:['.-][A-Z]+)*)*)*)/);
  if (!capsMatch) return null;
  const raw = capsMatch[1].replace(/[,&\s]+$/, '').trim();
  if (raw.length < 3) return null;
  // Title-case each word, preserving capitalization after hyphens (e.g. BANTA-CAIN → Banta-Cain)
  return raw
    .replace(/\b[A-Z]{2,}(?:['.-][A-Z]+)*/g, w => w.replace(/[A-Z]+/g, s => s.charAt(0) + s.slice(1).toLowerCase()))
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*&\s*/g, ' & ');
}

async function fetchCraveTheAuto() {
  const events = [];
  try {
    // Fetch listing page — need render=true since Squarespace is JS-rendered (can be slow)
    const listingHtml = await fetchRendered('https://www.cravetheauto.com/autograph-appearances', 90000);
    if (!listingHtml) { console.log('  CraveTheAuto: listing page failed'); return events; }

    // Extract event entries from summary-title-link anchors (short-slug format)
    // e.g. href="/autograph-appearances/03/28/pittsburgh-steelers" class="summary-title-link"
    const summaryPat = /href="(\/autograph-appearances\/(\d{2})\/(\d{2})[^"]*)"[^>]*class="summary-title-link"|class="summary-title-link"[^>]*href="(\/autograph-appearances\/(\d{2})\/(\d{2})[^"]*)"/gi;
    const seen = new Set();
    const toFetch = [];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    let m;
    while ((m = summaryPat.exec(listingHtml)) !== null) {
      const path   = m[1] || m[4];
      const month  = m[2] || m[5];
      const day    = m[3] || m[6];
      const ctaUrl = `https://www.cravetheauto.com${path}`;
      if (seen.has(ctaUrl)) continue;
      seen.add(ctaUrl);

      const year = now.getFullYear();
      const date = `${year}-${month}-${day}`;
      if (new Date(date + 'T00:00:00') < now) continue;

      toFetch.push({ ctaUrl, month, day, date });
    }
    console.log(`  CraveTheAuto: ${toFetch.length} upcoming events found on listing page`);

    // Fetch each event page for full details
    for (const { ctaUrl, month, day, date } of toFetch) {
      try {
        const pageHtml = await fetchRendered(ctaUrl, 90000);
        const slug = ctaUrl.split('/').pop();

        if (!pageHtml) {
          console.log(`  CTA: skipping ${slug} (page failed to load)`);
          continue;
        }

        // Title
        const titleMatch = pageHtml.match(/<h1[^>]*eventitem-title[^>]*>([^<]+)<\/h1>/i);
        const rawTitle = titleMatch ? titleMatch[1].trim() : '';
        const player = rawTitle ? ctaPlayerFromTitle(rawTitle) : null;
        if (!player) continue;

        // Venue
        const venueMatch = pageHtml.match(/eventitem-meta-address-line--title[^>]*>([^<]+)<\/span>/i);
        const venue = venueMatch ? venueMatch[1].trim() : '';

        // City — the address line containing "City, ST, ZIP" (has comma + 2-letter state)
        const cityMatch = pageHtml.match(/class="eventitem-meta-address-line"[^>]*>([^<]+,[^<]+[A-Z]{2}[^<]*)<\/span>/i);
        const city = cityMatch ? cityMatch[1].trim() : '';

        // Event Verification Link — href on the "Event Verification Link" anchor
        const verifyMatch = pageHtml.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>\s*Event Verification Link\s*<\/a>/i);
        const verifyLink = verifyMatch ? verifyMatch[1] : null;

        // Fallback: "click here" show website link after "Verification link confirms"
        const clickHereMatch = pageHtml.match(/Verification link confirms[^<]*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>/i);
        const showLink = clickHereMatch ? clickHereMatch[1] : null;

        // Only keep events that have a real external deep link (not cravetheauto.com itself)
        const link = verifyLink || showLink;
        if (!link) {
          console.log(`  CTA: skipping "${player}" — no external deep link found`);
          continue;
        }
        const sport = ctaDetectSport(rawTitle);

        events.push({
          id:     `cta_${month}${day}_${slug}`,
          player,
          sport,
          date,
          venue,
          city,
          link,
          notes:  rawTitle,
          source: 'cravetheauto.com',
        });
        console.log(`  CTA: "${player}" [${sport}] → ${verifyLink ? 'verify✓' : 'show✓'} ${link}`);
      } catch (e) {
        console.log(`  CTA event error: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 600));
    }
    console.log(`  CraveTheAuto direct: ${events.length} events found`);
  } catch (e) {
    console.log(`  CraveTheAuto direct: error — ${e.message}`);
  }
  return events;
}

// ── DATE GUESSER (no year required) ──────────────────────────────────────────
// Like guessDate() but also matches "April 25th" without a year (assumes current year).
function guessDateApprox(t) {
  const d = guessDate(t);
  if (d) return d;
  const m2 = {
    january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
  };
  for (const [n, v] of Object.entries(m2)) {
    const x = t.match(new RegExp(n + '\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b'));
    if (x) return `${new Date().getFullYear()}-${v}-${x[1].padStart(2,'0')}`;
  }
  return null;
}

// ── FITERMAN SPORTS DIRECT CRAWL ─────────────────────────────────────────────
// Server-rendered HTML listing using My Events Plugin (MEP) WordPress plugin.
// Date is in .mep-day / .mep-month divs; title is in .mep_list_title h5.
async function fetchFitermanSports() {
  const events = [];
  try {
    const html = await fetchDirect('https://fitermansports.com/all-events/');
    if (!html) { console.log('  Fiterman: failed'); return events; }

    // Match each event card: mep-day + mep-month → link → title
    const cardPat = /class="mep-day">(\d+)<\/div>\s*<div[^>]*class="mep-month">(\w+)<\/div>[\s\S]{0,700}?href="(https?:\/\/fitermansports\.com\/event\/[^"]+)"[\s\S]{0,400}?mep_list_title[^>]*>([^<]+)/gi;
    const seen = new Set();
    const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                     jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
    const now = new Date(); now.setHours(0, 0, 0, 0);
    let m;
    while ((m = cardPat.exec(html)) !== null) {
      const [, day, monthAbbr, link, rawTitle] = m;
      if (seen.has(link)) continue;
      seen.add(link);

      // Skip mail-in-only or all-year-around placeholder events
      if (/mail.?in.?only|all.?year.?around/i.test(link)) continue;

      const mo = months[monthAbbr.toLowerCase().slice(0,3)];
      if (!mo) continue;
      const year = now.getFullYear();
      const date = `${year}-${mo}-${day.padStart(2,'0')}`;
      if (new Date(date + 'T00:00:00') < now) continue;

      // Title: "Shawn Kemp (PUBLIC AUTOGRAPH EVENT) Fiterman Sports – League City, TX"
      // Extract player name = text before first "(" or "–"
      const playerRaw = rawTitle.replace(/&[a-z]+;/gi, ' ').split(/[\(–]/)[0].trim();
      if (!playerRaw || playerRaw.split(' ').length < 2) continue;

      // Derive city from the end of title (after last comma or "–")
      const cityMatch = rawTitle.match(/[–-]\s*([^,(–]+(?:,\s*[A-Z]{2})?)[\s.]*$/);
      const city = cityMatch ? cityMatch[1].trim().replace(/&[a-z]+;/gi,'') : '';

      const slug = link.replace(/.*\/event\//, '').replace(/\/$/, '');
      events.push({
        id:     `fiterman_${slug.replace(/-/g, '_')}`,
        player: playerRaw,
        sport:  'other',
        date,
        venue:  'Fiterman Sports',
        city,
        link,
        notes:  '',
        source: 'fitermansports.com',
      });
    }
    console.log(`  Fiterman Sports: ${events.length} events found`);
  } catch (e) {
    console.log(`  Fiterman Sports: error — ${e.message}`);
  }
  return events;
}

// ── TSE BUFFALO DIRECT CRAWL ──────────────────────────────────────────────────
// TSE Buffalo Shopify store — only "AUTOGRAPH TICKET:" products are live signings.
// Dates are in body_html without year ("April 25th"), so uses guessDateApprox().
// Multiple products per player → deduplicated by player name.
async function fetchTSEBuffalo() {
  const events = [];
  try {
    const raw = await fetchDirect('https://tsebuffalo.com/collections/upcoming-buffalo-signings/products.json?limit=250');
    if (!raw) { console.log('  TSE Buffalo: failed'); return events; }

    let data;
    try { data = JSON.parse(raw); } catch { console.log('  TSE Buffalo: bad JSON'); return events; }

    const now = new Date(); now.setHours(0, 0, 0, 0);
    const seenPlayers = new Set();
    for (const product of (data.products || [])) {
      const title = product.title || '';
      // Only in-person signing tickets (skip mail-in, presale memorabilia)
      if (!/^AUTOGRAPH TICKET:/i.test(title)) continue;

      const handle   = product.handle || '';
      const bodyText = (product.body_html || '').replace(/<[^>]+>/g, ' ');
      const combined = (title + ' ' + bodyText).toLowerCase();

      const date = guessDateApprox(combined);
      if (!date) continue;
      if (new Date(date + 'T00:00:00') < now) continue;

      const player = extractPlayerName(title, bodyText);
      if (!player) continue;
      if (seenPlayers.has(player)) continue;
      seenPlayers.add(player);

      // Venue: look for venue name in body text after "THIS SIGNING WILL BE HELD AT:"
      const venueMatch = bodyText.match(/held at[:\s]+([^\n<]{4,60})/i);
      const venue = venueMatch ? venueMatch[1].trim().replace(/\s+/g, ' ') : '';

      events.push({
        id:     `tse_${handle}`,
        player,
        sport:  'other',
        date,
        venue,
        city:   'Buffalo, NY',
        link:   `https://tsebuffalo.com/products/${handle}`,
        notes:  title,
        source: 'tsebuffalo.com',
      });
    }
    console.log(`  TSE Buffalo: ${events.length} events found`);
  } catch (e) {
    console.log(`  TSE Buffalo: error — ${e.message}`);
  }
  return events;
}

// ── AUTHENTIC AUTOGRAPHS (AU) DIRECT CRAWL ───────────────────────────────────
// WordPress-based Australian signing site.
async function fetchAuthenticAutographs() {
  const events = [];
  try {
    const html = await fetchDirect('https://authentic-autographs.com.au/events-greets/');
    if (!html) { console.log('  AuthenticAU: failed'); return events; }

    const NOISE = new Set(['signing','event','appearance','autograph','autographs','meet','greet','and','with','in','store','vip','the','a']);
    // WordPress event links under /events/ or /events-greets/
    const linkPat = /href="(https?:\/\/authentic-autographs\.com\.au\/(?:events?\/|events-greets\/)([a-z0-9][a-z0-9-]+)\/?)"[^>]*/gi;
    const seen = new Set();
    let m;
    while ((m = linkPat.exec(html)) !== null) {
      const [, link, slug] = m;
      const canonical = link.replace(/\/?$/, '/');
      if (seen.has(canonical)) continue;
      seen.add(canonical);

      const slugWords = slug.split('-').filter(w => !/^\d+$/.test(w) && !NOISE.has(w));
      if (slugWords.length < 2) continue;
      const player = slugWords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      const idx = html.indexOf(link);
      const context = html.slice(Math.max(0, idx - 400), idx + 400).toLowerCase().replace(/<[^>]+>/g, ' ');
      const date = guessDate(context);
      if (!date) continue;

      const now = new Date(); now.setHours(0, 0, 0, 0);
      if (new Date(date + 'T00:00:00') < now) continue;

      events.push({
        id:     `authau_${slug.replace(/-/g, '_')}`,
        player,
        sport:  'other',
        date,
        venue:  '',
        city:   'Australia',
        link:   canonical,
        notes:  '',
        source: 'authentic-autographs.com.au',
      });
    }
    console.log(`  AuthenticAU: ${events.length} events found`);
  } catch (e) {
    console.log(`  AuthenticAU: error — ${e.message}`);
  }
  return events;
}

// ── EVENTBRITE DIRECT SCRAPE ──────────────────────────────────────────────────
// Fetches Eventbrite search pages via ScraperAPI and extracts JSON-LD Event data.
// Eventbrite is SSR'd for SEO, so render=false is tried first (cheaper credits),
// with render=true as fallback if the JSON-LD block isn't found.
const EVENTBRITE_SEARCHES = [
  'https://www.eventbrite.com/d/united-states/autograph-signing/',
  'https://www.eventbrite.com/d/united-states/meet-and-greet/',
  'https://www.eventbrite.com/d/united-states/sports-meet-greet/',
  'https://www.eventbrite.com/d/united-states/book-signing/',
];

async function fetchEventbriteEvents() {
  if (!SCRAPER_KEY) { console.log('  Eventbrite: no ScraperAPI key, skipping.'); return []; }
  const events = [];
  const seenLinks = new Set();
  const now = new Date(); now.setHours(0, 0, 0, 0);

  for (const searchUrl of EVENTBRITE_SEARCHES) {
    try {
      // Try render=false first (1 credit), fall back to render=true (10 credits) if no JSON-LD found
      let html = null;
      for (const render of ['false', 'true']) {
        const proxyUrl = `http://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(searchUrl)}&render=${render}`;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 45000);
        try {
          const r = await fetch(proxyUrl, { signal: ctrl.signal });
          clearTimeout(t);
          if (!r.ok) { console.log(`  Eventbrite [render=${render}]: HTTP ${r.status}`); continue; }
          const text = await r.text();
          if (text.includes('application/ld+json')) { html = text; break; }
          console.log(`  Eventbrite [render=${render}]: no JSON-LD, trying rendered…`);
        } catch (e) { clearTimeout(t); }
      }
      if (!html) { console.log(`  Eventbrite ${searchUrl}: no usable response`); continue; }

      // Extract all JSON-LD blocks
      const ldPat = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = ldPat.exec(html)) !== null) {
        let ld;
        try { ld = JSON.parse(m[1]); } catch { continue; }
        if (!ld || typeof ld !== 'object') continue;
        const rawItems = Array.isArray(ld) ? ld
          : ld['@type'] === 'ItemList' ? (Array.isArray(ld.itemListElement) ? ld.itemListElement : []).map(i => i?.item || i)
          : [ld];
        const items = Array.isArray(rawItems) ? rawItems.filter(Boolean) : [];
        for (const ev of items) {
          if (ev['@type'] !== 'Event') continue;
          const name      = ev.name || '';
          const url       = ev.url  || '';
          const startDate = ev.startDate || '';
          if (!url || seenLinks.has(url)) continue;
          seenLinks.add(url);

          const date = startDate.slice(0, 10); // "2026-04-01T10:00:00" → "2026-04-01"
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          if (new Date(date + 'T00:00:00') < now) continue;

          const combined = name.toLowerCase();
          if (!RELEVANT_WORDS.some(w => combined.includes(w))) continue;
          if (/mail-?in|private signing|ship your/.test(combined)) continue;

          const location = ev.location || {};
          const venue = location.name || '';
          const city  = location.address?.addressLocality || '';

          // Try each candidate name in order until one passes Wikipedia verification
          const candidates = extractCandidateNames(name, ev.description || '');
          let player = null;
          for (const candidate of candidates) {
            if (candidate === venue) { console.log(`  [wiki-check] Skipping "${candidate}" — matches venue name`); continue; }
            const isKnown = await isKnownPublicFigure(candidate);
            if (isKnown) { player = candidate; break; }
            console.log(`  [wiki-check] "${candidate}" failed — trying next candidate`);
          }
          if (!player) continue;

          const isBook      = /book signing|book tour|autobiography|memoir/.test(combined);
          const isBball     = /\bnba\b|basketball/.test(combined);
          const isWrestling = /\bwwe\b|wrestling|wrestlemania|aew|raw|smackdown|\bmma\b|\bufc\b|boxing/.test(combined);
          const isOther     = /hockey|baseball|formula.?1/.test(combined);
          const isSoccer    = /soccer|football|futbol|calcio/.test(combined);

          events.push({
            id:     `eb_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
            player,
            sport:  isBook ? 'book' : isBball ? 'basketball' : isWrestling ? 'wrestling' : isOther ? 'other' : isSoccer ? 'soccer' : 'other',
            date,
            venue,
            city,
            link:   url,
            notes:  name,
            source: 'eventbrite.com',
          });
        }
      }
      console.log(`  Eventbrite [${searchUrl.split('/').slice(-2,-1)[0]}]: ${events.length} total so far`);
    } catch (e) {
      console.log(`  Eventbrite error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`  Eventbrite total: ${events.length} events found`);
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
const QUERIES = [...ALL_QUERIES, ...PLAYER_QUERIES, ...INSTAGRAM_QUERIES];

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
  // Countries, regions, generic wrestling/event words
  'United','States','Japan','China','Mexico','Canada','England','Britain',
  'America','Europe','Africa','Asia','Pacific','Latin','Kingdom',
  'Tag','Team','Women','Reunion','Championship','Division','Showcase',
  'Squared','Circle','Expo','Experience','Opportunity','General','Public',
  // Generic event-description words that are not person names
  'Author','Visit','Hosted','Signing','Book','Tour','Presents','Featuring',
  'Special','Annual','Official','Virtual','Free','Private','Exclusive',
  // Known organizer/memorabilia brands (not athlete names)
  'Inscriptagraphs','Tristar','Fanatics','Steiner','Mounted','Memories',
  // Hotel/venue brands that appear in event descriptions
  'Ramada','Marriott','Hilton','Hyatt','Sheraton','Hampton','Doubletree',
  'Holiday','Courtyard','Westin','Ritz','Carlton','Wyndham','Crowne','Plaza',
  // Bookstores / generic venue names
  'Harvard','Barnes','Noble','Amazon','Walmart','Target',
]);
// Common English nouns/animals/adjectives that are never part of a person's name
const NOT_A_NAME_WORD = new Set([
  'kangaroo','panda','bunny','bunny','easter','santa','claus','penguin','tiger',
  'lion','bear','wolf','fox','cat','dog','bird','fish','shark','eagle','hawk',
  'indoor','outdoor','virtual','annual','official','local','national','regional',
  'open','closed','public','private','free','paid','live','online','hybrid',
  'holiday','seasonal','corporate','charity','benefit','fundraiser',
]);

// Returns all candidate person names from a text, in order of appearance.
// Used by extractPlayerName (returns first) and the Wikipedia fallback loop.
function extractCandidateNames(title, snippet) {
  const candidates = [];
  for (let text of [title, snippet]) {
    if (!text) continue;
    // Strip organizer/presenter prefixes like "Inscriptagraphs Presents: ..."
    text = text.replace(/^[^:]+\bPresents?:?\s*/i, '');
    // Strip trailing venue context like "... at Harvard Book Store" / "... in Las Vegas"
    text = text.replace(/\s+(at|in|@)\s+.+$/i, '');
    const matches = text.match(/\b([A-Z][a-zÀ-ÿ'\-]+(?:\s+[A-Z][a-zÀ-ÿ'\-]+){1,2})\b/g) || [];
    for (const m of matches) {
      if (/\d/.test(m)) continue;
      if (/[-–—,;:!?]$/.test(m)) continue;
      const words = m.split(/\s+/);
      if (words.length < 2) continue;
      if (words.some(w => NAME_SKIP.has(w))) continue;
      if (words.some(w => NOT_A_NAME_WORD.has(w.toLowerCase()))) continue;
      if (words[0].length < 2 || words[1].length < 2) continue;
      const allCommon = words.every(w => /^(meet|and|the|for|with|from|book|tour|talk|show|live|free|open|join|sign|sale|fair|fest|expo|camp|club|park|hall|home|room|shop|store|mall|fund|gala|bash|ball|gaze|high|main|back|side|top|pro|new|old|big|hot|red|blue|gold|star|safe|wild|city|town|farm|rock|lake|hill|bay|run|ride|day|night|week|time|work|play|art|pop|hip|hop|rap|dj|mc)$/i.test(w));
      if (allCommon) continue;
      if (!candidates.includes(m)) candidates.push(m);
    }
  }
  return candidates;
}

function extractPlayerName(title, snippet) {
  return extractCandidateNames(title, snippet)[0] || null;
}

// ── WIKIPEDIA PUBLIC-FIGURE VERIFICATION ─────────────────────────────────────
// Returns true if Wikipedia has an article for this name AND the extract
// mentions at least one of: athlete, player, actor, singer, author, wrestler,
// boxer, politician, entrepreneur, celebrity, rapper, comedian, chef, coach,
// executive, director, musician, artist, model, influencer, youtuber, streamer.
const WIKI_CACHE = new Map();
const NOTABLE_RE = /\b(athlete|player|actor|actress|singer|rapper|musician|author|writer|wrestler|boxer|politician|comedian|chef|model|director|producer|executive|entrepreneur|celebrity|influencer|youtuber|streamer|coach|nba|nfl|mlb|nhl|mma|ufc|wwe|hall of fame)\b/i;

async function isKnownPublicFigure(name) {
  if (!name) return false;
  if (WIKI_CACHE.has(name)) return WIKI_CACHE.get(name);
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'MeetGreetEvents/1.0' } });
    clearTimeout(t);
    if (!r.ok) { WIKI_CACHE.set(name, false); return false; }
    const data = await r.json();
    if (data.type === 'disambiguation' || data.type === 'no-extract') { WIKI_CACHE.set(name, false); return false; }
    // Must be a person article — Wikipedia description for people is like "American basketball player"
    // Songs, books, places, orgs have descriptions like "song by X", "film by Y", "hotel chain", etc.
    const desc    = (data.description || '').toLowerCase();
    const extract = (data.extract    || '').toLowerCase();
    const isPersonDesc = NOTABLE_RE.test(desc); // "American rapper", "NFL player", etc.
    // Reject non-person articles
    if (/\b(country|sovereign state|nation|city|town|municipality|village|county|state|province|region|island|continent|ocean|river|mountain|organization|company|corporation|hotel|restaurant|school|university|song|album|film|movie|book|novel|television|tv series|podcast|band|group|duo|trio|franchise|team)\b/i.test(extract)) {
      WIKI_CACHE.set(name, false);
      console.log(`  [wiki-check] "${name}" — Wikipedia article is a place/org/media, not a person`);
      return false;
    }
    // Require either a person-style description OR notable keywords in extract
    const result = isPersonDesc || NOTABLE_RE.test(extract);
    WIKI_CACHE.set(name, result);
    if (!result) console.log(`  [wiki-check] "${name}" — article exists but not a notable public figure: "${(data.extract||'').slice(0,120)}"`);
    return result;
  } catch {
    // Network error: be permissive (don't drop events due to timeout)
    WIKI_CACHE.set(name, true);
    return true;
  }
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
// ── DIRECT FETCH WITH SCRAPERAPI FALLBACK ─────────────────────────────────────
// Tries a plain fetch first; if blocked (403/429/CAPTCHA), retries via ScraperAPI proxy.
async function fetchDirect(url, timeoutMs = 15000) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' };
  // 1. Try direct
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal, headers });
    clearTimeout(t);
    if (r.ok) return r.text();
    if (![403, 429, 503].includes(r.status)) return null; // non-recoverable
    console.log(`  fetchDirect: ${url} returned ${r.status}, trying ScraperAPI…`);
  } catch { /* timeout or network error — try proxy */ }

  // 2. Fallback to ScraperAPI
  if (!SCRAPER_KEY) return null;
  try {
    const proxyUrl = `http://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(url)}&render=false`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const r = await fetch(proxyUrl, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) { console.log(`  ScraperAPI: HTTP ${r.status}`); return null; }
    console.log(`  ScraperAPI: success for ${url}`);
    return r.text();
  } catch (e) {
    console.log(`  ScraperAPI error: ${e.message}`);
    return null;
  }
}

// Tracks keys that have returned auth/quota errors — skipped for remaining queries
const deadKeys = new Set();

async function fetchWithRetry(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.status === 401 || r.status === 402 || r.status === 403) return 'dead';
      if (r.status === 429) return 'dead';
      if (!r.ok) return null;
      const data = await r.json();
      if (data.error && /run out|quota|credit|limit|invalid/i.test(data.error)) return 'dead';
      return data;
    } catch { /* retry */ }
  }
  return null;
}

async function fetchSerper(q, attempts = 3, key = SERPER_KEY) {
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, num: 10 }),
      });
      clearTimeout(t);
      if (r.status === 401 || r.status === 403 || r.status === 429) return 'dead';
      if (!r.ok) return null;
      const data = await r.json();
      if (data.message && /credit|quota|limit|invalid/i.test(data.message)) return 'dead';
      // Normalize Serper response to SerpAPI shape so parseOrganic works unchanged
      return { organic_results: (data.organic || []).map(x => ({
        title:          x.title,
        snippet:        x.snippet,
        link:           x.link,
        displayed_link: x.displayedLink,
      }))};
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
    const isWrestling = !isBook && !isBball && !isPol && !isCeleb && !isNFL && /\bwwe\b|wrestling|wrestlemania|raw|smackdown|aew|ring of honor|impact wrestling|\bmma\b|\bufc\b|boxing/.test(combined);
    const isOther  = !isBook && !isBball && !isPol && !isCeleb && !isNFL && !isWrestling && /gymnast|olympic|mlb|baseball|nhl|hockey|card show|formula.?1|formula one|\bf1\b|grand prix|f1 driver|f1 pilote|f1 pilota|formel 1/.test(combined);
    const isSoccer = !isBook && !isBball && !isPol && !isCeleb && !isNFL && !isWrestling && !isOther && /\bsoccer\b|futbol|calcio|fútbol|\bfootballer\b|calciatore|\bfoot\b|ligue|premier league|bundesliga|serie a|la liga|champions league|\bcopa\b|\bmls\b|\bfifa\b/.test(combined);

    // Try each candidate name until one passes Wikipedia verification
    const nameCandidates = extractCandidateNames(res.title, res.snippet);
    let playerName = null;
    for (const candidate of nameCandidates) {
      const isKnownPlayer = await isKnownPublicFigure(candidate);
      if (isKnownPlayer) { playerName = candidate; break; }
      console.log(`  [wiki-check] "${candidate}" failed — trying next candidate`);
    }
    if (!playerName) continue;

    const eventDate = guessDate(combined);
    if (!eventDate) continue; // skip events with no guessable date

    // Skip generic CraveTheAuto listing pages — seeds already cover these with deep links
    if (/cravetheauto\.com\/autograph-appearances\/?$/.test(res.link)) continue;

    out.push({
      id:     `live_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      player: playerName,
      sport:  isBook ? 'book' : isBball ? 'basketball' : isPol ? 'politics' : isCeleb ? 'celeb' : isNFL ? 'football' : isWrestling ? 'wrestling' : isOther ? 'other' : isSoccer ? 'soccer' : 'other',
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


// ── EPIC / LEAP EVENT TECHNOLOGY DIRECT CRAWL ────────────────────────────────
// https://store.epic.leapevent.tech/ — multi-tenant convention platform
// /api/conventions → JSON with fields: name (slug), year, title, beginUtc, isPast,
//   location.{city,province,venue}
// Each convention page (JS-rendered) has talent cards:
//   <a href="/{slug}/{year}/{talent-slug}">…<h2 class="…ProductTitle…">Name</h2>…</a>
async function fetchEpicEvents() {
  if (!SCRAPER_KEY) { console.log('  Epic/Leap: no ScraperAPI key, skipping.'); return []; }
  const events = [];
  const now = new Date(); now.setHours(0, 0, 0, 0);

  // Keywords in convention title/name that indicate sports/athlete content
  const SPORTS_RE = /wwe|wrestling|wrestlemania|nba|nfl|mlb|nhl|mma|ufc|boxing|sport|athlete|autograph|lids|card.?show|megacon|fan.?expo|comic.?con/i;

  try {
    // Step 1 — get all conventions from the public JSON API
    const ctrl0 = new AbortController();
    const t0 = setTimeout(() => ctrl0.abort(), 15000);
    const r0 = await fetch('https://store.epic.leapevent.tech/api/conventions', { signal: ctrl0.signal });
    clearTimeout(t0);
    if (!r0.ok) { console.log(`  Epic/Leap: API HTTP ${r0.status}`); return []; }
    const conventions = await r0.json();
    if (!Array.isArray(conventions)) { console.log('  Epic/Leap: unexpected API shape'); return []; }
    console.log(`  Epic/Leap: ${conventions.length} total conventions in API`);

    // Step 2 — filter for sports-relevant non-past conventions (use API's isPast flag)
    const relevant = conventions.filter(c => {
      if (c.isPast) return false;
      return SPORTS_RE.test(c.title || '') || SPORTS_RE.test(c.name || '');
    });
    console.log(`  Epic/Leap: ${relevant.length} sports-relevant upcoming/current conventions`);

    // Step 3 — scrape each relevant convention page for talent cards
    for (const conv of relevant) {
      const slug = conv.name || '';
      const year = conv.year || new Date().getFullYear();
      if (!slug) continue;

      const convUrl = `https://store.epic.leapevent.tech/${slug}/${year}`;
      console.log(`  Epic/Leap: scraping ${convUrl}`);

      const html = await fetchRendered(convUrl, 90000);
      if (!html) { console.log(`  Epic/Leap: failed to render ${convUrl}`); continue; }

      // Convention dates from API
      const convDate    = conv.beginUtc ? conv.beginUtc.slice(0, 10) : null;
      const convEndDate = conv.endUtc   ? conv.endUtc.slice(0, 10)   : convDate;

      // Location from nested location object
      const loc   = conv.location || {};
      const venue = loc.venue || '';
      const city  = [loc.city, loc.province].filter(Boolean).join(', ');

      // Sport classification from convention title
      const convTitle = (conv.title || conv.name || '').toLowerCase();
      const sport = /wwe|wrestling|ufc|mma|boxing/.test(convTitle) ? 'wrestling'
        : /nba|basketball/.test(convTitle) ? 'basketball'
        : 'other';

      // Step 4 — extract (link, name) talent pairs from rendered HTML
      // Pattern: anchor matching /{slug}/{year}/{talent-slug}, followed within
      //   3000 chars by <h2 class="...ProductTitle...">Talent Name</h2>
      const cardRe = new RegExp(
        `href="(\\/${slug}\\/${year}\\/([^/"?#]+))"[\\s\\S]{0,3000}?<h2[^>]*ProductTitle[^>]*>([^<]+)<\\/h2>`,
        'gi'
      );
      const seen = new Set();
      let m;
      let convEventCount = 0;
      while ((m = cardRe.exec(html)) !== null) {
        const [, href, talentSlug, rawName] = m;
        if (seen.has(talentSlug)) continue;
        seen.add(talentSlug);

        const talentName = rawName.trim();
        if (!talentName || talentName.length < 3) continue;

        // Skip non-person product entries
        if (/photo op|panel|combo|print|package|general admission|group shot|\bvip\b/i.test(talentName)) continue;

        const link = `https://store.epic.leapevent.tech${href}`;

        // Use start date for display; check end date to avoid excluding multi-day events
        let date = convDate || guessDate(html.toLowerCase().slice(0, 5000));
        if (!date) continue;
        // Skip if the entire convention has ended (compare end date, not start date)
        const endCheck = convEndDate || date;
        if (new Date(endCheck + 'T00:00:00') < now) continue;

        events.push({
          id:     `epic_${slug}_${talentSlug}`,
          player: talentName,
          sport,
          date,
          venue,
          city,
          link,
          notes:  `${conv.title || slug} — meet & greet / autograph signing`,
          source: 'store.epic.leapevent.tech',
        });
        convEventCount++;
      }
      console.log(`  Epic/Leap ${slug}: ${seen.size} talent cards → ${convEventCount} events`);
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (e) {
    console.log(`  Epic/Leap: error — ${e.message}`);
  }
  return events;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Starting update — ${new Date().toISOString()}`);

  const results = [];

  // 7-way split: SerpAPI KEY_1 → KEY_2 → KEY_3 → KEY_4 → Serper KEY_1 → Serper KEY_2 → SearchApi
  const Q = QUERIES.length;
  const SPLIT1 = Math.ceil(Q / 7);
  const SPLIT2 = Math.ceil(Q * 2 / 7);
  const SPLIT3 = Math.ceil(Q * 3 / 7);
  const SPLIT4 = Math.ceil(Q * 4 / 7);
  const SPLIT5 = Math.ceil(Q * 5 / 7);
  const SPLIT6 = Math.ceil(Q * 6 / 7);

  for (const [i, { q, lang }] of QUERIES.entries()) {
    let data;
    let keyLabel;

    if (SEARCHAPI_KEY && !deadKeys.has('searchapi') && i >= SPLIT6) {
      keyLabel = 'searchapi';
      const url = `https://www.searchapi.io/api/v1/search?engine=google&q=${encodeURIComponent(q)}&num=10&api_key=${SEARCHAPI_KEY}`;
      data = await fetchWithRetry(url);
      if (data === 'dead') { console.warn('  ⚠️  SearchApi key dead — falling back to SerpAPI KEY_1 for remaining queries'); deadKeys.add('searchapi'); data = null; }
    } else if (SERPER_KEY2 && !deadKeys.has('serper2') && i >= SPLIT5) {
      keyLabel = 'serper2';
      data = await fetchSerper(q, 3, SERPER_KEY2);
      if (data === 'dead') { console.warn('  ⚠️  Serper KEY_2 quota exhausted for this run'); deadKeys.add('serper2'); data = null; }
    } else if (SERPER_KEY && !deadKeys.has('serper1') && i >= SPLIT4) {
      keyLabel = 'serper1';
      data = await fetchSerper(q, 3, SERPER_KEY);
      if (data === 'dead') { console.warn('  ⚠️  Serper KEY_1 quota exhausted for this run'); deadKeys.add('serper1'); data = null; }
    }

    // Fall back to SerpAPI (KEY_4 → KEY_3 → KEY_2 → KEY_1) when assigned key is dead or unset
    if (data === null || data === undefined) {
      let key, label;
      if (API_KEY_4 && !deadKeys.has('serpapi4') && i >= SPLIT3) {
        key = API_KEY_4; label = 'serpapi4';
      } else if (API_KEY_3 && !deadKeys.has('serpapi3') && i >= SPLIT2) {
        key = API_KEY_3; label = 'serpapi3';
      } else if (API_KEY_2 && !deadKeys.has('serpapi2') && i >= SPLIT1) {
        key = API_KEY_2; label = 'serpapi2';
      } else {
        key = API_KEY_1; label = 'serpapi1';
      }
      keyLabel = label;
      const url = `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&num=10&api_key=${key}`;
      data = await fetchWithRetry(url);
      if (data === 'dead') { console.warn(`  ⚠️  SerpAPI ${label} quota exhausted for this run (recharges monthly)`); deadKeys.add(label); data = null; }
    }

    console.log(`  [${keyLabel}] "${q.substring(0, 55)}"`);
    if (data && data !== 'dead') {
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

  // Direct-crawl Fiterman Sports
  console.log('Fetching Fiterman Sports events directly...');
  const fitermanEvents = await fetchFitermanSports();
  console.log(`Fiterman Sports: ${fitermanEvents.length} events found`);
  results.push(...fitermanEvents);

  // Direct-crawl TSE Buffalo (Shopify — AUTOGRAPH TICKET products only)
  console.log('Fetching TSE Buffalo events directly...');
  const tseEvents = await fetchTSEBuffalo();
  console.log(`TSE Buffalo: ${tseEvents.length} events found`);
  results.push(...tseEvents);

  // Direct-crawl Authentic Autographs (AU, WordPress)
  console.log('Fetching Authentic Autographs (AU) events directly...');
  const authauEvents = await fetchAuthenticAutographs();
  console.log(`Authentic Autographs AU: ${authauEvents.length} events found`);
  results.push(...authauEvents);

  // Direct-scrape Eventbrite search pages via ScraperAPI
  console.log('Fetching Eventbrite events via ScraperAPI...');
  const ebEvents = await fetchEventbriteEvents();
  console.log(`Eventbrite: ${ebEvents.length} events found`);
  results.push(...ebEvents);

  // Direct-crawl Epic / Leap Event Technology (store.epic.leapevent.tech)
  console.log('Fetching Epic/Leap Event Technology events directly...');
  const epicEvents = await fetchEpicEvents();
  console.log(`Epic/Leap: ${epicEvents.length} events found`);
  results.push(...epicEvents);

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

  // Preserve addedAt from previous run (so NEW badge persists across daily updates)
  const todayStr = new Date().toISOString().slice(0, 10);
  let prevAddedAt = {};
  try {
    const prev = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
    for (const e of (prev.events || [])) if (e.id && e.addedAt) prevAddedAt[e.id] = e.addedAt;
  } catch {}
  for (const e of future) {
    e.addedAt = prevAddedAt[e.id] || todayStr;
  }

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
