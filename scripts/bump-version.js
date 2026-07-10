/** js/app-version.js 의 APP_BUILD(YYYYMMDDHHMMSS) 갱신 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'js', 'app-version.js');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const src = readFileSync(target, 'utf8');
const next = src.replace(/export const APP_BUILD = '\d{14}';/, `export const APP_BUILD = '${stamp}';`);
writeFileSync(target, next, 'utf8');
console.log(`[bump-version] APP_BUILD = ${stamp}`);
