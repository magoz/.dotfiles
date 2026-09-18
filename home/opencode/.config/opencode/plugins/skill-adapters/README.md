# Canonical skill runtime adapters

OpenCode-only in-memory substitutions; no shared/Pi source edits. See
`../../ASSESSMENT.md` for source precedence, native delegation differences,
worktree ownership/cleanup restrictions and validation limits.

`sources.json` hashes the canonical Markdown body after frontmatter removal.
Tests compare against repository sources. A changed source becomes a blocked
workflow, including a warning at the model context boundary. Review policy and
adapter semantics before changing any digest. Supporting files keep their original
base directory and remain canonical; runtime harness substitutions override their
Pi-only mechanism instructions, never their authorization/evidence gates.

Native API reference: OpenCode v2.0.3 `plugin/src/promise/skill.ts`,
`core/src/config/plugin/skill.ts`, `core/src/state.ts`, and
`core/src/session/prompt.ts`. Config skill transforms load after user plugins;
late re-registration and synchronous hooks are required, not optional.

## Frozen PR review: native INLINE transport

Parent still freezes outside the repository, as canonical policy requires. Children
receive the **complete sanitized frozen evidence inline in `subagent.prompt`**, not
those external paths and not Pi's unsupported `reads` parameter. Keep all child
external-directory denies; never grant broad `/tmp` or home access. Canonical
policies/supporting files remain unchanged.

`review-bundle.js` is a pure transport helper (no file access, delegation or hooks):

```js
import { patchDigest, reviewPrompt } from './review-bundle.js';
const value = patchDigest(patch, 'git-blob-sha1');
const prompt = reviewPrompt({
  target: `git-blob-sha1:${value}`, // one immutable exact-patch target
  axis: 'Spec', // exactly Standards, Spec, or Knowledge
  sanitized: true,
  patch, // COMPLETE exact UTF-8 git binary diff, no trim/newline conversion
  patchDigest: { algorithm: 'git-blob-sha1', value },
  scope, specification, changedFiles,
  validationEvidence, // complete results, required skips, visual proof if required
  guidanceEvidence, // applicable AGENTS/guides + required audit-only axis skills
}, budgetBytes);
// Supply prompt verbatim to native subagent({agent:'pr-reviewer', description,
// prompt, background:true}); no reads, acceptance, or external-file parameters.
```

`git-blob-sha256` is also supported for SHA-256 Git repositories; use the frozen
repository's object format. Digest includes Git's `blob <byte-length>\0` header,
matching `git hash-object --stdin`, not plain SHA over trimmed text. Parent verifies
against the independently frozen digest; `parseReviewPrompt` validates a received
prompt's complete bytes/digest and required fields. JSON escaping is reversible.
Sanitize **before** freezing/hashing. If sanitation would omit change-critical
content, block rather than review a different patch. Non-UTF-8 patches or required
non-text evidence that cannot be fully represented inline also block.

Budget is explicit, for the **entire serialized prompt**, at most 256 KiB. This is
a conservative transport ceiling, **not** a model-token/context-fit guarantee.
Parent must reserve native role/system/tool/output context and confirm the complete
bundle fits the actual model; otherwise block before delegation. Never truncate,
summarize a required artifact, hash different bytes, or silently omit evidence.
The helper validates transport, not the truth/completeness of evidence or sanitation;
role/runtime guidance owns these policy gates. It is not Pi acceptance parity or a
new delegation system. Read-only reviewers cannot independently execute a hash
command: distinguish parent-supplied digest verification from child verification.

Agent permissions repeat global secret-read exclusions after child `read:*`, with
the same `.env.example` exception order. These restrict native **read** only:
`grep` has its own permission and the implementation worker has shell access.
They do not constitute a complete content sandbox. Tests evaluate native
last-match-wins semantics, including external neighboring/home denials.
