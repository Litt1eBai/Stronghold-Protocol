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
and uses version 0.2.4 and version code 1014 (the initial updater build used 1013, the initial 0.2.4 build used 1012, the 0.2.3 build used 1011, Tauri used 1003,
and the WebView-only APK used 1004). An update
can be installed over that APK with the same key; the change from the bundled
`tauri.localhost` page to the actual server origin requires logging in again.
Existing server accounts and progress remain available.

## Android application updates

The native shell checks for updates once on startup. A manual check is available in
Android screen settings, the Back-button menu, and the pre-login exit dialog.
Checking errors are silent at startup; manual checks show the result. Downloads
show progress and can be cancelled. They never reload the game page.

`SP_ANDROID_UPDATE_URL` optionally selects the announcement URL at build time.
The default is `${SP_SERVER_URL}/updates/android.json`. Use HTTPS, or the same
HTTP origin as an existing HTTP game server. A 404 or 204 means no announcement
has been published. The server's existing static handler can serve a generated
`public/updates/android.json` without an API change; this file is ignored by Git.
Do not add a `?v=` cache-busting suffix to the announcement (the static server
treats versioned URLs as immutable). Replace it atomically after publishing.

The announcement uses this format:

```json
{
  "format": 1,
  "applicationId": "com.strongholdprotocol.client",
  "versionCode": 1014,
  "versionName": "0.2.4",
  "apkUrl": "https://downloads.example.com/Stronghold-Protocol-release.apk",
  "sha256": "SHA256_OF_THE_SIGNED_APK_AS_64_HEX_CHARACTERS",
  "size": 671340544,
  "minSdk": 24,
  "notes": "更新说明"
}
```

Generate real metadata from the final signed APK and the current Android Gradle
version (never the upstream tag alone):

```bash
node tools/android-release.mjs --apk client/artifacts/android/Stronghold-Protocol-release.apk --url https://downloads.example.com/Stronghold-Protocol-release.apk --out client/artifacts/android/android.json --notes-file release-notes.txt
```

For every native release, increase `versionCode`, even when the upstream game's
version is unchanged. Upload the APK to a public CNB Release or another HTTPS
download location, confirm that it is downloadable without authentication, then
deploy the matching server and publish `android.json` at the announcement URL.
Private Release links that require logging in will not work in the native downloader.

Before installation the updater checks byte size, SHA-256, actual APK package and
version, and equality of the APK's signing certificates with the installed app.
HTTPS redirects are allowed, but never a downgrade to HTTP. Keep the existing
signing key; key rotation is not supported by this first updater. Debug APKs use
a different package ID and must have a separate announcement to update.

The APK is downloaded to a private app directory and shared with the system
installer through a provider restricted to that directory. Android 8+ may first
ask the user to allow this app to install packages. On returning, the app offers
installation again. Installation always requires system confirmation and retains
the app's existing storage. Closing the app cancels active work; downloads do not
resume across process death. The first updater-enabled APK must be installed manually.

CNB can build the Android project on Linux with Node, JDK 21, Android SDK platform
37 and Build Tools 36 or newer. `node tools/build-android-client.mjs` now runs on
Linux and Windows. Prepare all game assets/fonts before building; incomplete
assets fail the build. The tag pipeline in `.cnb.yml` signs the APK, publishes a
CNB Release, verifies anonymous downloads, then deploys the server with the
matching announcement. See [CNB release setup](../docs/CNB-RELEASE.md) for secrets,
release tags and rollback behavior. Use the same announcement URL for future
releases. Secrets must not be stored in `.cnb.yml`, the announcement, or the
public code repository.

The Android shell recognizes the settings button anywhere in the lobby or room
header, including the left toolbar introduced in 0.2.4. It adds a fallback entry
only when the deployed page has no settings button.

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
web pages, using their existing settings modal. When the web entry appears, the
adapter removes its temporary button. Settings omit the guide link, and Android
shows touch guidance instead of keyboard shortcuts. Connection errors retain retry
and diagnostics; render failures offer compatibility recovery.
