# Managed files

Generated files often live next to hand-written content - you may already have
a `CLAUDE.md` with notes, or a `.mcp.json` with servers added by hand. kata
never takes a file over wholesale. Each emitted file uses one of three write
strategies.

## Managed region (markdown)

Instruction files get a clearly delimited block:

```md
# My hand-written notes ← untouched

<!-- kata:begin -->
<!-- Managed by kata. Edits inside this block will be overwritten on `kata apply`. -->

Always run tests before committing.
<!-- kata:end -->

More hand-written notes. ← untouched
```

On every `apply`, only the region between the markers is regenerated:

- No file -> created containing just the region.
- File without markers -> region is appended; existing content stays.
- File with markers -> region replaced in place; everything around it stays.

Edits _inside_ the region are overwritten - that's the contract. Put personal
notes outside the markers, or move them into `.kata/instructions/` to
share them across tools.

## JSON merge

JSON files like `.mcp.json` and `.cursor/mcp.json` are merged, not replaced:

- Keys kata manages (the servers defined in .kata/) are overwritten to match.
- Keys it doesn't know about (hand-added servers, other tools' settings) are
  preserved.
- Objects merge recursively; arrays and scalars are replaced.

So a hand-added server in `.mcp.json` coexists with generated ones. The file
is re-serialized with stable 2-space formatting, so comments are not supported
in merged JSON files.

TOML files (Codex's `.codex/config.toml`) get the same merge semantics.
Note that TOML comments are lost when kata re-serializes the file.

## Replace

Files fully owned by kata are overwritten byte-for-byte. The Cursor
adapter uses this for `.cursor/rules/kata.mdc` - a dedicated rule file
that has no user-editable parts (your other rule files are never touched).

## Idempotence

`resolveContent(desired, on-disk)` is pure and deterministic: applying twice
produces identical bytes, and `kata plan` after an `apply` always reports
`No changes`. If a native file was edited out-of-band _inside_ managed parts,
the next `plan` shows exactly what would be normalized back.
