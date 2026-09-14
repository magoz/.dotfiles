import { createHash } from 'node:crypto';

// Transport only: no file reads, sanitization, delegation or policy ownership.
// Parent must supply already-sanitized exact bytes and a budget for the COMPLETE
// prompt after reserving model context for role/guidance, tools and output.
export const MAX_PROMPT_BYTES = 256 * 1024;
const header = 'OpenCode frozen review bundle v1\n';
const requiredText = (value) => typeof value === 'string' && value.trim().length > 0;
export function patchDigest(patch, algorithm = 'git-blob-sha1') {
  if (!['git-blob-sha1', 'git-blob-sha256'].includes(algorithm)) throw new Error('Unsupported patch digest');
  const bytes = Buffer.from(patch, 'utf8');
  if (bytes.toString('utf8') !== patch) throw new Error('Patch must round-trip exact UTF-8 bytes');
  return createHash(algorithm === 'git-blob-sha1' ? 'sha1' : 'sha256')
    .update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
function validate(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)
    || !requiredText(bundle.target) || !['Standards', 'Spec', 'Knowledge'].includes(bundle.axis)
    || !requiredText(bundle.scope) || !requiredText(bundle.specification)
    || !requiredText(bundle.patch) || !requiredText(bundle.validationEvidence)
    || !requiredText(bundle.guidanceEvidence) || bundle.sanitized !== true
    || !Array.isArray(bundle.changedFiles) || !bundle.changedFiles.length
    || !bundle.changedFiles.every(requiredText)
    || !bundle.patchDigest || !['git-blob-sha1', 'git-blob-sha256'].includes(bundle.patchDigest.algorithm)
    || bundle.patchDigest.value !== patchDigest(bundle.patch, bundle.patchDigest.algorithm)
    || bundle.target !== `${bundle.patchDigest.algorithm}:${bundle.patchDigest.value}`) {
    throw new Error('Blocked: missing/inconsistent frozen review evidence');
  }
}
export function reviewPrompt(bundle, budgetBytes) {
  validate(bundle);
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0 || budgetBytes > MAX_PROMPT_BYTES) throw new Error('Blocked: explicit inline context budget required');
  const prompt = header + JSON.stringify(bundle);
  if (Buffer.byteLength(prompt, 'utf8') > budgetBytes) throw new Error('Blocked: complete inline review bundle exceeds budget; never truncate or grant external access');
  return prompt;
}
export function parseReviewPrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.startsWith(header) || Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) throw new Error('Blocked: complete native inline frozen review bundle required');
  const bundle = JSON.parse(prompt.slice(header.length));
  validate(bundle);
  return bundle;
}
