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
const SCRAPER_KEY   = process.env.SCRAPERAPI_KEY || process.env.SCRAPERAPI_KEY_2; // optional — proxy for direct site fetches
const TM_API_KEY    = process.env.TM_API_KEY;    // Ticketmaster Discovery API — searches for VIP M&G upgrade events

if (!API_KEY_1 && !API_KEY_2 && !API_KEY_3 && !API_KEY_4) {
  console.error('No SERPAPI keys set. Add at least one as a GitHub Secret.');
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
  // cardboardpromotions.com removed — site is dead (ECONNREFUSED)
  { q: 'site:shopdynastysports.com autograph signing athlete appearance',      lang: 'en' },
  { q: 'site:tristarproductions.com autograph signing meet greet athlete',     lang: 'en' },
  { q: 'site:sportsworld-usa.com autograph signing athlete appearance',        lang: 'en' },
  { q: 'site:fathernsonssportsmemorabilia.com autograph signing appearance',   lang: 'en' },
  // ── New organizers discovered via Instagram scouting ──
  { q: 'site:bgautographs.com autograph signing athlete appearance 2026',      lang: 'en' },
  { q: 'site:indycardexchange.com autograph signing athlete appearance 2026',  lang: 'en' },
  { q: 'site:luckycardshows.com autograph signing card show athlete 2026',     lang: 'en' },
  { q: 'site:ultimatelegendsnight.com VIP meet greet legends event 2026',      lang: 'en' },
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
  // ── Europe — Polish ──
  { q: 'site:galacticosshow.pl VIP meet greet legends 2026',                  lang: 'en' },
  { q: 'galacticos show Poland legends meet greet VIP 2026',                  lang: 'en' },
  // ── Europe — German ──
  { q: 'site:starbesuch.de Autogrammstunde Sportler 2026',                    lang: 'de' },
  { q: 'site:fcbayern.com meet greet autograph signing fan event 2026',        lang: 'de' },
  // ── Latin America — Spanish ──
  { q: 'site:puntoticket.com futbolista leyendas firma 2026',                 lang: 'es' },
  { q: 'site:superboletos.com meet greet futbolista 2026',                    lang: 'es' },
  { q: 'site:fanki.com.mx futbolista leyendas partido meet 2026',             lang: 'es' },
  { q: 'site:boletomovil.com firma autografos futbolista meet greet 2026',    lang: 'es' },
  { q: 'site:shopwss.com meet greet legend athlete event 2026',               lang: 'en' },
  { q: 'site:ll12.vip/event LALIGA legend meet greet watch party',           lang: 'en' },
  { q: 'site:meninblazers.com events live soccer legend guest 2026',          lang: 'en' },
  // ── Club fan tours — catch official club-run fan experiences (e.g. Casa Atleti) ──
  { q: 'LaLiga club fan tour USA meet greet fan experience 2026',              lang: 'en' },
  { q: 'soccer club fan weekend USA meet legends VIP experience 2026',         lang: 'en' },
  { q: 'Atletico Madrid Barcelona Real Madrid fan event meet greet USA 2026',  lang: 'en' },
  { q: 'Premier League club fan tour USA meet greet event 2026',               lang: 'en' },
  // ── Talks venues ──
  { q: 'site:92ny.org "in conversation" OR "an evening with" 2026',           lang: 'en' },
  { q: 'site:92ny.org celebrity actor musician athlete author 2026',           lang: 'en' },
  { q: '92ny.org event celebrity famous actor musician athlete 2026',          lang: 'en' },
  { q: 'site:sixthandi.org famous celebrity politician speaker event 2026',   lang: 'en' },
  { q: 'university commencement speaker 2026 celebrity athlete famous',       lang: 'en' },
  { q: 'commencement speaker 2026 announced famous celebrity',                lang: 'en' },
  { q: 'site:streicker.nyc sports celebrity speaker event 2026',              lang: 'en' },
  // ── Book signings — Italy ──
  { q: 'site:eventi.mondadoristore.it firma calciatore sportivo 2026',        lang: 'it' },
  { q: 'site:salonelibro.it firmacopie sportivo calciatore 2026',             lang: 'it' },
  // ── Book signings — Spain ──
  { q: 'site:fnac.es firma de libros futbolista deportista 2026',             lang: 'es' },
  { q: 'site:ferialibromadrid.com firma futbolista deportista 2026',          lang: 'es' },
  { q: 'site:planetadelibros.com firma futbolista sant jordi 2026',           lang: 'es' },
  // ── Book signings — UK ──
  { q: 'site:waterstones.com football soccer sports author signing 2026',     lang: 'en' },
  { q: 'site:londonfestivaloffootballwriting.org event author 2026',          lang: 'en' },
  // ── Book signings aggregator — US ──
  { q: 'site:booksigningcentral.com sports athlete signing 2026',             lang: 'en' },
  // ── Eventbrite — sports & celebrity meet & greet events ──
  { q: 'site:eventbrite.com autograph signing athlete meet greet 2026',       lang: 'en' },
  { q: 'site:eventbrite.com soccer football player meet greet fan 2026',      lang: 'en' },
  { q: 'site:eventbrite.com NBA basketball player signing appearance 2026',   lang: 'en' },
  { q: 'site:eventbrite.com WWE boxing MMA fighter meet greet signing 2026',  lang: 'en' },
  { q: 'site:eventbrite.com celebrity athlete book signing tour 2026',        lang: 'en' },
  // Brand-partnership fan events (e.g. Nike, Dick's, Madison Reed, Oakley) don't appear in
  // sports/signing categories — search by top athlete names directly on Eventbrite
  { q: 'site:eventbrite.com "Paige Bueckers" OR "Caitlin Clark" OR "Angel Reese" fan appearance 2026', lang: 'en' },
  { q: 'site:eventbrite.com WNBA player fan event appearance meet 2026',      lang: 'en' },
  // Oakley / brand-store athlete appearances are posted on the athlete's personal Instagram,
  // not on signing organizers — catch via site: queries on brand pages
  { q: 'site:instagram.com/oakley_us athlete store appearance meet 2026',     lang: 'en' },
  { q: 'site:instagram.com/damianlillard meet store appearance 2026',         lang: 'en' },
  // ── Europe — German (verified: static HTML, dates in URL/JSON-LD) ──
  { q: 'site:bvb.de Autogrammstunde Legendenspiel Fans 2026',                lang: 'de' },
  { q: 'site:fcaugsburg.de Autogrammstunde Spieler 2026',                    lang: 'de' },
  { q: 'site:szene1.at Autogrammstunde Fussball Sportler 2026',              lang: 'de' },
  // ── Europe — French (verified: fclorient & clermontfoot static HTML, dates in URL) ──
  { q: 'site:fclorient.bzh "match des legendes" 2026',                       lang: 'fr' },
  { q: 'site:clermontfoot.com "match des legendes" 2026',                    lang: 'fr' },
  { q: 'site:mhscfoot.com "séance de dédicaces" 2026',                      lang: 'fr' },
  { q: 'site:fnac.fr dédicace footballeur sportif livre signature 2026',     lang: 'fr' },
  { q: 'site:cultura.com dédicace footballeur sportif livre 2026',           lang: 'fr' },
  { q: 'site:sortiraparis.com séance dédicace footballeur sportif 2026',     lang: 'fr' },
  // ── LaLiga — El Partidazo legend watch-party events live on eventbrite.es (not .com) ──
  // These are announced via @laliga and @laligausa Instagram; tickets sold on eventbrite.es
  { q: 'site:eventbrite.es "ElPartidazo" OR "El Partidazo" legend 2026',    lang: 'es' },
  { q: 'site:eventbrite.com "ElPartidazo" laliga legend watch party 2026',  lang: 'en' },
  // ── Europe — Spanish (verified: Real Madrid monthly, Getafe & Sevilla regular store signings) ──
  { q: 'site:realmadrid.com "sesión de firmas" futbolistas 2026',            lang: 'es' },
  { q: 'site:getafecf.com firma autografos 2026',                            lang: 'es' },
  { q: 'site:sevillafc.es "sesión de firmas" OR "firma autógrafos" 2026',   lang: 'es' },
  // ── Europe — Italian (verified: AC Milan & Juventus run regular player M&G at stores; TicketOne for legends) ──
  { q: 'site:acmilan.com "meet greet" player store 2026',                    lang: 'en' },
  { q: 'site:juventus.com "meet greet" store 2026',                          lang: 'it' },
  { q: 'site:ticketone.it "Operazione Nostalgia" 2026',                      lang: 'it' },
  { q: 'site:cardfest.it meet greet calciatore 2026',                        lang: 'it' },
  { q: 'site:festivaldelcalcioitaliano.com firma autografi calciatore 2026', lang: 'it' },
  // ── Europe — Dutch/Belgian ──
  { q: 'site:signedkits.com signeersessie voetballer 2026',                  lang: 'nl' },
  // ── Europe — Austrian event calendar ──
  { q: 'site:szene1.at Autogrammstunde Sportler Fussball event 2026',       lang: 'de' },
  // ── Portugal (verified: Benfica announces sessão de autógrafos in news) ──
  { q: 'site:slbenfica.pt "sessão de autógrafos" 2026',                     lang: 'pt' },
  // ── Latin America — Chile (PuntoTicket) ──
  { q: 'site:puntoticket.com meet greet leyendas futbol firma autografos 2026', lang: 'es' },
  // ── Latin America — Mexico (verified: boletok.com.mx + ticketmaster.com.mx both list leyendas events) ──
  { q: 'site:boletok.com.mx leyendas futbol meet greet 2026',               lang: 'es' },
  { q: 'site:ticketmaster.com.mx "juego de leyendas" 2026',                 lang: 'es' },
  // ── Latin America — Brazil (Sympla) ──
  { q: 'site:sympla.com.br autógrafos futebol jogador encontro fãs 2026',   lang: 'pt' },
  { q: 'site:sympla.com.br meet greet jogador futebol sessão autógrafos',    lang: 'pt' },
  // ── Latin America — Argentina/Uruguay (Passline) ──
  { q: 'site:passline.com futbolista leyenda meet greet firma autografos',   lang: 'es' },
  // ── Fanatics Fest NYC 2026 (July 16-19, Javits Center) ──
  { q: 'fanatics fest nyc 2026 athlete signing meet greet autograph javits',  lang: 'en' },
  { q: 'site:store.epic.leapevent.tech/fanatics-fest-nyc autograph signing meet greet athlete 2026', lang: 'en' },
  { q: '"fanatics fest" 2026 athlete signing meet greet VIP experience',      lang: 'en' },
];

