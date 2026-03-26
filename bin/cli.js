#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'src', 'server.ts');
const tsxPath = join(__dirname, '..', 'node_modules', '.bin', 'tsx');

try {
  execFileSync(tsxPath, [serverPath], { stdio: 'inherit' });
} catch (e) {
  // Try global tsx
  execFileSync('npx', ['tsx', serverPath], { stdio: 'inherit' });
}
