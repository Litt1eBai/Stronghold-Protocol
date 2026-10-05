// Stage the browser client and its non-public imports for the Tauri bundle.
// Usage: SP_SERVER_URL=https://game.example.com npm run desktop:build
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'desktop', 'web');
const serverUrl = String(process.env.SP_SERVER_URL || 'https://play.example.com').trim();
if (!/^https:\/\//i.test(serverUrl)) throw new Error('SP_SERVER_URL must be an https:// URL');

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
await fs.cp(path.join(root, 'public'), out, { recursive: true });
await fs.cp(path.join(root, 'shared'), path.join(out, 'shared'), { recursive: true });
await fs.cp(path.join(root, 'data'), path.join(out, 'data'), { recursive: true });
await fs.cp(path.join(root, 'server', 'sim'), path.join(out, 'sim'), { recursive: true });

const indexPath = path.join(out, 'index.html');
let index = await fs.readFile(indexPath, 'utf8');
const escaped = serverUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
index = index.replace('</head>', `<script>window.__SP_SERVER_URL__='${escaped}';</script></head>`);
await fs.writeFile(indexPath, index);
console.log(`[tauri] staged web client for ${serverUrl}`);