// ── INSTAGRAM ACCOUNTS — venue/organizer accounts to monitor via SerpAPI ──────
// 3 accounts checked per day, rotating through the full list every ~N/3 days.
const INSTAGRAM_ACCOUNTS = [
  // ── Athlete personal accounts + brand partners that post store appearances ──
  'damianlillard',   // posts his own brand-partnership store appearances (Oakley, etc.)
  'oakley_us',       // announces athlete in-store events at Oakley retail locations
  // ── Sports drink / CPG brands that run athlete in-store fan events ──
  'drinkrecover',    // Recover 180 — posts athlete store appearances (e.g. Buddy Hield at Kroger)
  'bodyarmor',       // Body Armor sports drink — frequent athlete fan-event partner
  'gatorade',        // Gatorade athlete appearances and activations
  'powerade',        // Powerade athlete events
  'celsiusofficial', // Celsius energy drink — NBA/NFL athlete events
  'primehydrate',    // Prime Hydration — Logan Paul/KSI brand, athlete appearances
  // ── Retail chains that host athlete in-store events ──
  'kroger',          // Kroger grocery — hosts brand-partnership athlete appearances
  'targetstyle',     // Target — athlete brand-partnership events
  'walmart',         // Walmart — athlete in-store activations
  // ── USA — multi-sport / card shows ──
  'cravetheauto',
  'cardvaultbytombrady',
  'cardvaultboston',
  'cardvaultsacramento',
  'cardvaultla',
  'best_card_shop',
  'footballfactory_nyc',
  'newyorkfoxes',
  'mtr7_sports',
  'pereirajogodasestrelas',
  'jogodoronaldinho',
  'jcollection1897',
  'blacknwhitemalta',
  'clashoflegends.id',
  'ligamonumental',    // Venezuela baseball legends M&G events
  'sebafrey',
  'dickssportinggoods',
  'dickshouseofsport',   // uses "athlete appearances" not "autograph signing"
  'shopwss',
  'fitermansports',
  'bighornautographs',
  'palmbeachautographs',
  'tsebuffalo',
  'ptframing12',        // Prime Time Sports & Framing — signing organizer at Great Northern Mall OH
  'greatnorthernmalloh', // mall account that co-posts athlete signing events with ptframing12
  'boomtownsportscards', // Boomtown Sports Cards & Collectibles, San Antonio TX — in-shop signings
  'nynjsportsworld',
  'woodbridgebrewingco',
  'tristar1',
  'fodcaesars',        // Field of Dreams at Caesars Palace — celeb/athlete signings Las Vegas
  'simplyseattle',     // Simply Seattle retail — NBA legend signing events (Gary Payton etc.)
  'gary.payton.20',    // Gary Payton official — posts his own signing/M&G appearances
  'halloffamesignings',
  'millcreeksports1991',
  'upperdecksports',
  'fanaticsfest',
  'nbastore',
  'wnba',
  'dallaswings',   // Paige Bueckers' team — announces brand-partnership fan events
  // ── Soccer charity / celebrity legends matches ──
  'socceraid',      // Soccer Aid for UNICEF — annual legends+celeb match (London Stadium); VIP/fan zone packages
  'fifaworldcup',   // FIFA World Cup 2026 — fan festivals in host cities (US/Canada/Mexico) with legend appearances
  // ── Soccer media / live show events ──
  'meninblazers',   // Men in Blazers live shows featuring soccer legends
  'plinusa',        // Premier League USA fan events
  // ── LaLiga — El Partidazo legend watch-party events (eventbrite.es, not .com) ──
  'laliga',
  'laligausa',      // US-specific LaLiga account announcing El Partidazo legend events
  'vipnation',      // VIP Nation — posts new artist M&G tour packages
  'vipnationeu',    // VIP Nation Europe — European artist M&G packages
  'livenation',     // Live Nation — major concert promoter, posts VIP upgrade packages
  // ── UK — soccer / sports signing organizers ──
  'superstarspeakers_ltd',
  'allstarsignings',
  'iconsseries',
  'worldwide_signings',
  // ── Europe — soccer legends events ──
  'fcbayernworld',
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
  // ── Europe — German clubs (fan days & signing events) ──
  'bvb09',
  'fcbayern',
  'eintrachtfrankfurt',
  // ── Europe — Italian events ──
  'festivaldelcalcioitaliano',
  'fibersportsmemorabilia',
  // ── Europe — Dutch signings ──
  'signedkits',
  // ── Europe — Austrian event calendar ──
  'szene1at',
  // ── Latin America — Mexico ──
  'meetandgreet_experience_mexico',
  'firm_autografos',
  // ── Latin America — Chile / South America legends events ──
  'dueloleyendas',
  // ── Latin America — Brazil legends ──
  'legendasbr',
  // ── Latin America — Argentina/Uruguay ──
  'passlinearg',
  // ── UK — additional football signing organizers ──
  'exclusivememorabilia',
  // ── Indonesia — soccer legends events ──
  'operaintermanagement',  // Opera International Management — Class of Stars (Villa, Raúl) Jakarta
  // ── Basketball clinics / youth events ──
  'christbelking',         // Christ The King HS Queens NY — Nate Robinson clinic
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
  'Rivaldo',
  'Fernando Morientes',
  'Roberto Carlos',
  'Ronaldinho',
  'Usain Bolt',
  'Michael Phelps',
  'Katie Ledecky',
  'Allen Iverson',
  'Dennis Rodman',
  'Larry Johnson',
  'TJ McConnell',
  'Cain Velasquez',
  'Javier Pastore',
  'Kaká',
  'Alessandro Del Piero',
  'Andriy Shevchenko',
  'Javier Saviola',
  'Calvin Murphy',
  'David Villa',
  'Raúl González',
  'Nate Robinson',
  'Rick Ross',
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
  // los-angeles removed — returns 404
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
          title:  deriveEventTitle(rawTitle, player) || undefined,
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

// ── SPORT DETECTION HELPER ───────────────────────────────────────────────────
// Player names alone often don't contain sport keywords, so we use a two-step
// approach: try the event context text first, then fall back to a player lookup.
const KNOWN_ATHLETE_SPORTS = {
  // Basketball (NBA)
  'shawn kemp': 'basketball', 'gary payton': 'basketball', 'damian lillard': 'basketball',
  'carmelo anthony': 'basketball', 'allen iverson': 'basketball', 'paul pierce': 'basketball',
  'ray allen': 'basketball', 'vince carter': 'basketball', 'tracy mcgrady': 'basketball',
  // Baseball (MLB)
  'jeremy peña': 'baseball', 'jeremy pena': 'baseball', 'jose altuve': 'baseball',
  'yordan alvarez': 'baseball', 'alex bregman': 'baseball', 'kyle tucker': 'baseball',
  // Football (NFL)
  'earl campbell': 'football', 'vince young': 'football', 'ricky williams': 'football',
  'christian benford': 'football', 'wayne chrebet': 'football', 'boomer esiason': 'football',
  'jim kelly': 'football', 'thurman thomas': 'football', 'andre reed': 'football',
  // Wrestling (WWE/AEW)
  'ric flair': 'wrestling', 'hulk hogan': 'wrestling', 'stone cold': 'wrestling',
  'the rock': 'wrestling', 'dwayne johnson': 'wrestling', 'john cena': 'wrestling',
};

async function detectSport(player, context) {
  // 1. Check context (event title / description / slug) for sport keywords
  const ctx = (context || '').toLowerCase();
  if (/\bnfl\b|quarterback|wide receiver|running back|linebacker|tight end|super bowl|wrestlecon/i.test(ctx)) return 'football';
  if (/\bnba\b|basketball/.test(ctx)) return 'basketball';
  if (/\bmlb\b|baseball/.test(ctx)) return 'baseball';
  if (/\bnhl\b|hockey/.test(ctx)) return 'other';
  if (/\bwwe\b|wrestling|wrestle.?con|wrestlemania/i.test(ctx)) return 'wrestling';
  if (/soccer|futbol|mls|laliga|footballer/.test(ctx)) return 'soccer';
  // 2. Known player lookup (fast path, no network call)
  const found = KNOWN_ATHLETE_SPORTS[(player || '').toLowerCase()];
  if (found) return found;
  // 3. Wikipedia lookup — description is authoritative ("American baseball player", etc.)
  //    wikiLookup is cached, so repeated calls for the same player are free.
  const { sport } = await wikiLookup(player || '');
  if (sport) return sport;
  return 'other';
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
        title:  deriveEventTitle(rawTitle, playerRaw) || undefined,
        sport:  await detectSport(playerRaw, rawTitle),
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

      // TSE titles end with "by [First Last]" — extract that directly before
      // falling back to generic extractPlayerName which can grab false positives.
      const byMatch = title.match(/\bby\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*$/i);
      const player = (byMatch ? byMatch[1].trim() : null) || extractPlayerName(title, bodyText);
      if (!player) continue;
      if (seenPlayers.has(player)) continue;
      seenPlayers.add(player);

      // Venue: look for venue name in body text after "THIS SIGNING WILL BE HELD AT:"
      const venueMatch = bodyText.match(/held at[:\s]+([^\n<]{4,60})/i);
      const venue = venueMatch ? venueMatch[1].trim().replace(/\s+/g, ' ') : '';

      events.push({
        id:     `tse_${handle}`,
        player,
        title:  deriveEventTitle(title, player) || undefined,
        sport:  await detectSport(player, title),
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

// ── INSCRIPTAGRAPHS DIRECT CRAWL ─────────────────────────────────────────────
// Shopify store in Las Vegas — products.json, filter by "signing" in title.
async function fetchInscriptagraphs() {
  const events = [];
  try {
    const raw = await fetchDirect('https://inscriptagraphs.com/products.json?limit=250&sort_by=created-descending');
    if (!raw) { console.log('  Inscriptagraphs: failed'); return events; }
    let data;
    try { data = JSON.parse(raw); } catch { console.log('  Inscriptagraphs: bad JSON'); return events; }

    const now = new Date(); now.setHours(0, 0, 0, 0);
    const seenPlayers = new Set();
    for (const product of (data.products || [])) {
      const title = product.title || '';
      if (!/signing/i.test(title)) continue;

      const handle   = product.handle || '';
      const bodyText = (product.body_html || '').replace(/<[^>]+>/g, ' ');
      const combined = title + ' ' + bodyText;

      const date = guessDateApprox(combined.toLowerCase());
      if (!date) continue;
      if (new Date(date + 'T00:00:00') < now) continue;

      // Name is typically "Firstname Lastname - ..." before the first dash
      const dashPart = title.split(/\s+[-–]\s+/)[0].trim();
      const player = extractPlayerName(dashPart, bodyText) || extractPlayerName(title, bodyText);
      if (!player) continue;
      if (seenPlayers.has(player)) continue;
      seenPlayers.add(player);

      events.push({
        id:     `inscriptagraphs_${handle}`,
        player,
        title:  deriveEventTitle(title, player) || undefined,
        sport:  await detectSport(player, combined),
        date,
        venue:  'Inscriptagraphs Memorabilia',
        city:   'Las Vegas, NV',
        link:   `https://inscriptagraphs.com/products/${handle}`,
        notes:  title,
        source: 'inscriptagraphs.com',
      });
    }
    console.log(`  Inscriptagraphs: ${events.length} events found`);
  } catch (e) {
    console.log(`  Inscriptagraphs: error — ${e.message}`);
  }
  return events;
}

// ── SPORTSWORLD USA DIRECT CRAWL ─────────────────────────────────────────────
// Shopify store in Saugus, MA — /pages/events has upcoming in-person signings.
// Structure: <a href="/products/[slug]"><h3>Apr 3, 2026 - 5 TO 7PM</h3>TITLE</a>
async function fetchSportsworldUSA() {
  const events = [];
  try {
    const html = await fetchDirect('https://www.sportsworld-usa.com/pages/events');
    if (!html) { console.log('  SportsworldUSA: failed'); return events; }

    const now = new Date(); now.setHours(0, 0, 0, 0);
    // Match anchor → h3 date → text title pattern
    const blockRe = /<a[^>]+href="(\/products\/([^"]+))"[^>]*>[\s\S]{0,200}?<h3[^>]*>([^<]+)<\/h3>([\s\S]{0,300}?)<\/a>/gi;
    const seen = new Set();
    let m;
    while ((m = blockRe.exec(html)) !== null) {
      const [, href, slug, dateRaw, rest] = m;
      const link = `https://www.sportsworld-usa.com${href}`;
      if (seen.has(link)) continue;
      seen.add(link);

      const date = guessDateApprox(dateRaw.toLowerCase()) || guessDate(dateRaw.toLowerCase());
      if (!date) continue;
      if (new Date(date + 'T00:00:00') < now) continue;

      const titleRaw = rest.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const player = extractPlayerName(titleRaw, dateRaw) || titleRaw.split(/[–-]/)[0].trim();
      if (!player || player.length < 3) continue;

      events.push({
        id:     `swusa_${slug}`,
        player,
        title:  deriveEventTitle(titleRaw, player) || undefined,
        sport:  await detectSport(player, titleRaw),
        date,
        venue:  '184 Broadway',
        city:   'Saugus, MA',
        link,
        notes:  titleRaw,
        source: 'sportsworld-usa.com',
      });
    }
    console.log(`  SportsworldUSA: ${events.length} events found`);
  } catch (e) {
    console.log(`  SportsworldUSA: error — ${e.message}`);
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
        sport:  await detectSport(player, context),
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

          // First try to extract performer from structured title patterns:
          // "Darcy Michael Book Signing at ..." → "Darcy Michael"
          // "Meet & Greet w/ Wayne Chrebet @ ..." → "Wayne Chrebet"
          const titlePatterns = [
            /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:book signing|autograph signing|signing event|meet\s*[&+]\s*greet)/i,
            /(?:meet\s*[&+]\s*greet|signing|event|appearance)\s+w(?:ith|\/)\s+(?:[^A-Z]*?)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
            // "Brand Event with Paige Bueckers" / "Mane Madness Event with Paige Bueckers"
            /\bevent\s+with\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
          ];
          let player = null;
          for (const pat of titlePatterns) {
            const tm = name.match(pat);
            if (tm && tm[1] && !NAME_SKIP.has(tm[1].split(' ')[0])) { player = tm[1].trim(); break; }
          }
          // Fall back to Wikipedia-verified candidate
          if (!player) {
            const candidates = extractCandidateNames(name, ev.description || '');
            for (const candidate of candidates) {
              if (candidate === venue) { console.log(`  [wiki-check] Skipping "${candidate}" — matches venue name`); continue; }
              const isKnown = await isKnownPublicFigure(candidate);
              if (isKnown) { player = candidate; break; }
              console.log(`  [wiki-check] "${candidate}" failed — trying next candidate`);
            }
          }
          if (!player) continue;

          const isBook      = /book signing|book tour|autobiography|memoir/.test(combined);
          const isBball     = /\bnba\b|basketball/.test(combined);
          const isWrestling = /\bwwe\b|wrestling|wrestlemania|aew|raw|smackdown|\bmma\b|\bufc\b|boxing/.test(combined);
          const isFootball  = /\bnfl\b|american football|quarterback|wide receiver|running back|tight end|linebacker/.test(combined);
          const isBaseball  = /\bmlb\b|baseball/.test(combined);
          const isOther     = /hockey|formula.?1/.test(combined);
          const isSoccer    = /soccer|football|futbol|calcio/.test(combined);

          events.push({
            id:     `eb_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
            player,
            title:  deriveEventTitle(name, player) || undefined,
            sport:  isBook ? 'book' : isBball ? 'basketball' : isWrestling ? 'wrestling' : isFootball ? 'football' : isBaseball ? 'baseball' : isOther ? 'other' : isSoccer ? 'soccer' : await detectSport(player, combined),
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
  q: `site:instagram.com/${account} autograph signing meet greet athlete appearance fan event 2026`,
  lang: 'en',
}));

// Rotate ALL_QUERIES to stay within monthly API quota.
// First 16 (broad sport/celeb queries) run every time.
// The remaining ~147 are split into 4 groups; one group runs per 4-day cycle.
// Result: ~53 constant queries per run instead of 163, cycling full coverage every 16 days.
// 2 groups × 4-day schedule = every query revisited every 8 days (within 10-day max).
// ~90 queries/run. Early-month runs use full SerpAPI quota; later runs fall back to Serper.
// Carry-forward preserves events found in quota-rich runs throughout the month.
const CORE_QUERIES = ALL_QUERIES.slice(0, 16);
const POOL_QUERIES = ALL_QUERIES.slice(16);
const poolGroup = Math.floor(dayOfYear / 4) % 2;
const POOL_TODAY  = POOL_QUERIES.filter((_, i) => i % 2 === poolGroup);
// ── VIP Nation + Live Nation — artist M&G upgrade packages (always run) ──────
const VIPNATION_QUERIES = [
  { q: 'site:vipnation.com "meet and greet" artist 2026',                   lang: 'en' },
  { q: 'site:vipnation.com "meet & greet" VIP upgrade tour 2026',           lang: 'en' },
  { q: 'site:vipnation.eu "meet and greet" OR "meet & greet" 2026',         lang: 'en' },
  { q: 'site:livenation.com "meet and greet" "not a concert ticket" 2026',  lang: 'en' },
  { q: 'site:livenation.com "pre-show m&g" OR "meet & greet upgrade" 2026', lang: 'en' },
];

console.log(`Query rotation: ${CORE_QUERIES.length} core + ${POOL_TODAY.length} pool (group ${poolGroup + 1}/2) + ${PLAYER_QUERIES.length} players + ${INSTAGRAM_QUERIES.length} instagram + ${VIPNATION_QUERIES.length} vipnation`);

// Final query list: core + today's pool slice + today's player queries + today's Instagram accounts + always-run VIP Nation/Live Nation
const QUERIES = [...CORE_QUERIES, ...POOL_TODAY, ...PLAYER_QUERIES, ...INSTAGRAM_QUERIES, ...VIPNATION_QUERIES];

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
  // Common first words of book/song titles that are NOT person names
  'Fill','Play','Love','Struggle','Books','Author','Reading','Roseland',
  'Winning','Building','Finding','Becoming','Growing','Healing','Rising',
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

// Derive a short event title from a raw event name + player name.
// Strips the player name and noise words; returns a meaningful subtitle or ''.
function deriveEventTitle(rawTitle, player) {
  if (!rawTitle || !player) return '';
  // If there's a dash/em-dash separator, the part before it is often the event name
  const dashParts = rawTitle.split(/\s+[—–]\s+/);
  if (dashParts.length > 1) {
    const pre = dashParts[0].trim();
    const preNorm = pre.toLowerCase().replace(/[^a-z]/g, '');
    const playerNorm = player.toLowerCase().replace(/[^a-z]/g, '');
    if (preNorm !== playerNorm && pre.length >= 4 && pre.length <= 60) return pre;
  }
  // Strip only the player name; keep event type words like "Autograph Signing", "Appearance"
  const cleaned = rawTitle
    .replace(new RegExp(player.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
    .replace(/[-–—,·|()[\]]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (cleaned.length >= 4 && cleaned.length <= 70) return cleaned;
  return '';
}

// ── WIKIPEDIA PUBLIC-FIGURE VERIFICATION ─────────────────────────────────────
// Returns true if Wikipedia has an article for this name AND the extract
// mentions at least one of: athlete, player, actor, singer, author, wrestler,
// boxer, politician, entrepreneur, celebrity, rapper, comedian, chef, coach,
// executive, director, musician, artist, model, influencer, youtuber, streamer.
// WIKI_CACHE stores { known: bool, sport: string|null } so both isKnownPublicFigure
// and detectSport share a single Wikipedia fetch per name.
const WIKI_CACHE = new Map();
const NOTABLE_RE = /\b(athlete|player|footballer|golfer|actor|actress|singer|rapper|musician|author|writer|wrestler|boxer|politician|comedian|chef|model|director|producer|executive|entrepreneur|celebrity|influencer|youtuber|streamer|coach|nba|nfl|mlb|nhl|mma|ufc|wwe|hall of fame)\b/i;

// Derive sport from Wikipedia description + first-paragraph extract.
// Wikipedia descriptions are concise: "American baseball player", "professional wrestler", etc.
function sportFromWikiText(desc, extract) {
  const t = (desc + ' ' + extract).toLowerCase();
  if (/\bbaseball\b|\bmlb\b/.test(t))                                    return 'baseball';
  if (/\bbasketball\b|\bnba\b/.test(t))                                  return 'basketball';
  if (/american football|\bnfl\b|\bfootball player\b|\bfootball coach\b/.test(t)) return 'football';
  if (/\bfootballer\b|association football|\bsoccer\b/.test(t))          return 'soccer';
  if (/\bwrestler\b|\bprofessional wrestling\b|\bwwe\b|\bwcw\b|\bawf\b|\braw\b|\bsmackdown\b/.test(t)) return 'wrestling';
  if (/\bboxer\b|\bboxing\b|\bmma\b|\bufc\b/.test(t))                    return 'wrestling';
  if (/\bhockey\b|\bnhl\b/.test(t))                                      return 'other';
  if (/\bgolfer\b|\bgolf\b|\btennis\b|\bswimmer\b|\bgymnast\b|\btrack and field\b/.test(t)) return 'other';
  if (/\bactor\b|\bactress\b|\bcomedian\b|\bmusician\b|\bsinger\b|\bdirector\b|\bfilmmaker\b/.test(t)) return 'celeb';
  return null; // unknown — fall back to other logic
}

async function wikiLookup(name) {
  if (!name) return { known: false, sport: null };
  if (WIKI_CACHE.has(name)) return WIKI_CACHE.get(name);
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'MeetGreetEvents/1.0' } });
    clearTimeout(t);
    if (!r.ok) { const v = { known: false, sport: null }; WIKI_CACHE.set(name, v); return v; }
    const data = await r.json();
    if (data.type === 'disambiguation' || data.type === 'no-extract') {
      const v = { known: false, sport: null }; WIKI_CACHE.set(name, v); return v;
    }
    const desc    = (data.description || '').toLowerCase();
    const extract = (data.extract    || '').slice(0, 400).toLowerCase();
    const isPersonDesc = NOTABLE_RE.test(desc);
    // Reject non-person articles (places, orgs, media)
    if (/\b(country|sovereign state|nation|city|town|municipality|village|county|state|province|region|island|ocean|river|mountain|organization|company|corporation|hotel|restaurant|school|university|song|album|film|movie|book|novel|television|tv series|podcast|band|group|duo|trio|franchise|team)\b/i.test(extract)) {
      console.log(`  [wiki-check] "${name}" — article is a place/org/media, not a person`);
      const v = { known: false, sport: null }; WIKI_CACHE.set(name, v); return v;
    }
    const known = isPersonDesc || NOTABLE_RE.test(extract);
    const sport = sportFromWikiText(desc, extract);
    if (!known) console.log(`  [wiki-check] "${name}" — not a notable public figure: "${(data.extract||'').slice(0,120)}"`);
    const v = { known, sport };
    WIKI_CACHE.set(name, v);
    return v;
  } catch {
    // Network error: be permissive
    const v = { known: true, sport: null };
    WIKI_CACHE.set(name, v);
    return v;
  }
}

async function isKnownPublicFigure(name) {
  return (await wikiLookup(name)).known;
}

// ── DATE GUESSER ─────────────────────────────────────────────────────────────
function guessDate(t) {
  const m = {
    // English
    january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
    // German
    januar:'01',februar:'02',märz:'03',maerz:'03',mai:'05',juni:'06',
    juli:'07',august:'08',september:'09',oktober:'10',november:'11',dezember:'12',
    // French
    janvier:'01',février:'02',fevrier:'02',mars:'03',avril:'04',
    juin:'06',juillet:'07',août:'08',aout:'08',septembre:'09',
    octobre:'10',décembre:'12',decembre:'12',
    // Spanish/Portuguese
    enero:'01',febrero:'02',marzo:'03',mayo:'05',junio:'06',
    julio:'07',agosto:'08',septiembre:'09',setiembre:'09',octubre:'10',
    noviembre:'11',diciembre:'12',
    // Italian
    gennaio:'01',febbraio:'02',aprile:'04',maggio:'05',giugno:'06',
    luglio:'07',settembre:'09',ottobre:'10',dicembre:'12',
    // Dutch
    januari:'01',februari:'02',maart:'03',april:'04',mei:'05',
    augustus:'08',oktober:'10',
  };
  for (const [n, v] of Object.entries(m)) {
    // "15 März 2026", "15. März 2026", "März 15, 2026", "15 de marzo de 2026"
    let x = t.match(new RegExp('(\\d{1,2})\\.?\\s+' + n + '\\s+2026', 'i'));
    if (x) return `2026-${v}-${x[1].padStart(2,'0')}`;
    x = t.match(new RegExp(n + '\\.?\\s+(\\d{1,2})[,\\s]+2026', 'i'));
    if (x) return `2026-${v}-${x[1].padStart(2,'0')}`;
    // "15 de marzo de 2026"
    x = t.match(new RegExp('(\\d{1,2})\\s+de\\s+' + n + '\\s+de\\s+2026', 'i'));
    if (x) return `2026-${v}-${x[1].padStart(2,'0')}`;
  }
  return null;
}

// ── FETCH ─────────────────────────────────────────────────────────────────────
// ── DIRECT FETCH WITH SCRAPERAPI FALLBACK ─────────────────────────────────────
// Tries a plain fetch first; if blocked (403/429/CAPTCHA), retries via ScraperAPI proxy.
async function fetchDirect(url, timeoutMs = 15000) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  };
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

// ── Ticketmaster Discovery API — search for VIP meet & greet upgrade events ──
// Searches for events whose name contains "meet" and "greet" (or "vip upgrade").
// Returns normalized event objects ready for deduplication + injection.
async function fetchTicketmasterMG() {
  if (!TM_API_KEY) return [];
  const out = [];
  // Tested keywords — "meet and greet" and "vip upgrade" are the two that return results.
  // Countries tested — only US, CA, GB, NL, ES, MX, CZ return results; others consistently 0.
  const keywords = ['meet and greet', 'vip upgrade', 'meet & greet'];
  const countries = ['US', 'CA', 'GB', 'NL', 'ES', 'MX', 'CZ', 'IE', 'AU', 'DE', 'FR', 'IT', 'PL'];
  for (const cc of countries) {
  for (const kw of keywords) {
    try {
      const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_API_KEY}&keyword=${encodeURIComponent(kw)}&countryCode=${cc}&size=50&sort=date,asc`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) { console.warn(`TM API error ${r.status}`); continue; }
      const data = await r.json();
      const events = data?._embedded?.events || [];
      for (const ev of events) {
        const name = ev.name || '';
        if (!/meet.?(&\s*)?greet|vip.*upgrade/i.test(name)) continue;
        // Skip non-M&G upgrades: Amped Up = Summerfest premium seating only (no artist contact)
        if (/amped.?up|photo.?merch.?upsell|bluey|bethel music|q&a upgrade/i.test(name)) continue;
        // Skip lottery/prize
        if (/lottery|raffle|contest|giveaway|sweepstake/i.test(name)) continue;
        const dateStr = ev.dates?.start?.localDate;
        if (!dateStr || new Date(dateStr + 'T12:00:00') < today) continue;
        const venue  = ev._embedded?.venues?.[0];
        const city   = venue ? `${venue.city?.name || ''}, ${venue.state?.stateCode || venue.country?.countryCode || ''}` : '';
        const link   = ev.url || '';
        if (!link) continue;
        // Extract artist name from event name (strip " VIP Meet and Greet Upgrade" suffix)
        const player = name.replace(/\s*[-–—]?\s*(vip\s*)?(meet\s*(&|and)\s*greet|meet\s*greet)\s*(upgrade|experience|ticket)?/gi, '').trim() || name;
        out.push({
          id:      `tm_${ev.id}`,
          player,
          sport:   'celeb',
          date:    dateStr,
          time:    ev.dates?.start?.localTime?.slice(0, 5) || '',
          venue:   venue?.name || '',
          city:    city ? `${city} ${({US:'🇺🇸',CA:'🇨🇦',GB:'🇬🇧',IE:'🇮🇪',AU:'🇦🇺',NL:'🇳🇱',DE:'🇩🇪',FR:'🇫🇷',ES:'🇪🇸',MX:'🇲🇽',CZ:'🇨🇿',IT:'🇮🇹',PL:'🇵🇱'})[cc] || ''}` : '',
          link,
          notes:   `Ticketmaster VIP M&G upgrade. Concert ticket sold separately.`,
          source:  'ticketmaster.com (Discovery API)',
          addedAt: new Date().toISOString().slice(0, 10),
        });
      }
    } catch (e) { console.warn('TM fetch error:', e.message); }
    await new Promise(r => setTimeout(r, 300));
  }
  } // end countries loop
  // Deduplicate by link
  const seen = new Set();
  return out.filter(e => { if (seen.has(e.link)) return false; seen.add(e.link); return true; });
}

