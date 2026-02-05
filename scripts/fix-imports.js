#!/usr/bin/env node
"use strict";
import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

function toPosix(p) {
  return p.split(path.sep).join('/');
}

async function walk(dir) {
  const files = await fs.readdir(dir, { withFileTypes: true });
  for (const f of files) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) await walk(full);
    else if (f.isFile() && /\.(js|ts)$/.test(f.name)) await fixFile(full);
  }
}

async function fixFile(file) {
  let content = await fs.readFile(file, 'utf8');
  if (!content.includes("@/")) return;
  const dir = path.dirname(file);
  const regex = /(['"])(@\/(.*?))\1/g;
  content = content.replace(regex, (m, quote, atPath, rel) => {
    const target = path.join(SRC, rel);
    let relPath = path.relative(dir, target);
    if (!relPath.startsWith('.')) relPath = './' + relPath;
    relPath = toPosix(relPath);
    if (!relPath.endsWith('.js') && !relPath.endsWith('.ts')) {
      if (fs.stat) {
        // best-effort: prefer .js
        relPath = relPath + '.js';
      } else {
        relPath = relPath + '.js';
      }
    }
    return quote + relPath + quote;
  });
  await fs.writeFile(file, content, 'utf8');
  console.log('Fixed imports in', path.relative(ROOT, file));
}

walk(SRC).catch(err => { console.error(err); process.exit(1); });
