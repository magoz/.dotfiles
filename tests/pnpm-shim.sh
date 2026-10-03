#!/usr/bin/env bash
# The pnpm shim must find the real pnpm on any platform (macOS has no
# /usr/bin/pnpm and no systemd) and must never run itself.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
SHIM="$REPO_ROOT/home/scripts/.local/bin/pnpm"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT
bash -n "$SHIM"

# A stow-style install: ~/.local/bin/pnpm is a symlink to the shim and comes first.
mkdir -p "$TEST_ROOT/local-bin" "$TEST_ROOT/brew bin" "$TEST_ROOT/no-bus"
ln -s "$SHIM" "$TEST_ROOT/local-bin/pnpm"
cat >"$TEST_ROOT/brew bin/pnpm" <<'EOF'
#!/usr/bin/env bash
printf 'real pnpm:'
printf ' <%s>' "$@"
printf '\n'
EOF
chmod +x "$TEST_ROOT/brew bin/pnpm"

# No user bus: the shim runs the real pnpm directly, preserving arguments.
output=$(env -u BOX_REAL_PNPM XDG_RUNTIME_DIR="$TEST_ROOT/no-bus" \
  PATH="$TEST_ROOT/local-bin:$TEST_ROOT/brew bin:/usr/bin:/bin" \
  "$TEST_ROOT/local-bin/pnpm" completion "a b")
[[ $output == 'real pnpm: <completion> <a b>' ]] || {
  printf 'fail: unexpected output: %s\n' "$output" >&2
  exit 1
}
printf 'ok: shim finds the next pnpm on PATH and preserves arguments\n'

# BOX_REAL_PNPM still wins.
output=$(XDG_RUNTIME_DIR="$TEST_ROOT/no-bus" BOX_REAL_PNPM="$TEST_ROOT/brew bin/pnpm" \
  PATH="$TEST_ROOT/local-bin:/usr/bin:/bin" "$TEST_ROOT/local-bin/pnpm" --version)
[[ $output == 'real pnpm: <--version>' ]] || {
  printf 'fail: BOX_REAL_PNPM ignored: %s\n' "$output" >&2
  exit 1
}
printf 'ok: BOX_REAL_PNPM overrides PATH lookup\n'

# Only the shim on PATH: fail clearly instead of recursing.
status=0
env -u BOX_REAL_PNPM XDG_RUNTIME_DIR="$TEST_ROOT/no-bus" PATH="$TEST_ROOT/local-bin" \
  "$BASH" "$TEST_ROOT/local-bin/pnpm" --version >"$TEST_ROOT/out" 2>&1 || status=$?
[[ $status -eq 127 ]] && grep -q 'no pnpm installation found' "$TEST_ROOT/out" || {
  printf 'fail: expected exit 127 with guidance, got %s: %s\n' "$status" "$(cat "$TEST_ROOT/out")" >&2
  exit 1
}
printf 'ok: missing pnpm fails clearly without recursion\n'
