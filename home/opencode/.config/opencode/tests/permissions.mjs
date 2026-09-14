// Faithful v2.0.3 core/src/util/wildcard.ts + permission.ts evaluate semantics.
// This is read authorization, not shell/grep content confinement or a sandbox.
export function match(input, pattern) {
  let escaped = pattern.replaceAll('\\', '/').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  if (escaped.endsWith(' .*')) escaped = escaped.slice(0, -3) + '( .*)?';
  return new RegExp('^' + escaped + '$', process.platform === 'win32' ? 'si' : 's').test(input.replaceAll('\\', '/'));
}
export function evaluate(action, resource, ...rulesets) {
  return rulesets.flat().findLast((rule) => match(action, rule.action) && match(resource, rule.resource))?.effect ?? 'ask';
}
export function assertChildReads(assert, rules) {
  for (const [resource, effect] of Object.entries({
    'src/example.js': 'allow', '.env': 'deny', '.env.local': 'deny', '.envrc': 'deny',
    'secrets/example.json': 'deny', '.env.example': 'allow', 'nested/.env.example': 'deny',
  })) assert.equal(evaluate('read', resource, rules), effect, `read ${resource}`);
  for (const resource of ['/tmp/frozen-review/*', '/tmp/neighbor-review/*', '/home/example/*', '/home/example/.agents/*']) {
    assert.equal(evaluate('external_directory', resource, rules), 'deny', resource);
  }
}
