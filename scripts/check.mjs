#!/usr/bin/env node
// Syntax gate: `node --check` every JS module, then verify the catalog builds deterministically.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const roots = ['src', 'public/js', 'scripts', 'tests'];
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(m?js)$/.test(f)) files.push(p); } };
roots.forEach(walk);
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
const before = readFileSync('public/catalog/index.json', 'utf8');
execFileSync(process.execPath, ['scripts/build-catalog.mjs'], { stdio: 'ignore' });
if (readFileSync('public/catalog/index.json', 'utf8') !== before) { console.error('Catalog is stale: run npm run build:catalog and commit.'); process.exit(1); }
console.log(`check: ${files.length} files OK, catalog up to date`);
