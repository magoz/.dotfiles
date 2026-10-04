#!/usr/bin/env python3
"""Opt-in installed-V2 smoke. No auth, MCP servers, models or Herdr operations."""
import json
import pathlib
import re
import shutil
import socket
import subprocess
import tempfile
import time

root = pathlib.Path(__file__).resolve().parents[1]
agents_home = (root / "../../../agents/.agents").resolve()
cli = shutil.which("opencode")
if not cli:
    raise SystemExit("Install OpenCode 2.0.20 first")
work = pathlib.Path(tempfile.mkdtemp(prefix="opencode-native-smoke-"))
home = work / "home"
config_dir = home / ".config/opencode"
config_dir.mkdir(parents=True)
(work / "project").mkdir()
# Mirrors Stow: ~/.agents links to the package; OpenCode skips a symlinked skills root.
(home / ".agents").symlink_to(agents_home, target_is_directory=True)
(config_dir / "agents").symlink_to(root / "agents", target_is_directory=True)
config = json.loads(re.sub(r"^\s*//.*$", "", (root / "opencode.jsonc").read_text(), flags=re.M))
config["plugins"] = [str(root / entry) for entry in config["plugins"]]
config["mcp"] = {"servers": {}}
(config_dir / "opencode.json").write_text(json.dumps(config))
env = {
    "PATH": str(pathlib.Path(cli).parent) + ":/usr/bin:/bin",
    "HOME": str(home),
    "XDG_CONFIG_HOME": str(home / ".config"),
    "XDG_DATA_HOME": str(home / ".local/share"),
    "XDG_STATE_HOME": str(home / ".local/state"),
    "XDG_CACHE_HOME": str(home / ".cache"),
}

def call(args, output):
    # A regular file avoids large native CLI inventories truncating a pipe.
    with (work / output).open("w") as out, (work / "stderr.log").open("a") as err:
        subprocess.run([cli, *args], cwd=work / "project", env=env, stdout=out,
                       stderr=err, check=True, timeout=60)
    return (work / output).read_text()

def poll(route, output, ready, attempts=40):
    for _ in range(attempts):
        data = json.loads(call(["api", "GET", route], output))["data"]
        if ready(data):
            return data
        time.sleep(0.5)
    raise AssertionError(f"{route} not ready; see {work / output}")

def flagged(skill_dir):
    text = (skill_dir / "SKILL.md").read_text()
    return re.search(r'^\s+opencode/slash:\s*["\']?true["\']?\s*$', text.split("\n---", 1)[0], re.M) is not None

print(f"Isolated smoke artifacts: {work}")
# The managed service port is global; avoid colliding with the user's running service.
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
call(["service", "set", "port", str(port)], "port.log")
try:
    version = call(["--version"], "version.txt")
    if "v2.0.20" not in version:
        raise RuntimeError("This smoke targets OpenCode 2.0.20")
    plugins = json.loads(call(["api", "POST", "/api/plugin/check", "--data", "{}"], "plugins.json"))["data"]
    # The direct OAuth plugin still uses the removed ctx.catalog API (plugins/AGENTS.md).
    broken = {p["id"] for p in plugins if p["state"]["status"] != "active"}
    assert broken <= {"opencode-anthropic-auth"}, broken
    # plugin/check covers package plugins only; the plugin list proves local plugins loaded.
    poll("/api/plugin", "plugin-list.json",
         lambda data: any(p["id"] == "dotfiles-until" and p["state"]["status"] == "active" for p in data))
    shared = {d.name for d in (agents_home / "skills").iterdir() if (d / "SKILL.md").is_file()}
    # Compatibility skills, then skill commands, load asynchronously after boot.
    skills = poll("/api/skill", "skills.json", lambda data: shared <= {s["id"] for s in data})
    skills = {s["id"]: s for s in skills}
    for name in shared:
        assert str(skills[name]["path"]).startswith(str(agents_home / "skills")), name
    agents = json.loads(call(["api", "GET", "/api/agent"], "agents.json"))["data"]
    roles = {p.stem for p in (agents_home / "agents").glob("*.md")}
    assert roles <= {a["id"] for a in agents}, roles - {a["id"] for a in agents}
    want = {d.name for d in (agents_home / "skills").iterdir() if (d / "SKILL.md").is_file() and flagged(d)}
    poll("/api/command", "commands.json", lambda data: want <= {c["name"] for c in data})
    # Native effective global+agent arrays; tests/permissions.mjs mirrors last-match-wins.
    permission_check = """
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { assertChildReads } = await import(process.argv[1]);
const agents = JSON.parse(readFileSync(process.argv[2], 'utf8')).data;
for (const role of ['general', 'explore', 'pr-reviewer', 'tech-lead', 'ui-design']) {
  assertChildReads(assert, agents.find((agent) => agent.id === role).permissions);
}
"""
    with (work / "permissions.log").open("w") as out:
        subprocess.run([shutil.which("node"), "--input-type=module", "-e", permission_check,
                        (root / "tests/permissions.mjs").as_uri(), str(work / "agents.json")],
                       cwd=work / "project", env=env, stdout=out, stderr=subprocess.STDOUT,
                       check=True, timeout=20)
    print(f"PASS: {len(shared)} shared skills, {len(roles)} shared agents, {len(want)} skill commands; child read/external denials")
finally:
    # Only the service under this freshly-created HOME/XDG profile is stopped.
    call(["service", "stop"], "stop.log")
