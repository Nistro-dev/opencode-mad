#!/usr/bin/env node

/**
 * opencode-kit installer
 * 
 * Usage:
 *   npx @fiandev/opencode-kit install        # Install to current project (.opencode/)
 *   npx @fiandev/opencode-kit install -g     # Install globally (~/.config/opencode/)
 *   npx @fiandev/opencode-kit update         # Update in current project (alias for install)
 *   npx @fiandev/opencode-kit update -g      # Update globally (alias for install -g)
 *   npx @fiandev/opencode-kit version        # Show version
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

type PackageJson = { version: string };

const args = process.argv.slice(2);
const command = args[0];
const isGlobal = args.includes('-g') || args.includes('--global');

// Handle version command
if (command === 'version' || command === '-v' || command === '--version') {
  const pkg: PackageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
  console.log(`opencode-kit v${pkg.version}`);
  process.exit(0);
}

// 'update' is an alias for 'install'
if (command !== 'install' && command !== 'update') {
  console.log(`
opencode-kit - Multi-Agent Dev plugin for OpenCode

Usage:
  npx @fiandev/opencode-kit install        Install to current project (.opencode/)
  npx @fiandev/opencode-kit install -g     Install globally (~/.config/opencode/)
  npx @fiandev/opencode-kit update         Update in current project (alias for install)
  npx @fiandev/opencode-kit update -g      Update globally (alias for install -g)
  npx @fiandev/opencode-kit version        Show version

More info: https://github.com/fiandev/opencode-kit
`);
  process.exit(0);
}

const targetDir = isGlobal
  ? join(homedir(), '.config', 'opencode')
  : join(process.cwd(), '.opencode');

const folders = ['agents', 'commands', 'skills'];
const pluginSource = join(__dirname, 'dist');
const pluginTarget = join(targetDir, 'plugins');

if (!existsSync(pluginSource)) {
  console.error('opencode-kit: dist/main.js not found. Run "bun run build" first.');
  process.exit(1);
}

// Check if it's an update (any of the installed folders already exist)
const isUpdate = [...folders, 'plugins'].some(folder => existsSync(join(targetDir, folder)));

// Get version from package.json
const pkg: PackageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
const version = pkg.version;

// Copy folders silently
for (const folder of folders) {
  const src = join(__dirname, folder);
  const dest = join(targetDir, folder);

  if (!existsSync(src)) continue;

  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

// Copy the bundled plugin
mkdirSync(pluginTarget, { recursive: true });

// Remove TypeScript sources installed by versions <= 1.2.0 so the plugin is not loaded twice
if (existsSync(join(pluginTarget, 'main.ts'))) {
  for (const file of ['main.ts', 'plugin.ts', 'hooks.ts', 'types.ts', 'constants.ts']) {
    rmSync(join(pluginTarget, file), { force: true });
  }
  for (const dir of ['lib', 'tools']) {
    rmSync(join(pluginTarget, dir), { recursive: true, force: true });
  }
}

cpSync(pluginSource, pluginTarget, { recursive: true });

// Single line output
const action = isUpdate ? 'updated' : 'installed';
const location = isGlobal ? '~/.config/opencode' : '.opencode';
console.log(`opencode-kit v${version} ${action} to ${location}`);
