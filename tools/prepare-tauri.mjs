// Stage the browser client and its non-public imports for the Tauri bundle.
// Usage: SP_SERVER_URL=https://game.example.com npm run desktop:build
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAssets, checkData, checkVendor } from './setup.mjs';
import { clientServerOrigin } from './client-server-url.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectArg = process.argv.indexOf('--project-dir');
const projectDir = (projectArg >= 0 ? process.argv[projectArg + 1] : null) || process.env.TAURI_PROJECT_DIR || 'client';
const out = path.join(root, projectDir, 'web');
const serverUrl = String(process.env.SP_SERVER_URL || '').trim();
const endpoint = new URL(clientServerOrigin(serverUrl));

if (!checkVendor().ok || !checkData().ok || !checkAssets().ok) {
  throw new Error('Client dependencies, data or assets are incomplete; run npm ci and node tools/setup.mjs --yes first');
}

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
await fs.cp(path.join(root, 'public'), out, { recursive: true });
await fs.cp(path.join(root, 'shared'), path.join(out, 'shared'), { recursive: true });
await fs.cp(path.join(root, 'data'), path.join(out, 'data'), { recursive: true });
await fs.cp(path.join(root, 'server', 'sim'), path.join(out, 'sim'), { recursive: true });

const indexPath = path.join(out, 'index.html');
let index = await fs.readFile(indexPath, 'utf8');
const encodedUrl = JSON.stringify(endpoint.origin).replace(/</g, '\\u003c');
index = index.replace('</head>', `<script>window.__SP_SERVER_URL__=${encodedUrl};</script></head>`);
await fs.writeFile(indexPath, index);
console.log(`[tauri] staged web client for ${serverUrl}`);
