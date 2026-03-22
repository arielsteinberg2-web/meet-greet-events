#!/usr/bin/env node
/**
 * clean-seeds.js
 * Auto-removes past-dated seed events from index.html.
 * Runs in GitHub Actions before validate-seeds.js so stale seeds never block the workflow.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dirname, '../index.html');
let html = readFileSync(htmlPath, 'utf8');

const today = new Date();
today.setHours(0, 0, 0, 0);

// Match each seed object: from opening { to closing },
const seedBlockPattern = /\{[^{}]*?id:'([^']+)'[^{}]*?date:'(\d{4}-\d{2}-\d{2})'[^{}]*?\},?\n/gs;

let removed = 0;
html = html.replace(seedBlockPattern, (block, id, date) => {
  const d = new Date(date + 'T00:00:00');
  if (!isNaN(d) && d < today) {
    console.log(`  🗑  Removed past seed: id:'${id}'  date:'${date}'`);
    removed++;
    return '';
  }
  return block;
});

if (removed === 0) {
  console.log('✅ No past seeds to remove.');
} else {
  writeFileSync(htmlPath, html, 'utf8');
  console.log(`✅ Removed ${removed} past seed(s) from index.html.`);
}
