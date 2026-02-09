#!/usr/bin/env node

/**
 * opencode-mad installer
 * 
 * Usage:
 *   npx opencode-mad install        # Install to current project (.opencode/)
 *   npx opencode-mad install -g     # Install globally (~/.config/opencode/)
 */

import { cpSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const command = args[0];
const isGlobal = args.includes('-g') || args.includes('--global');

if (command !== 'install') {
  console.log(`
opencode-mad - Multi-Agent Dev plugin for OpenCode

Usage:
  npx opencode-mad install        Install to current project (.opencode/)
  npx opencode-mad install -g     Install globally (~/.config/opencode/)

More info: https://github.com/Nistro-dev/opencode-mad
`);
  process.exit(0);
}

const targetDir = isGlobal 
  ? join(homedir(), '.config', 'opencode')
  : join(process.cwd(), '.opencode');

const folders = ['agents', 'commands', 'plugins', 'skills'];

console.log(`\n🚀 Installing opencode-mad to ${targetDir}\n`);

for (const folder of folders) {
  const src = join(__dirname, folder);
  const dest = join(targetDir, folder);
  
  if (!existsSync(src)) {
    console.log(`⚠️  Skipping ${folder} (not found)`);
    continue;
  }
  
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`✅ Copied ${folder}/`);
}

console.log(`
🎉 Installation complete!

${isGlobal ? 'MAD is now available in all your projects.' : 'MAD is now available in this project.'}

Just start talking to the orchestrator:
  "Create a full-stack app with Express and React"

Or use the /mad command:
  /mad Create a Task Timer app
`);
