#!/usr/bin/env bash
# Captures OpenCode's subs-claude request bodies (no plugin) with the fake Anthropic server into
# /tmp/ocgw-captures (see README.md "Refresh"). Re-executes itself in a fresh user + network
# namespace: loopback only, nothing can leave.
# Usage: fixtures/capture.sh /path/to/opencode  (writes fixtures/opencode-<version>.json)
set -euo pipefail
if [[ -z ${OCGW_IN_NAMESPACE:-} ]]; then
  exec env OCGW_IN_NAMESPACE=1 unshare -rn bash "$0" "$@"
fi
ip link set lo up
OC=$(readlink -f "$1")
GW=$(cd "$(dirname "$0")/.." && pwd)
rm -rf /tmp/ocgw /tmp/ocgw-captures /tmp/ocgw-fake-413
mkdir -p /tmp/ocgw/work /tmp/ocgw/home/.config/opencode
printf 'hi\n' > /tmp/ocgw/work/hello.txt
printf '# Project\n\nPROJECT_CONTEXT_MARKER\n' > /tmp/ocgw/work/AGENTS.md
git -C /tmp/ocgw/work init -q
python3 - "$GW/../../opencode.jsonc" <<'EOF'
import json, re, sys
c = json.loads(re.sub(r"^\s*//.*$", "", open(sys.argv[1]).read(), flags=re.M))
p = c["providers"]["subs-claude"]
p["settings"] = {"baseURL": "http://127.0.0.1:18555/v1", "apiKey": "dummy"}
out = {"model": c["model"], "compaction": c.get("compaction"), "providers": {"subs-claude": p}, "plugins": [], "mcp": {"servers": {}}, "permissions": c.get("permissions", [])}
out = {k: v for k, v in out.items() if v is not None}
open("/tmp/ocgw/home/.config/opencode/opencode.json", "w").write(json.dumps(out))
EOF
FAKE_OUT=/tmp/ocgw-captures FAKE_FILE=/tmp/ocgw/work/hello.txt node "$GW/fixtures/fake-anthropic-server.mjs" > /tmp/ocgw/fake.log 2>&1 &
sleep 1
H=/tmp/ocgw/home
run() {
  (cd /tmp/ocgw/work && env -i PATH="$(dirname "$OC"):/usr/bin:/bin" HOME=$H SHELL=/bin/sh XDG_CONFIG_HOME=$H/.config XDG_DATA_HOME=$H/.local/share XDG_STATE_HOME=$H/.local/state XDG_CACHE_HOME=$H/.cache "$OC" "$@")
}
S=ses_ocgwcapture0001
# One long-lived isolated service: queued compactions run in it, and /wait blocks until idle.
run service set port 18556 > /tmp/ocgw/service.log 2>&1
trap 'run service stop >/dev/null 2>&1 || true' EXIT
wait_idle() { run api POST /api/experimental/session/$S/wait -d '{}' > /dev/null 2>&1; }
run run --session $S "USE_TOOL please read hello.txt" > /tmp/ocgw/1.log 2>&1
run run --session $S "Thanks, anything else?" > /tmp/ocgw/2.log 2>&1
run run --session $S --agent plan "Plan the next step" > /tmp/ocgw/3.log 2>&1
run api POST /api/session/$S/compact -d '{}' > /tmp/ocgw/4.log 2>&1; wait_idle
run run --session $S --agent build "USE_TOOL after compaction read again" > /tmp/ocgw/5.log 2>&1
touch /tmp/ocgw-fake-413
run api POST /api/session/$S/compact -d '{}' > /tmp/ocgw/6.log 2>&1; wait_idle
VERSION=$("$OC" --version | sed -n 's/^opencode v//p')
# Requests, in order: 001 title, 002-003 first turn, 004 second, 005 plan turn (primary),
# 006 compaction, 007 first post-compaction request, 008 its tool follow-up, 009 the 413'd
# compaction, 010 its reduced-transcript retry.
python3 - "$VERSION" "$GW/fixtures" <<'EOF'
import json, os, sys
version, out = sys.argv[1], sys.argv[2]
captures = sorted(os.listdir("/tmp/ocgw-captures"))
assert len(captures) == 10, captures
load = lambda n: json.load(open(f"/tmp/ocgw-captures/{captures[n - 1]}"))
title, primary, compaction, post, reduced = (load(n) for n in (1, 5, 6, 7, 10))
shared = {"system": primary["body"]["system"], "tools": primary["body"]["tools"]}
for request in (compaction, post, reduced):
    assert {key: request["body"][key] for key in shared} == shared, request["kind"]
strip = lambda body: {k: v for k, v in body.items() if k not in shared}
fixture = {
    "_comment": f"OpenCode {version} Anthropic Messages request bodies captured from an isolated fake server (subs-claude provider, no plugin). primary/compaction/postCompaction/compactionReduced share `shared.system` and `shared.tools`. See README.md.",
    "opencode": version,
    "headers": sorted(primary["headers"]),
    "shared": shared,
    "title": title["body"],
    "primary": strip(primary["body"]),
    "compaction": strip(compaction["body"]),
    "postCompaction": strip(post["body"]),
    "compactionReduced": strip(reduced["body"]),
}
with open(f"{out}/opencode-{version}.json", "w") as file:
    json.dump(fixture, file, indent=1, ensure_ascii=False)
print(f"wrote {out}/opencode-{version}.json")
EOF
