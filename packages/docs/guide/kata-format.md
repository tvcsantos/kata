# Kata format

Everything kata reads lives in `.kata/` at the project root. Everything is
validated with [zod](https://zod.dev) on load; validation errors point at the
offending file and field.

```text
.kata/
  config.yaml            # targets and per-target options
  instructions/
    base.md              # any number of .md files, composed in name order
  mcp/
    servers.yaml         # MCP server definitions
  prompts/
    review.md            # reusable prompts / slash commands
  agents/
    tester.md            # subagent definitions
  skills/
    deploy/
      SKILL.md           # skill directories (SKILL.md required)
      scripts/...          # plus supporting files
```

## `config.yaml`

Declares which targets (adapters) are enabled:

```yaml
version: 1
targets:
  claude-code:
    enabled: true
    # options: {}        # per-target options bag (adapter-specific)
```

Manage this file with `kata targets enable|disable <id>` - edits go
through the YAML document API, so your comments survive.

## Instructions

Every `.md` file in `instructions/` is composed into one instruction block,
sorted by file name. Use a prefix convention to control order:

```text
instructions/
  10-style.md
  20-testing.md
  30-security.md
```

Adapters render the composed block into each tool's native instruction file
(for Claude Code: a managed region in `CLAUDE.md`).

## MCP servers

`mcp/servers.yaml` defines servers once, for every tool:

```yaml
version: 1
servers:
  github: # server name (key)
    transport: stdio # stdio (default) | http | sse
    command: npx # required for stdio
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: ${env:GITHUB_TOKEN}
  remote:
    transport: http
    url: https://mcp.example.com/mcp # required for http/sse
    headers:
      Authorization: Bearer ${env:EXAMPLE_TOKEN}
    scope: project # project (default) | global
```

See the full field reference in [Configuration schema](/reference/config).

## Prompts

Each `.md` file in `prompts/` is a reusable prompt / slash command; the file
name becomes the command name. Frontmatter (e.g. `description`,
`argument-hint`) follows Claude Code's command conventions and passes through
verbatim where the target supports it; targets with plain-markdown commands
(Cursor) get the body only.

```md
---
description: Review the current diff
---

Review the pending changes for correctness bugs.
```

## Subagents

Each `.md` file in `agents/` defines a subagent (frontmatter `description`,
optionally `tools`, `model`). Currently only Claude Code renders these;
other targets warn and skip.

## Skills

Each directory in `skills/` is one skill and must contain a `SKILL.md`
(frontmatter `name` matching the directory, plus `description` - the
[Agent Skills](https://agentskills.io) convention shared by Claude Code,
Codex, and Cursor). Supporting files ship alongside and are copied
verbatim, binary assets included.

## Secrets: `${env:VAR}`

Never put API keys in `.kata/` files. Reference environment variables with
`${env:VAR}`; each adapter renders the reference in its tool's native
expansion syntax (Claude Code: `${VAR}` in `.mcp.json`). The secret itself is
resolved by the tool at runtime and never lands in a committed file.

## Scopes

kata has two independent configuration roots, mirroring how the tools
themselves treat scopes:

- **project** - the repo's `.kata/`, rendered into repo-level files
  (`.mcp.json`, `CLAUDE.md`, `.cursor/`). This is the default everywhere.
- **global** - the user-level `~/.kata/`, managed with the `-g/--global`
  flag (`kata init --global`, `kata apply --global`, ...) and rendered into
  each tool's user-level files (`~/.claude/CLAUDE.md`, `~/.codex/config.toml`,
  `~/.gemini/`, `~/.config/opencode/`, ...). Write personal instructions,
  prompts, or MCP servers once and every project gets them.

Additionally, an MCP server inside a _project_ config may declare
`scope: global`: it is then routed to the tool's user-level MCP config
(e.g. `~/.claude.json`) instead of the repo file - useful for personal
servers a project needs but that shouldn't be committed for teammates.

Where a tool has no file-addressable global equivalent for an artifact
(e.g. Cursor global rules live in the app settings), the adapter reports a
warning instead of guessing. Global files appear with a `~/` prefix in
`plan`/`apply`/`status` output.
