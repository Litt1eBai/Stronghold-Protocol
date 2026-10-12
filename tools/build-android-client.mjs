// Build the fixed-server Kotlin/WebView APK locally or on a Linux CI runner.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { clientServerOrigin } from './client-server-url.mjs';

const origin = clientServerOrigin(process.env.SP_SERVER_URL);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const result = spawnSync(windows ? 'gradlew.bat' : 'sh', windows
  ? ['--no-daemon', 'assembleRelease'] : ['gradlew', '--no-daemon', 'assembleRelease'], {
  cwd: path.join(root, 'client', 'android'),
  env: { ...process.env, SP_SERVER_URL: origin },
  stdio: 'inherit', shell: windows,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
