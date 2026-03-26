#!/usr/bin/env node
const { execFileSync } = require('child_process');
const { join } = require('path');

const serverPath = join(__dirname, '..', 'src', 'server.ts');
const tsxBin = join(__dirname, '..', 'node_modules', '.bin', 'tsx');

try {
  execFileSync(tsxBin, [serverPath], { stdio: 'inherit' });
} catch (e) {
  if (e.status) process.exit(e.status);
  // Fallback: try npx tsx
  try {
    execFileSync('npx', ['--yes', 'tsx', serverPath], { stdio: 'inherit' });
  } catch (e2) {
    console.error('Failed to run MCP server. Ensure tsx is installed.');
    process.exit(1);
  }
}
