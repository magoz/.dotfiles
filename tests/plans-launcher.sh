#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
LAUNCHER="$REPO_ROOT/home/scripts/.local/bin/plans"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT
TEST_HOME="$TEST_ROOT/home with spaces"
export TEST_CALLER_DIR="$TEST_ROOT/documents with spaces"
mkdir -p "$TEST_HOME" "$TEST_CALLER_DIR"
bash -n "$LAUNCHER"

expect_exit() {
  local expected=$1
  shift
  local actual=0
  "$@" >"$TEST_ROOT/output" 2>&1 || actual=$?
  if [[ $actual -ne $expected ]]; then
    printf 'fail: expected exit %s, got %s\n' "$expected" "$actual" >&2
    exit 1
  fi
}

expect_exit 127 env HOME="$TEST_HOME" "$LAUNCHER" upload page.html
rg -q 'missing .*plans/dist/cli/plans.js' "$TEST_ROOT/output"
printf 'ok: missing checkout/build fails with setup guidance\n'

mkdir -p "$TEST_ROOT/empty-path"
expect_exit 127 env HOME="$TEST_HOME" PATH="$TEST_ROOT/empty-path" "$BASH" "$LAUNCHER"
rg -q 'Node 24 is required' "$TEST_ROOT/output"
printf 'ok: missing Node fails clearly\n'

mkdir -p "$TEST_HOME/plans/dist/cli"
cat >"$TEST_HOME/plans/dist/cli/plans.js" <<'JS'
const assert = require('node:assert/strict')
const fs = require('node:fs')
assert.equal(process.cwd(), process.env.TEST_CALLER_DIR)
assert.equal(process.env.PLANS_ENDPOINT ?? '', process.env.TEST_EXPECTED_ENDPOINT ?? '')
assert.deepEqual(process.argv.slice(2), [
  'upload', 'page with spaces.html', '--endpoint', 'http://127.0.0.1:3939'
])
assert.equal(fs.readFileSync(process.argv[3], 'utf8'), '<p>synthetic</p>')
process.exitCode = 23
JS
printf '<p>synthetic</p>' >"$TEST_CALLER_DIR/page with spaces.html"
cd "$TEST_CALLER_DIR"
expect_exit 23 env HOME="$TEST_HOME" PLANS_ENDPOINT= "$LAUNCHER" upload 'page with spaces.html' \
  --endpoint http://127.0.0.1:3939
printf 'ok: launcher preserves cwd, relative paths, argument boundaries, and exit status\n'

mkdir -p "$TEST_HOME/.config/plans"
printf '%s' 'https://plans-origin.example' >"$TEST_HOME/.config/plans/endpoint"
expect_exit 23 env HOME="$TEST_HOME" PLANS_ENDPOINT= TEST_EXPECTED_ENDPOINT=https://plans-origin.example \
  "$LAUNCHER" upload 'page with spaces.html' --endpoint http://127.0.0.1:3939
expect_exit 23 env HOME="$TEST_HOME" PLANS_ENDPOINT=https://override.example \
  TEST_EXPECTED_ENDPOINT=https://override.example \
  "$LAUNCHER" upload 'page with spaces.html' --endpoint http://127.0.0.1:3939
printf 'ok: local endpoint file supports missing newline and explicit environment override\n'

literal='https://example.com/$(touch SHOULD_NOT_EXIST)'
printf '%s\n' "$literal" >"$TEST_HOME/.config/plans/endpoint"
expect_exit 23 env HOME="$TEST_HOME" PLANS_ENDPOINT= TEST_EXPECTED_ENDPOINT="$literal" \
  "$LAUNCHER" upload 'page with spaces.html' --endpoint http://127.0.0.1:3939
[[ ! -e "$TEST_CALLER_DIR/SHOULD_NOT_EXIST" ]]
printf 'ok: endpoint file is read as data, never evaluated\n'

: >"$TEST_HOME/.config/plans/endpoint"
expect_exit 1 env HOME="$TEST_HOME" PLANS_ENDPOINT= "$LAUNCHER" upload 'page with spaces.html'
rg -q 'empty or unreadable endpoint file' "$TEST_ROOT/output"
printf 'ok: empty endpoint file fails clearly\n'
