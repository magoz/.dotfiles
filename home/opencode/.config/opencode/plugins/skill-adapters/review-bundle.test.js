import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { reviewPrompt, parseReviewPrompt, patchDigest, MAX_PROMPT_BYTES } from './review-bundle.js';
import { assertChildReads, evaluate } from '../../tests/permissions.mjs';

const patch = 'diff --git a/example b/example\r\n--- a/example\r\n+++ b/example\r\n@@ -1 +1,2 @@\r\n-old\r\n+unicode 🦊 café\\path "quoted"\r\n+trailing spaces  \r\n'
  + 'diff --git a/image.png b/image.png\nGIT binary patch\nliteral 3\nKcmZQzU|?Vb0000\n\n';
const makeBundle = () => {
  const value = patchDigest(patch);
  return { target: `git-blob-sha1:${value}`, axis: 'Spec', sanitized: true, scope: 'Fixture only',
    specification: 'Preserve complete exact frozen bytes', changedFiles: ['example', 'image.png'], patch,
    patchDigest: { algorithm: 'git-blob-sha1', value }, validationEvidence: 'Offline fixture: supplied synthetic test result; no live checks',
    guidanceEvidence: 'Fixture AGENTS.md: no edits; Spec review only. No normative external guides.' };
};
test('native prompt carries complete frozen bytes/digest/evidence, without any external grant', async () => {
  const bundle = makeBundle();
  const prompt = reviewPrompt(bundle, MAX_PROMPT_BYTES);
  const nativeInput = JSON.parse(JSON.stringify({ agent: 'pr-reviewer', description: 'Frozen spec review', prompt, background: true }));
  const received = parseReviewPrompt(nativeInput.prompt);
  assert.deepEqual(received, bundle);
  assert.deepEqual(Buffer.from(received.patch), Buffer.from(patch));
  // Independent Git implementation, only stdin; no fixture checkout or file reads.
  assert.equal(execFileSync('git', ['hash-object', '--stdin'], { input: Buffer.from(received.patch), env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_DEFAULT_HASH: 'sha1' } }).toString().trim(), bundle.patchDigest.value);
  const text = await readFile(new URL('../../agents/pr-reviewer.md', import.meta.url), 'utf8');
  const config = JSON.parse((await readFile(new URL('../../opencode.jsonc', import.meta.url), 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
  const rules = [...config.permissions, ...JSON.parse(text.match(/^permissions: (.+)$/m)[1])];
  assertChildReads(assert, rules);
  for (const resource of ['/tmp/frozen-review/*', '/tmp/frozen-review-neighbor/*', '/home/example/.ssh/*']) assert.equal(evaluate('external_directory', resource, rules), 'deny');
  assert.equal(nativeInput.reads, undefined);
});
test('missing evidence, altered/truncated patch/digest/target, path-only and over-budget bundles block', () => {
  for (const field of ['patch', 'patchDigest', 'scope', 'specification', 'changedFiles', 'validationEvidence', 'guidanceEvidence', 'axis', 'target', 'sanitized']) {
    const bundle = makeBundle(); delete bundle[field];
    assert.throws(() => reviewPrompt(bundle, MAX_PROMPT_BYTES), /Blocked/);
  }
  for (const mutation of [
    { patch: patch.trim() }, { patch: patch.replaceAll('\r\n', '\n') },
    { patch: patch + '\ud800' }, { axis: ['Spec', 'Standards'] }, { target: 'main' },
    { patchDigest: { algorithm: 'sha1', value: patchDigest(patch) } },
  ]) assert.throws(() => reviewPrompt({ ...makeBundle(), ...mutation }, MAX_PROMPT_BYTES));
  assert.throws(() => parseReviewPrompt('Read /tmp/frozen-review/patch.diff'), /Blocked/);
  const prompt = reviewPrompt(makeBundle(), MAX_PROMPT_BYTES);
  assert.equal(reviewPrompt(makeBundle(), Buffer.byteLength(prompt)), prompt);
  assert.throws(() => reviewPrompt(makeBundle(), Buffer.byteLength(prompt) - 1), /exceeds budget/);
  assert.throws(() => reviewPrompt(makeBundle()), /budget required/);
  assert.throws(() => parseReviewPrompt(prompt.slice(0, -1)));
  assert.throws(() => reviewPrompt({ ...makeBundle(), guidanceEvidence: 'x'.repeat(MAX_PROMPT_BYTES) }, MAX_PROMPT_BYTES), /exceeds budget/);
});
