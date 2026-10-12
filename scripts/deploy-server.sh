#!/usr/bin/env bash
set -euo pipefail
# Run on the existing Linux server. Configuration and persistent data live outside releases.
archive=${1:?Server archive required}
expected_sha=${2:?Archive SHA-256 required}
release_id=${3:?Release ID required}
[[ "$expected_sha" =~ ^[0-9a-f]{64}$ && "$release_id" =~ ^android-v[a-zA-Z0-9._-]+-[0-9a-f]{12}-[a-zA-Z0-9_-]+$ ]] || exit 2
public_origin=${4:?Public game origin required}
base=${SP_DEPLOY_BASE:-/opt/stronghold-protocol}
service=${SP_DEPLOY_SERVICE:-stronghold-protocol.service}
health=${SP_DEPLOY_HEALTH:-http://127.0.0.1:3000/healthz}
[[ -d "$base/releases" && -L "$base/current" ]] || { echo 'Existing release layout is required' >&2; exit 2; }
exec 9>"$base/.deploy.lock"
flock -n 9 || { echo 'Another deployment is running' >&2; exit 2; }
printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum -c -
old=$(readlink -f "$base/current")
candidate="$base/releases/$release_id"
switched=0
cleanup() {
    status=$?
    trap - EXIT
    rm -f -- "$base/.next-$release_id" "$base/.rollback-$release_id"
    if [[ "$status" -ne 0 && "$switched" -eq 1 ]]; then
        ln -s "$old" "$base/.rollback-$release_id"
        mv -Tf "$base/.rollback-$release_id" "$base/current"
        systemctl restart "$service" || true
        echo 'Deployment failed; previous release restored' >&2
    fi
    exit "$status"
}
trap cleanup EXIT
if [[ -e "$candidate" ]]; then
    [[ -f "$candidate/.archive-sha256" && "$(cat "$candidate/.archive-sha256")" == "$expected_sha" ]] || { echo 'Release ID already exists with different content' >&2; exit 2; }
else
    mkdir "$candidate"
    tar -xzf "$archive" -C "$candidate" --no-same-owner
    printf '%s\n' "$expected_sha" > "$candidate/.archive-sha256"
    chown -R root:stronghold "$candidate"
    chmod -R u=rwX,go=rX "$candidate"
fi
python3 - "$candidate/RELEASE.json" "$release_id" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r['id']==sys.argv[2] and r['app'] and r['build'], 'Release identity mismatch'
PY
# A server restart ends live matches. Refuse rather than silently interrupt players.
curl -fsS --max-time 5 "$health" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r.get("ok") and r.get("matches")==0, "Active matches or unhealthy server; retry deployment later"'
ln -s "$candidate" "$base/.next-$release_id"
mv -Tf "$base/.next-$release_id" "$base/current"
switched=1
systemctl restart "$service"
for attempt in $(seq 1 30); do
    if systemctl is-active --quiet "$service" && curl -fsS --max-time 2 "$health" | python3 -c '
import json,sys
actual=json.load(sys.stdin); expected=json.load(open(sys.argv[1]))
assert actual.get("ok") and actual.get("app")==expected["app"] and actual.get("build")==expected["build"]
' "$candidate/RELEASE.json" \
        && curl -fsS --max-time 3 "$public_origin/healthz" | python3 -c '
import json,sys
actual=json.load(sys.stdin); expected=json.load(open(sys.argv[1]))
assert actual.get("ok") and actual.get("app")==expected["app"] and actual.get("build")==expected["build"]
' "$candidate/RELEASE.json" \
        && curl -fsS --max-time 3 "$public_origin/updates/android.json" | python3 -c '
import json,sys
assert json.load(sys.stdin)==json.load(open(sys.argv[1]))
' "$candidate/public/updates/android.json"; then
        switched=0
        echo "Deployed $release_id; previous release retained at $old"
        exit 0
    fi
    sleep 1
done
echo 'New release did not become healthy' >&2
exit 1
