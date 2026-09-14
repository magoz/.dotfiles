import { homedir } from 'node:os';
import { join } from 'node:path';
// Stable process-wide default for this OpenCode server, not pane/session state.
// Leave explicit user overrides alone; never change global PATH or Pi's binary.
if (!process.env.PLANNOTATOR_BIN?.trim()) {
  process.env.PLANNOTATOR_BIN = join(homedir(), '.config/opencode/bin/plannotator');
}
export { default } from '@plannotator/opencode';
