# Unified Tauri 2 client

`client/` is the unified Tauri 2 project for Windows, macOS, Linux, Android and iOS. It reuses
the repository's existing web client and stages `public/`, `shared/`, `data/` and `server/sim/`
into `client/web/` before each build. The server origin is fixed at build time by `SP_SERVER_URL`.

Prepare from the repository root:

```bash
npm ci
node tools/setup.mjs --yes
cd client
npm install
```

Desktop development/build:

```bash
SP_SERVER_URL=https://game.example.com npm run dev
SP_SERVER_URL=https://game.example.com npm run build
```

Initialize the Android target once on a machine with Android Studio/SDK:

```bash
npm run android:init
```

Then build or run Android:

```bash
SP_SERVER_URL=https://game.example.com npm run android:dev
SP_SERVER_URL=https://game.example.com npm run android:build
```

`android:init` creates Tauri's generated Android project under `client/src-tauri/gen/android/`.
Do not hand-edit generated files; use Tauri configuration or regenerate after changing the app
identifier. Sign desktop installers and Android APK/AABs with release keys kept outside Git.
