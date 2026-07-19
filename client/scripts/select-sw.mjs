import { copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(__dirname, '..');

const mode = process.argv[2];

const sources = {
  kill: 'sw.kill.ts',
  proper: 'sw.pwa.ts',
};

if (!mode || !(mode in sources)) {
  console.error(`select-sw: unknown or missing mode. Usage: node scripts/select-sw.mjs <kill|proper>`);
  process.exit(1);
}

const src = resolve(clientDir, sources[mode]);
const dest = resolve(clientDir, 'sw.ts');

copyFileSync(src, dest);
console.log(`select-sw: wrote ${sources[mode]} -> sw.ts (mode=${mode})`);
