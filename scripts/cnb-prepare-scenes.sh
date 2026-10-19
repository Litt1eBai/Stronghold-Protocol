#!/usr/bin/env bash
set -euo pipefail
# Read a pinned, private build input over the same verified SSH connection used for deployment.
pin=.cnb/scene-assets.json
remote_file=$(node -p "JSON.parse(require('fs').readFileSync('$pin','utf8')).remotePath")
sha=$(node -p "JSON.parse(require('fs').readFileSync('$pin','utf8')).sha256")
[[ "$remote_file" =~ ^/var/lib/stronghold-protocol/build-assets/[a-zA-Z0-9._-]+\.zip$ && "$sha" =~ ^[0-9a-f]{64}$ ]] || exit 2
archive=".cache/scene-assets/$sha.zip"
mkdir -p .cache/scene-assets
if [[ -f "$archive" ]] && node tools/scene-assets.mjs restore "$archive"; then
    exit 0
fi
: "${DEPLOY_SSH_KEY_BASE64:?Missing build-input SSH key}" "${DEPLOY_KNOWN_HOSTS:?Missing pinned SSH host key}"
: "${DEPLOY_HOST:?}" "${DEPLOY_PORT:?}" "${DEPLOY_USER:?}"
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9.-]+$ && "$DEPLOY_PORT" =~ ^[0-9]+$ && "$DEPLOY_USER" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
secret_dir=$(mktemp -d)
chmod 700 "$secret_dir"
trap 'rm -rf "$secret_dir"; rm -f "$archive.part"' EXIT
printf '%s' "$DEPLOY_SSH_KEY_BASE64" | base64 --decode > "$secret_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$secret_dir/known_hosts"
chmod 600 "$secret_dir"/*
opts=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2
    -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$secret_dir/known_hosts" -i "$secret_dir/key")
if [[ -n "${DEPLOY_HOST_KEY_ALIAS:-}" ]]; then
    [[ ! "$DEPLOY_HOST_KEY_ALIAS" =~ [[:space:]] ]] || exit 2
    opts+=(-o "HostKeyAlias=$DEPLOY_HOST_KEY_ALIAS")
fi
scp "${opts[@]}" -P "$DEPLOY_PORT" "$DEPLOY_USER@$DEPLOY_HOST:$remote_file" "$archive.part"
node tools/scene-assets.mjs restore "$archive.part"
mv -f "$archive.part" "$archive"
