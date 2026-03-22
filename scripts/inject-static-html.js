#!/usr/bin/env node
/**
 * inject-static-html.js
 * Runs after update-events.js in GitHub Actions.
 * Bakes live-events.json into index.html as plain HTML so crawlers
 * (Bing, social scrapers) see all events without rendering JavaScript.
 * Also updates lastmod in sitemap.xml.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const events = JSON.parse(readFileSync(join(ROOT, 'data/live-events.json'), 'utf8')).events || [];

const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const sportLabel = { soccer:'Soccer', basketball:'Basketball', other:'Other Sports', politics:'Politics', celeb:'Celebrity', book:'Book Talk' };

const html = events.length === 0 ? '' : `
<section id="static-events" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden" aria-hidden="true">
  <h2>Upcoming Meet &amp; Greet Events 2026</h2>
  ${events.map(e => `
  <article itemscope itemtype="https://schema.org/Event">
    <h3 itemprop="name">${esc(e.player)}</h3>
    <meta itemprop="image" content="https://meetandgreet.events/og-image.png"/>
    <meta itemprop="eventStatus" content="https://schema.org/EventScheduled"/>
    <time itemprop="startDate" datetime="${esc(e.date)}">${esc(e.date)}</time>
    <span itemprop="description">${esc(e.notes || '')}</span>
    <span itemprop="location" itemscope itemtype="https://schema.org/Place">
      <span itemprop="name">${esc(e.venue || e.city || 'Venue TBA')}</span>
      ${e.city ? `<span itemprop="address">${esc(e.city)}</span>` : ''}
    </span>
    <span>${sportLabel[e.sport] || e.sport}</span>
    ${e.link ? `<a href="${esc(e.link)}" itemprop="url" rel="noopener">Event details</a>` : ''}
  </article>`).join('')}
</section>`;

// Inject into index.html
const liveData = JSON.parse(readFileSync(join(ROOT, 'data/live-events.json'), 'utf8'));
const builtAt = liveData.generatedAt || new Date().toISOString();
const builtAtDt = new Date(builtAt);
const formattedTs = builtAtDt.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'})
  + ' ' + builtAtDt.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});

let page = readFileSync(join(ROOT, 'index.html'), 'utf8');
// Replace existing static-events section OR original placeholder on first run
page = page.replace(
  /<!-- STATIC_EVENTS_PLACEHOLDER -->|<section id="static-events"[\s\S]*?<\/section>/,
  html || '<!-- STATIC_EVENTS_PLACEHOLDER -->'
);
// Bake BUILT_AT into JS constant (replace any existing ISO string or placeholder)
page = page.replace(/const BUILT_AT\s*=\s*'[^']*'/, `const BUILT_AT = '${builtAt}'`);
// Bake timestamp directly into the HTML span — no JS needed to display it
page = page.replace(/<span id="tsLabel">[^<]*<\/span>/, `<span id="tsLabel">Updated ${formattedTs}</span>`);
page = page.replace(/class="ts-dot[^"]*" id="tsDot"/, 'class="ts-dot stale" id="tsDot"');
writeFileSync(join(ROOT, 'index.html'), page);
console.log(`Injected ${events.length} events into index.html`);

// Update sitemap lastmod
const today = new Date().toISOString().split('T')[0];
let sitemap = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
sitemap = sitemap.replace('LASTMOD_PLACEHOLDER', today);
writeFileSync(join(ROOT, 'sitemap.xml'), sitemap);
console.log(`Updated sitemap lastmod to ${today}`);
