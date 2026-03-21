#!/usr/bin/env node
/**
 * validate-seeds.js
 * Scans index.html SEEDS for events with past dates and warns loudly.
 * Runs in GitHub Actions before update-events.js so stale seeds are caught early.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '../index.html'), 'utf8');

const today = new Date();
today.setHours(0, 0, 0, 0);

// Extract all id + date pairs from SEEDS
const seedPattern = /id:'([^']+)'[^}]*?date:'(\d{4}-\d{2}-\d{2})'/gs;
const past = [];
let match;

while ((match = seedPattern.exec(html)) !== null) {
  const [, id, date] = match;
  const d = new Date(date + 'T00:00:00');
  if (!isNaN(d) && d < today) {
    past.push({ id, date });
  }
}

if (past.length === 0) {
  console.log('✅ All seed events are present or future.');
} else {
  console.warn(`\n⚠️  ${past.length} SEED EVENT(S) WITH PAST DATES DETECTED:\n`);
  for (const { id, date } of past) {
    console.warn(`   id:'${id}'  date:'${date}'`);
  }
  console.warn('\n   → Remove or update these seeds in index.html\n');
  process.exit(1); // Fail the workflow so it gets noticed
}
