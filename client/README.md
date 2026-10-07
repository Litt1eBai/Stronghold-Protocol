# Fixed-server clients

Both clients connect to the HTTP(S) origin supplied in `SP_SERVER_URL` at build time.
There is no runtime server-address chooser. They use this repository's existing
registration, login, account tokens and server-side account progress.

- Desktop: Tauri 2, with the existing web client and resources bundled in `client/web/`.
- Android: Kotlin + system WebView in `client/android/`, adapted from
  [Paper-Yuan's Android shell](android/UPSTREAM.md). It loads the deployed server's
  web client directly, so registration is a same-origin request. WebView DOM
  storage preserves the original account token between launches. Web code and
  game data follow server deployments. Art, animation, audio and fonts are preinstalled
  from `public/assets/` and `public/fonts/`; the APK does not embed a local Node server.

## Build on Windows

Run from the repository root:

```powershell
# Desktop prerequisites: Node 22+, Rust/MSVC, WebView2, npm dependencies and game assets.
npm.cmd ci
node tools/setup.mjs --yes
npm.cmd --prefix client ci

# Build and sign both clients for the fixed server:
.\scripts\build-client-windows.ps1 -ServerUrl http://203.135.99.28:30089

# Android only: Windows JDK 21 and Android SDK platform 37/build-tools 36 or newer.
# Android needs complete local public/assets and public/fonts, but no Rust or NDK.
.\scripts\build-client-windows.ps1 -Target Android -ServerUrl http://203.135.99.28:30089
```

Use `-Target Windows` for only the installer. Override `-AndroidSdk` and `-JavaHome`
for other installations. These settings only affect the build process, not global
Windows environment variables. Android Studio can open `client/android/`; set
`SP_SERVER_URL` in its environment before starting it. No `android:init` step is needed.

For an unsigned Android release, once static assets are prepared:

```powershell
$env:SP_SERVER_URL = 'http://203.135.99.28:30089'
$env:ANDROID_HOME = 'E:\programs\dev\android_sdk'
$env:JAVA_HOME = 'C:\programs\dev\java\zulu21'
node tools/build-android-client.mjs
```

`SP_SERVER_URL` is required and must be an HTTP(S) origin without credentials,
a subpath, query or fragment. HTTP builds enable cleartext traffic; HTTPS builds
disable it. The compiled origin also confines native WebView navigation.

The Windows script aligns, signs and verifies the APK. Defaults:

- Keystore: `.cache/client-signing/stronghold-release.jks`
- Password file: `.cache/client-signing/keystore-password.txt`
- Alias: `stronghold-release`

Override with `-KeyStore`, `-KeyStorePasswordFile` and `-KeyAlias`. The key and store
passwords must match. Back up the key and password outside Git; every future update
must use the same key. `-Target Android -SignOnly` signs the existing native release
APK without rebuilding it.

Outputs:

- `client/artifacts/android/Stronghold-Protocol-release.apk` and adjacent `SHA256SUMS`.
- `client/artifacts/windows/*-setup.exe`.

The Android APK contains no ABI-specific native libraries and runs on Android 7+
with a sufficiently recent system WebView. It keeps `com.strongholdprotocol.client`
and uses version 0.1.4 and version code 1008 (Tauri used 1003, the WebView-only APK used 1004, the first asset bundle used 1005, the skin bundle used 1006, the first 0.1.4 build used 1007). An update
can be installed over that APK with the same key; the change from the bundled
`tauri.localhost` page to the actual server origin requires logging in again.
Existing server accounts and progress remain available.

## Preinstalled static assets

Every Android Gradle build verifies all `/assets/` and `/fonts/` references in
`data/assets.json`, stages those two directories into generated APK assets, and
records file sizes, MIME types and SHA-256 hashes. Incomplete assets fail the build.
Vendor libraries, web code, data and account files are not staged.

At runtime, requests to the fixed server's packaged asset/font paths read directly
from the APK, without an initial download or extraction. Images, animations and
font files retain their original origin; audio supports byte ranges for seeking.
Missing files use the normal server request. A query string such as `?v=2` also
uses the server, so a deployment can bypass an older preinstalled resource.
Replacing a preinstalled file at the same URL requires a new APK or a query string.
Registration, login, WebSocket connections and game data continue using the server;
preinstalled art does not make this an offline game.

## Android controls

Startup connects silently to the compiled server without a native connection screen.
Settings are available after login in the lobby, room and match. Game quality and
audio use the shared web settings; Android screen settings only adjust refresh
rate and safe-area padding, without reloading the page. After login, the Android
Back button opens screen settings, diagnostics, refresh, recovery and exit. The shell provides immersive
landscape mode, audio focus, high refresh rates, configurable screen-edge padding,
rotating file logs and log sharing. Connection failures offer retry and diagnostics.

The shell injects a readiness adapter into the original web client; no Android
changes need to be deployed on the server. If the client fails to boot, a native
dialog offers compatibility mode, which reloads with `?render=fallback&board=2d`
and a software WebView layer. This also handles older GPU/WebView failures.

Operator skins use the same web selection, rendering and room synchronization on all clients. See [skins](../docs/SKINS.md); deploy the matching server/web update before using the new APK.

The Android adapter also supplies the lobby/room settings entry on older deployed
web pages, using their existing settings modal. Connection errors retain retry
and diagnostics; render failures offer compatibility recovery.
