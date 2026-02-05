#!/usr/bin/env node
// Dev runner: detect TypeScript files and run ts-node-dev, otherwise use nodemon for JS
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

function hasTsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (hasTsFiles(p)) return true;
    } else if (e.isFile() && p.endsWith('.ts')) {
      return true;
    }
  }
  return false;
}

const projectRoot = path.resolve(process.cwd());
const srcDir = path.join(projectRoot, 'src');
const hasTsConfig = fs.existsSync(path.join(projectRoot, 'tsconfig.json'));
const serverTs = path.join(srcDir, 'server.ts');
const serverJs = path.join(srcDir, 'server.js');

if (hasTsConfig && fs.existsSync(serverTs)) {
  console.log('Found tsconfig and src/server.ts — running ts-node-dev');
  const child = spawn('npx', ['ts-node-dev', '--respawn', '--transpile-only', '--respawn-delay', '200', 'src/server.ts'], { stdio: 'inherit', shell: true });
  child.on('exit', (code) => process.exit(code));
} else if (fs.existsSync(serverJs)) {
  console.log('Running nodemon for JS entry src/server.js');
  const child = spawn('npx', ['nodemon', '--watch', 'src', '--ext', 'js,json', '--exec', 'node --enable-source-maps src/server.js'], { stdio: 'inherit', shell: true });
  child.on('exit', (code) => process.exit(code));
} else if (hasTsConfig && hasTsFiles(srcDir)) {
  // Fallback: there are TS files but no server.ts — attempt ts-node-dev with resolve (may fail)
  console.log('TypeScript files detected but src/server.ts missing — attempting ts-node-dev (may require manual entry)');
  const child = spawn('npx', ['ts-node-dev', '--respawn', '--transpile-only', '--respawn-delay', '200', 'src/server.ts'], { stdio: 'inherit', shell: true });
  child.on('exit', (code) => process.exit(code));
} else {
  console.log('No suitable entry found. Expected src/server.js or src/server.ts');
  process.exit(1);
}
