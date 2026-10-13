# Interactive feature references

The interactive HTML mocks are cumulative app design references. Keep them in this repository
so the owner and the next agent can inspect the same source.

## Enhancement workflow

1. Read `mock-index.json` and inspect the latest owner-confirmed mock and related existing app code.
2. Clone that mock and its assets into `<new-feature>/mock/`; use its exact git revision if the
   original folder has already been pruned.
3. Record its source feature, path and exact git revision in `<new-feature>/design.md`.
4. Preserve existing app flows and add the enhancement's complete interactive journey and states.
5. Check desktop/mobile, show the running HTML mock to the owner, and obtain confirmation.
6. Record the owner's confirmation and reference revision; update `latestConfirmed` in the index.
7. Implement against the confirmed reference and compare the resulting app to it.

The first baseline copies the existing frontend source, preserving its routes, components and
translations. Freeze a hash manifest, allowlist subsequent intentional deltas and check the other
files for drift. The runner may simulate side effects without changing the existing screen code. Missing
existing app flows must be listed and completed before declaring that baseline confirmed. A
proposal is not automatically approved by a request to create, commit or show its mock.

## Keep the latest five features

Keep only the five most recently created feature folders in the working tree. Assign each new
feature the next `creationOrder` and record `createdAt` in the index. On the sixth feature, remove
the oldest clean, committed feature folder and its current proposal entry in the same PR; repeat
for any excess. Do not count this README or the root index as feature folders, and do not delete
unrelated or uncommitted work.

Older HTML mocks, assets and learning records remain in git history. Before pruning, preserve
the exact revision/path used by any confirmed baseline. `latestConfirmed` may point to an archived
path: recover the mock and its local assets from its recorded git revision before enhancing it.
Retention does not waive owner confirmation or authorize automatic merging.

`latestConfirmed` is either `null`, or an object containing `feature`, `mock`, `design`,
`gitRevision` and `confirmation`. `gitRevision` identifies the mock source before the index update,
avoiding a self-referential commit hash. `confirmation` records the owner's message/date; never
invent approval. Current proposals remain listed with their baseline and coverage status.
