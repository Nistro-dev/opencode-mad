#!/usr/bin/env node

/**
 * opencode-mad installer
 * 
 * Usage:
 *   npx opencode-mad install        # Install to current project (.opencode/)
 *   npx opencode-mad install -g     # Install globally (~/.config/opencode/)
 *   npx opencode-mad update         # Update in current project (alias for install)
 *   npx opencode-mad update -g      # Update globally (alias for install -g)
 *   npx opencode-mad version        # Show version
 */

import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const command = args[0];
const isGlobal = args.includes('-g') || args.includes('--global');

// Handle version command
if (command === 'version' || command === '-v' || command === '--version') {
  const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
  console.log(`opencode-mad v${pkg.version}`);
  process.exit(0);
}

// 'update' is an alias for 'install'
if (command !== 'install' && command !== 'update') {
  console.log(`
opencode-mad - Multi-Agent Dev plugin for OpenCode

Usage:
  npx opencode-mad install        Install to current project (.opencode/)
  npx opencode-mad install -g     Install globally (~/.config/opencode/)
  npx opencode-mad update         Update in current project (alias for install)
  npx opencode-mad update -g      Update globally (alias for install -g)
  npx opencode-mad version        Show version

More info: https://github.com/Nistro-dev/opencode-mad
`);
  process.exit(0);
}

const targetDir = isGlobal 
  ? join(homedir(), '.config', 'opencode')
  : join(process.cwd(), '.opencode');

const folders = ['agents', 'commands', 'plugins', 'skills'];

// Check if it's an update (any of the folders already exist)
const isUpdate = folders.some(folder => existsSync(join(targetDir, folder)));

// Get version from package.json
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
const version = pkg.version;

// Copy folders silently
for (const folder of folders) {
  const src = join(__dirname, folder);
  const dest = join(targetDir, folder);
  
  if (!existsSync(src)) continue;
  
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

// Single line output
const action = isUpdate ? 'updated' : 'installed';
const location = isGlobal ? '~/.config/opencode' : '.opencode';
console.log(`opencode-mad v${version} ${action} to ${location}`);
