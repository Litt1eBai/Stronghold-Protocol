#!/usr/bin/env bash
set -euo pipefail
# Secrets are files in a private temporary directory, never command-line passwords.
: "${ANDROID_KEYSTORE_BASE64:?Missing Android signing keystore}"
: "${ANDROID_KEYSTORE_PASSWORD:?Missing Android signing password}"
: "${ANDROID_KEY_ALIAS:?Missing Android signing alias}"
secret_dir=$(mktemp -d)
chmod 700 "$secret_dir"
trap 'rm -rf "$secret_dir"' EXIT
printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$secret_dir/release.jks"
printf '%s' "$ANDROID_KEYSTORE_PASSWORD" > "$secret_dir/store-password"
printf '%s' "${ANDROID_KEY_PASSWORD:-$ANDROID_KEYSTORE_PASSWORD}" > "$secret_dir/key-password"
chmod 600 "$secret_dir"/*

(cd client/android && sh gradlew --no-daemon testDebugUnitTest assembleRelease)
out=client/artifacts/android
mkdir -p "$out"
apk_name=$(node tools/cnb-release.mjs apk-name)
tools="${ANDROID_HOME:?}/build-tools/36.0.0"
"$tools/zipalign" -f -P 16 4 client/android/app/build/outputs/apk/release/app-release-unsigned.apk "$secret_dir/aligned.apk"
"$tools/apksigner" sign --ks "$secret_dir/release.jks" --ks-key-alias "$ANDROID_KEY_ALIAS" \
    --ks-pass "file:$secret_dir/store-password" --key-pass "file:$secret_dir/key-password" \
    --out "$out/$apk_name" "$secret_dir/aligned.apk"
"$tools/apksigner" verify --verbose "$out/$apk_name"
"$tools/zipalign" -c -P 16 4 "$out/$apk_name"
"$tools/aapt2" dump xmltree "$out/$apk_name" --file AndroidManifest.xml > "$out/apk-manifest.txt"
node tools/cnb-release.mjs verify-apk
(cd "$out" && sha256sum "$apk_name" > SHA256SUMS)