async function parseOrganic(data, lang) {
  const out = [];
  for (const res of (data.organic_results || [])) {
    const combined = (res.title + ' ' + (res.snippet || '')).toLowerCase();
    if (!RELEVANT_WORDS.some(w => combined.includes(w))) continue;
    if (!combined.includes('2026')) continue;
    if (!res.link) continue;
    if (/mail-?in signing|ship your|private signing/.test(combined)) continue;

    // Talk venues — include as noMG:true talk events even without M&G keywords
    const isTalkVenue = /92ny\.org|sixthandi\.org|streicker\.nyc/.test(res.link);

    // Skip pure talk/interview events with no fan M&G component (unless from a talk venue)
    if (!isTalkVenue && /in conversation with|in conversation:|a conversation with|talks? with|interview with|evening with.*broadway|broadway.*in conversation/.test(combined)
        && !/meet.?greet|autograph|signing|fan event|vip meet/.test(combined)) continue;

    // ── SKIP lottery/contest/prize events — not open ticketed M&G ────────────
    if (/\b(win|winner|contest|lottery|raffle|sweepstake|giveaway|prize|draw)\b.{0,60}\b(meet|greet|trip|ticket|experience)\b|\b(meet|greet|trip|ticket|experience)\b.{0,60}\b(win|winner|contest|lottery|raffle|sweepstake|giveaway|prize|draw)\b/i.test(combined)) continue;

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
    const isSoccer = !isBook && !isBball && !isPol && !isCeleb && !isNFL && !isWrestling && !isOther && /\bsoccer\b|futbol|calcio|fútbol|\bfootballer\b|calciatore|\bfoot\b|ligue|premier league|bundesliga|serie a|la liga|\blaliga\b|champions league|\bcopa\b|\bmls\b|\bfifa\b|elpartidazo|el partidazo/.test(combined);

    // Wikipedia verification: only for celebs and non-athlete book authors.
    // Athletes (any sport) are trusted — their events are sport-specific queries.
    const isAthlete = isBball || isNFL || isWrestling || isOther || isSoccer;
    const nameCandidates = extractCandidateNames(res.title, res.snippet);
    let playerName = null;
    if (isAthlete) {
      playerName = nameCandidates[0] || null;
    } else {
      for (const candidate of nameCandidates) {
        const isKnownPlayer = await isKnownPublicFigure(candidate);
        if (isKnownPlayer) { playerName = candidate; break; }
        console.log(`  [wiki-check] "${candidate}" failed — trying next candidate`);
      }
    }
    if (!playerName) continue;

    // Try date from title+snippet first; fall back to ISO date embedded in the URL
    const urlIsoMatch = (res.link || '').match(/\b(20\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
    const eventDate = guessDate(combined) || (urlIsoMatch ? urlIsoMatch[0] : null);
    if (!eventDate) continue; // skip events with no guessable date

    // Skip generic CraveTheAuto listing pages — seeds already cover these with deep links
    if (/cravetheauto\.com\/autograph-appearances\/?$/.test(res.link)) continue;

    const talkVenueNames = { '92ny.org': '92NY (92nd Street Y)', 'sixthandi.org': 'Sixth & I', 'streicker.nyc': 'Streicker Center' };
    const talkVenueKey = Object.keys(talkVenueNames).find(k => res.link.includes(k));
    out.push({
      id:     `live_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      player: playerName,
      title:  deriveEventTitle(res.title || '', playerName) || undefined,
      sport:  isTalkVenue ? 'talk' : isBook ? 'book' : isBball ? 'basketball' : isPol ? 'politics' : isCeleb ? 'celeb' : isNFL ? 'football' : isWrestling ? 'wrestling' : isOther ? 'other' : isSoccer ? 'soccer' : 'other',
      ...(isTalkVenue && { noMG: true, venue: talkVenueNames[talkVenueKey] || '', city: 'New York, NY 🇺🇸' }),
      date:   eventDate,
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
  const SPORTS_RE = /wwe|wrestling|wrestlemania|nba|nfl|mlb|nhl|mma|ufc|boxing|sport|athlete|autograph|lids|card.?show|megacon|fan.?expo|comic.?con|fanatics/i;

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
      // Detect Queue-it virtual waiting room — page is temporarily inaccessible
      if (/queue-it\.net|queueit|virtual waiting room|you are in the queue/i.test(html)) {
        console.log(`  Epic/Leap ${slug}: blocked by Queue-it waiting room, skipping`); continue;
      }

      // Convention dates from API
      const convDate    = conv.beginUtc ? conv.beginUtc.slice(0, 10) : null;
      const convEndDate = conv.endUtc   ? conv.endUtc.slice(0, 10)   : convDate;

      // Location from nested location object
      const loc   = conv.location || {};
      const venue = loc.venue || '';
      const city  = [loc.city, loc.province].filter(Boolean).join(', ');

      // Sport classification from convention title
      // FAN EXPO / Comic-Con events feature actors & pop-culture celebrities, not athletes
      const convTitle = (conv.title || conv.name || '').toLowerCase();
      const convSportDefault = /fan.?expo|comic.?con|pop.?culture/i.test(convTitle) ? 'celeb'
        : /wwe|wrestling|ufc|mma|boxing/.test(convTitle) ? 'wrestling'
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

        // Skip non-person product entries and generic TeamUp/merch items
        if (/photo op|panel|combo|print|package|general admission|group shot|\bvip\b|authentication sticker|frame your photo|autograph \d+-pack|TeamUp\s*-\s*(Halloween|Hazbin)/i.test(talentName)) continue;

        const link = `https://store.epic.leapevent.tech${href}`;

        // Use start date for display; check end date to avoid excluding multi-day events
        let date = convDate || guessDate(html.toLowerCase().slice(0, 5000));
        if (!date) continue;
        // Skip if the entire convention has ended (compare end date, not start date)
        const endCheck = convEndDate || date;
        if (new Date(endCheck + 'T00:00:00') < now) continue;

        // For non-celeb conventions, try to detect sport per talent name
        const talentSport = convSportDefault === 'celeb' ? 'celeb'
          : await detectSport(talentName, convTitle);

        events.push({
          id:     `epic_${slug}_${talentSlug}`,
          player: talentName,
          title:  conv.title || undefined,
          sport:  talentSport,
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

  // 7-way split: SerpAPI KEY_1–4 → Serper KEY_1–2 → SearchApi
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

    // Fall back to any available SerpAPI key — round-robin KEY_3/KEY_4 so they
    // drain evenly rather than KEY_4 exhausting before KEY_3 is used at all.
    if (data === null || data === undefined) {
      const serpPrimary = i % 2 === 0
        ? [{ key: API_KEY_4, label: 'serpapi4' }, { key: API_KEY_3, label: 'serpapi3' }]
        : [{ key: API_KEY_3, label: 'serpapi3' }, { key: API_KEY_4, label: 'serpapi4' }];
      const serpCandidates = [
        ...serpPrimary,
        { key: API_KEY_2, label: 'serpapi2' },
        { key: API_KEY_1, label: 'serpapi1' },
      ].filter(k => k.key && !deadKeys.has(k.label));
      for (const { key, label } of serpCandidates) {
        keyLabel = label;
        const url = `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&num=10&api_key=${key}`;
        data = await fetchWithRetry(url);
        if (data === 'dead') { console.warn(`  ⚠️  SerpAPI ${label} quota exhausted for this run (recharges monthly)`); deadKeys.add(label); data = null; continue; }
        break;
      }
    }

    // Emergency fallback: if all assigned SerpAPI keys dead, use Serper before giving up
    if (!data && SERPER_KEY && !deadKeys.has('serper1')) {
      keyLabel = 'serper1-fallback';
      data = await fetchSerper(q, 3, SERPER_KEY);
      if (data === 'dead') { console.warn('  ⚠️  Serper KEY_1 quota exhausted'); deadKeys.add('serper1'); data = null; }
    }
    if (!data && SERPER_KEY2 && !deadKeys.has('serper2')) {
      keyLabel = 'serper2-fallback';
      data = await fetchSerper(q, 3, SERPER_KEY2);
      if (data === 'dead') { console.warn('  ⚠️  Serper KEY_2 quota exhausted'); deadKeys.add('serper2'); data = null; }
    }

    console.log(`  [${keyLabel}] "${q.substring(0, 55)}"`);
    if (data && data !== 'dead') {
      const found = await parseOrganic(data, lang);
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

  // Direct-crawl Inscriptagraphs (Shopify, Las Vegas)
  console.log('Fetching Inscriptagraphs events directly...');
  const inscripEvents = await fetchInscriptagraphs();
  console.log(`Inscriptagraphs: ${inscripEvents.length} events found`);
  results.push(...inscripEvents);

  // Direct-crawl Sportsworld USA (Shopify, Saugus MA)
  console.log('Fetching Sportsworld USA events directly...');
  const swusaEvents = await fetchSportsworldUSA();
  console.log(`Sportsworld USA: ${swusaEvents.length} events found`);
  results.push(...swusaEvents);

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

  // Merge with previous run: carry forward any events not found today that haven't expired.
  // This prevents quota-limited runs from shrinking the event database.
  const todayStr = new Date().toISOString().slice(0, 10);
  let prevEvents = [];
  try {
    const prev = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
    prevEvents = (prev.events || []).filter(e => new Date(e.date + 'T12:00:00') >= today);
  } catch {}

  // Index new events by link for fast lookup
  const newByLink = new Map(future.map(e => [e.link, e]));

  // Preserve addedAt: new events get today, previously-seen events keep their original date
  for (const e of future) {
    const old = prevEvents.find(p => p.link === e.link);
    e.addedAt = (old && old.addedAt) ? old.addedAt : todayStr;
  }

  // Carry forward previous events not rediscovered today (keep their addedAt)
  const carried = prevEvents.filter(e => !newByLink.has(e.link));

  // Merge: new events first (fresher data), then carried-forward ones
  const merged = [...future, ...carried];

  // Final dedup by link (safety net)
  const seenLinks = new Set();
  const finalEvents = merged.filter(e => {
    if (!e.link || seenLinks.has(e.link)) return false;
    seenLinks.add(e.link);
    return true;
  });

  // ── Ticketmaster Discovery API — VIP M&G upgrades ────────────────────────────
  const tmEvents = await fetchTicketmasterMG();
  if (tmEvents.length > 0) {
    console.log(`Ticketmaster API: found ${tmEvents.length} VIP M&G upgrade event(s)`);
    for (const ev of tmEvents) {
      if (!finalEvents.find(e => e.link === ev.link)) {
        finalEvents.push(ev);
        console.log(`  + TM: ${ev.player} — ${ev.date} — ${ev.city}`);
      }
    }
  }

  console.log(`Found ${future.length} live events this run; ${carried.length} carried from previous; ${finalEvents.length} total`);

  // ── noMG CHECKER — rotate through unconfirmed M&G events, search for updates ─
  const noMGEvents = finalEvents.filter(e => e.noMG && new Date(e.date + 'T12:00:00') >= today);
  if (noMGEvents.length > 0) {
    // Check 2 per run, rotating by day
    const checkSlice = [0, 1].map(offset => noMGEvents[(dayOfYear * 2 + offset) % noMGEvents.length]).filter(Boolean);
    console.log(`noMG check: ${checkSlice.map(e => e.player).join(', ')}`);
    for (const ev of checkSlice) {
      const q = `"${ev.player}" meet greet autograph fan VIP signing 2026`;
      const data = SERPER_KEY ? await fetchSerper(q) : null;
      if (!data || !data.organic_results) { await new Promise(r => setTimeout(r, 1000)); continue; }
      const mgHit = data.organic_results.find(r => {
        const text = `${r.title} ${r.snippet}`.toLowerCase();
        return /meet.?greet|autograph|signing|vip.*meet|fan.*experience/.test(text)
          && !/lottery|raffle|contest|prize|giveaway|win a/.test(text);
      });
      if (mgHit) {
        console.log(`  ✅ noMG RESOLVED for ${ev.player}: ${mgHit.link}`);
        ev.noMG = false;
        ev.notes = (ev.notes || '') + ` ⚡ M&G now confirmed — see ${mgHit.link}`;
      } else {
        console.log(`  — Still no M&G for ${ev.player}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  mkdirSync(join(__dirname, '../data'), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: finalEvents.length,
    events: finalEvents,
  }, null, 2));

  console.log(`Written to ${OUT_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
