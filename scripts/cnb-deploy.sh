#!/usr/bin/env bash
set -euo pipefail
: "${DEPLOY_SSH_KEY_BASE64:?Missing deployment SSH key}"
: "${DEPLOY_KNOWN_HOSTS:?Missing pinned SSH host key}"
: "${DEPLOY_HOST:?}" "${DEPLOY_PORT:?}" "${DEPLOY_USER:?}"
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9.-]+$ && "$DEPLOY_PORT" =~ ^[0-9]+$ && "$DEPLOY_USER" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
secret_dir=$(mktemp -d)
chmod 700 "$secret_dir"
trap 'rm -rf "$secret_dir"' EXIT
printf '%s' "$DEPLOY_SSH_KEY_BASE64" | base64 --decode > "$secret_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$secret_dir/known_hosts"
chmod 600 "$secret_dir"/*
opts=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2
    -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$secret_dir/known_hosts" -i "$secret_dir/key")
# A migrated host can retain its previously verified key at a new network address.
if [[ -n "${DEPLOY_HOST_KEY_ALIAS:-}" ]]; then
    [[ ! "$DEPLOY_HOST_KEY_ALIAS" =~ [[:space:]] ]] || exit 2
    opts+=(-o "HostKeyAlias=$DEPLOY_HOST_KEY_ALIAS")
fi
target="$DEPLOY_USER@$DEPLOY_HOST"
release_id=$(node -p "JSON.parse(require('fs').readFileSync('client/artifacts/server/RELEASE.json','utf8')).id")
[[ "$release_id" =~ ^android-v[a-zA-Z0-9._-]+-[0-9a-f]{12}-[a-zA-Z0-9_-]+$ ]] || exit 2
sha=$(cut -d ' ' -f1 client/artifacts/server/SERVER-SHA256SUMS)
[[ "$sha" =~ ^[0-9a-f]{64}$ ]] || exit 2
# A unique upload directory prevents a concurrent job from replacing an archive in flight.
remote_dir=$(ssh "${opts[@]}" -p "$DEPLOY_PORT" "$target" 'umask 077; mktemp -d /tmp/stronghold-upload.XXXXXXXX')
[[ "$remote_dir" =~ ^/tmp/stronghold-upload\.[a-zA-Z0-9]+$ ]] || exit 2
scp "${opts[@]}" -P "$DEPLOY_PORT" client/artifacts/server/server.tar.gz scripts/deploy-server.sh "$target:$remote_dir/"
public_origin=$(node --input-type=module -e "import {clientServerOrigin} from './tools/client-server-url.mjs'; process.stdout.write(clientServerOrigin(process.env.SP_SERVER_URL))")
# clientServerOrigin validates the structure; exclude shell metacharacters before interpolation.
[[ "$public_origin" =~ ^https?://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || exit 2
ssh "${opts[@]}" -p "$DEPLOY_PORT" "$target" "bash '$remote_dir/deploy-server.sh' '$remote_dir/server.tar.gz' '$sha' '$release_id' '$public_origin'"
ssh "${opts[@]}" -p "$DEPLOY_PORT" "$target" "rm -rf -- '$remote_dir'"
