#!/usr/bin/env node
/**
 * check-links.js
 * Scans every link AND photo URL in data/live-events.json with HEAD requests.
 * Sets linkBroken:true on dead event links, clears it when they recover.
 * Clears img field when photo URL returns 404 (so Wikipedia auto-fetch retries).
 * Run weekly via GitHub Actions (.github/workflows/check-links.yml).
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE  = join(__dirname, '../data/live-events.json');

// URLs that are never real event pages — skip them
const SKIP_RE = /instagram\.com|twitter\.com|x\.com|facebook\.com|tiktok\.com|web search|nsccshow\.com$/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * HEAD-request a URL, following up to 3 redirects.
 * Returns { ok: bool, status: number }.
 */
async function checkLink(url, hops = 0) {
  if (hops > 3) return { ok: false, status: 0 };
  return new Promise((resolve) => {
    let urlObj;
    try { urlObj = new URL(url); } catch { return resolve({ ok: false, status: 0 }); }

    const lib = urlObj.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MeetGreetLinkChecker/1.0)' },
        timeout: 12000,
      },
      (res) => {
        const { statusCode, headers } = res;
        res.resume(); // drain
        if (statusCode >= 301 && statusCode <= 308 && headers.location) {
          // Resolve relative redirects
          const next = headers.location.startsWith('http')
            ? headers.location
            : `${urlObj.origin}${headers.location}`;
          checkLink(next, hops + 1).then(resolve);
        } else {
          resolve({ ok: statusCode < 400, status: statusCode });
        }
      }
    );
    req.on('error', () => resolve({ ok: false, status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0 }); });
    req.end();
  });
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const events = data.events;

  let checked = 0, broken = 0, recovered = 0, skipped = 0;
  let photoBroken = 0, photoCleared = 0;

  for (const ev of events) {
    // ── Check event link ──────────────────────────────────────────────────
    if (ev.link && ev.link.startsWith('http') && !SKIP_RE.test(ev.link)) {
      const { ok, status } = await checkLink(ev.link);
      checked++;
      if (!ok) {
        console.log(`BROKEN LINK [${status || 'timeout'}] ${ev.player} — ${ev.link}`);
        ev.linkBroken = true;
        broken++;
      } else if (ev.linkBroken) {
        console.log(`RECOVERED LINK [${status}] ${ev.player} — ${ev.link}`);
        delete ev.linkBroken;
        recovered++;
      }
      await sleep(300);
    } else {
      skipped++;
    }

    // ── Check photo URL ───────────────────────────────────────────────────
    if (ev.img && ev.img.startsWith('http')) {
      const { ok, status } = await checkLink(ev.img);
      if (!ok) {
        console.log(`BROKEN PHOTO [${status || 'timeout'}] ${ev.player} — ${ev.img}`);
        delete ev.img; // clear so Wikipedia auto-fetch can retry on next run
        photoBroken++;
      }
      await sleep(200);
    }
  }

  data.linkCheckedAt = new Date().toISOString();
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

  console.log(`\nLink check done: ${checked} links checked, ${broken} broken, ${recovered} recovered, ${skipped} skipped`);
  console.log(`Photo check done: ${photoBroken} broken photos cleared`);
}

main().catch(e => { console.error(e); process.exit(1); });
