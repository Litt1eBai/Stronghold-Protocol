// Build the fixed-server Kotlin/WebView APK on Windows. Signing is handled by build-client-windows.ps1.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { clientServerOrigin } from './client-server-url.mjs';

if (process.platform !== 'win32') throw new Error('Run the Android build on Windows with its Android SDK and JDK');
const origin = clientServerOrigin(process.env.SP_SERVER_URL);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('gradlew.bat', ['--no-daemon', 'assembleRelease'], {
  cwd: path.join(root, 'client', 'android'),
  env: { ...process.env, SP_SERVER_URL: origin },
  stdio: 'inherit', shell: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
