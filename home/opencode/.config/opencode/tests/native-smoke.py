#!/usr/bin/env python3
"""Opt-in installed-V2 smoke. No auth, MCP servers, models or Herdr operations."""
import json
import pathlib
import re
import shutil
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
cli = shutil.which("opencode")
if not cli:
    raise SystemExit("Install OpenCode 2.0.3 first")
work = pathlib.Path(tempfile.mkdtemp(prefix="opencode-assessment-smoke-"))
home = work / "home"
config_dir = home / ".config/opencode"
config_dir.mkdir(parents=True)
(work / "project").mkdir()
shared = (root / "shared-skills").resolve()
(home / ".agents").mkdir()
(home / ".agents/skills").symlink_to(shared, target_is_directory=True)
for name in ["agents", "skills", "shared-skills", "plannotator-skills"]:
    (config_dir / name).symlink_to(root / name, target_is_directory=True)
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

print(f"Isolated smoke artifacts: {work}")
try:
    version = call(["--version"], "version.txt")
    if "v2.0.3" not in version:
        raise RuntimeError("This assessment targets exactly OpenCode 2.0.3")
    plugins = json.loads(call(["api", "POST", "/api/plugin/check", "--data", "{}"], "plugins.json"))["data"]
    assert all(p["state"]["status"] == "active" for p in plugins)
    skills = {s["id"]: s for s in json.loads(call(["api", "GET", "/api/skill"], "skills.json"))["data"]}
    expected = json.loads((root / "plugins/skill-adapters/sources.json").read_text())
    for name in expected:
        assert skills[name]["content"].startswith("# OpenCode assessment runtime adapter"), name
    assert "plannotator" in skills
    agents = json.loads(call(["api", "GET", "/api/agent"], "agents.json"))["data"]
    assert {"general", "explore", "pr-reviewer", "web-researcher"} <= {a["id"] for a in agents}
    # Native effective global+agent arrays; shared JS helper faithfully mirrors
    # v2.0.3 Wildcard.match/evaluate (last-match-wins), not deny-wins.
    permission_check = """
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { assertChildReads } = await import(process.argv[1]);
const agents = JSON.parse(readFileSync(process.argv[2], 'utf8')).data;
for (const role of ['general', 'explore', 'pr-reviewer']) {
  assertChildReads(assert, agents.find((agent) => agent.id === role).permissions);
}
"""
    with (work / "permissions.log").open("w") as out:
        subprocess.run([shutil.which("node"), "--input-type=module", "-e", permission_check,
                        (root / "tests/permissions.mjs").as_uri(), str(work / "agents.json")],
                       cwd=work / "project", env=env, stdout=out, stderr=subprocess.STDOUT,
                       check=True, timeout=20)
    assert "INLINE delivery" in skills["pr"]["content"]
    assert "Give both the frozen bundle through `reads`" not in skills["pr"]["content"]
    print("PASS: configured plugins, 10 canonical adapters, Plannotator, four roles; effective secret read/external denials and INLINE guidance")
finally:
    # Only the service under this freshly-created HOME/XDG profile is stopped.
    call(["service", "stop"], "stop.log")
