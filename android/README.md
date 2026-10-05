# Android client

This is a fixed-endpoint WebView wrapper. It intentionally has no server address field. The
complete `public/` web client, including `public/assets` and `public/fonts` when present, is
copied into the APK during the Gradle build. The fixed URL is used only for WebSocket/API traffic.

Run the setup step from the repository root first, then open the `android/` directory in Android
Studio or build the `app` release variant directly. The Gradle task refuses to build when
`public/assets` is missing or empty, so an APK cannot be produced accidentally without art/audio.

```bash
node tools/setup.mjs --yes
cd android
gradle assembleRelease -PserverUrl=https://play.example.com
```

Open the `app-release.apk` under `app/build/outputs/apk/release/` in Android Studio or distribute it
through the chosen private channel. The server must provide HTTPS. Changing the endpoint requires
rebuilding the APK.
