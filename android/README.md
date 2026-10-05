# Android client

This is a fixed-endpoint WebView wrapper. It intentionally has no server address field. The
complete `public/` web client, including `public/assets` and `public/fonts` when present, is
copied into the APK during the Gradle build. The fixed URL is used only for WebSocket/API traffic.

Open the `android/` directory in Android Studio, set the `serverUrl` Gradle property to the
fixed HTTPS origin, and build the `app` release variant. On a machine with the Android SDK and
Gradle installed directly:

```bash
node tools/setup.mjs --yes
cd android
gradle assembleRelease -PserverUrl=https://play.example.com
```

Open the `app-release.apk` under `app/build/outputs/apk/release/` in Android Studio or distribute it
through the chosen private channel. The server must provide HTTPS. Changing the endpoint requires
rebuilding the APK.
