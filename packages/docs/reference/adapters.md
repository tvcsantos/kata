# Adapters

An adapter translates the kata model into one tool's native files. Each
adapter declares its **capabilities** per artifact type - `full`, `partial`,
or `unsupported` - and anything it can't express is reported as a warning in
`plan`/`apply` output rather than silently dropped.

## Capability matrix

| Artifact                    | claude-code | codex | copilot | cursor | gemini | opencode | vscode |
| --------------------------- | ----------- | ----- | ------- | ------ | ------ | -------- | ------ |
| Instructions                | ✅          | ✅    | ✅      | ✅     | ✅     | ✅       | ✅     |
| MCP servers                 | ✅          | 🟡¹   | ✅      | ✅     | ✅     | ✅       | ✅     |
| Prompts / commands          | ✅          | ❌²   | ❌²     | 🟡³    | 🟡³    | ✅       | 🟡³    |
| Skills                      | ✅          | ✅    | ✅      | ✅     | ❌     | ✅       | ✅     |
| Subagents                   | ✅          | ❌    | ✅      | ❌⁴    | ❌     | 🟡⁵      | ✅     |
| Hooks                       | -           | -     | -       | -      | -      | -        | -      |
| Settings                    | -           | -     | -       | -      | -      | -        | -      |
| **Import** (native -> kata) | ✅          | -     | -       | ✅     | -      | -        | -      |

The matrix above is for project scope. In a **global run** (`kata apply
--global` from `~/.kata/`) each adapter emits its tool's user-level files
instead; artifacts with no file-addressable global home warn:

| Global emissions   | claude-code           | codex                  | copilot                      | cursor                | gemini                    | opencode                           | vscode                                   |
| ------------------ | --------------------- | ---------------------- | ---------------------------- | --------------------- | ------------------------- | ---------------------------------- | ---------------------------------------- |
| Instructions       | `~/.claude/CLAUDE.md` | `~/.codex/AGENTS.md`   | ❌                           | ❌¹                   | `~/.gemini/GEMINI.md`     | `~/.config/opencode/AGENTS.md`     | `<profile>/prompts/kata.instructions.md` |
| MCP servers        | `~/.claude.json`      | `~/.codex/config.toml` | `~/.copilot/mcp-config.json` | `~/.cursor/mcp.json`  | `~/.gemini/settings.json` | `~/.config/opencode/opencode.json` | `<profile>/mcp.json`²                    |
| Prompts / commands | `~/.claude/commands/` | `~/.codex/prompts/`³   | ❌                           | `~/.cursor/commands/` | `~/.gemini/commands/`     | `~/.config/opencode/commands/`     | `<profile>/prompts/`                     |
| Skills             | `~/.claude/skills/`   | `~/.codex/skills/`     | ❌                           | `~/.cursor/skills/`   | ❌                        | `~/.config/opencode/skills/`       | ❌                                       |
| Subagents          | `~/.claude/agents/`   | ❌                     | `~/.copilot/agents/`         | ❌                    | ❌                        | `~/.config/opencode/agents/`       | ❌                                       |

¹ Cursor global rules live in the app settings, not a file.
² `<profile>` is VS Code's user config dir (platform-dependent, e.g.
`~/Library/Application Support/Code/User` on macOS).
³ Codex custom prompts are user-level only, so they emit in global runs and
warn in project runs.

Independently, a **project** run routes servers marked `scope: global` in
`mcp/servers.yaml` to the tool's user-level MCP file (second row above)
instead of the repo file.

¹ Codex TOML can't interpolate env refs; unmappable values warn instead of inlining.
² Prompts deprecated (Codex) or user-level only (Copilot CLI) - convert to skills.
³ Plain-markdown or reduced-frontmatter command formats; extra prompt frontmatter is dropped.
⁴ Cursor has subagents, but their on-disk format isn't documented yet.
⁵ OpenCode's `tools` frontmatter format differs; the tools restriction is dropped with a warning.

### Shared files converge

Several targets read the same native files - codex and opencode both use
`AGENTS.md`; claude-code and copilot both use `.mcp.json`; copilot and vscode
share `.github/copilot-instructions.md`, `.github/agents/`, and
`.github/skills/`. Because emission is deterministic and merges preserve
foreign keys, enabling any combination converges byte-for-byte instead of
fighting: after one `apply`, a second `plan` is clean.

More adapters (Gemini CLI, OpenCode, Copilot, ...) are planned; the columns will
grow with them.

## claude-code

Targets [Claude Code](https://code.claude.com/docs/).

| Kata artifact                      | Native file              | Write strategy                                                 |
| ---------------------------------- | ------------------------ | -------------------------------------------------------------- |
| `instructions/*.md` (composed)     | `CLAUDE.md`              | [Managed region](/guide/managed-files#managed-region-markdown) |
| `mcp/servers.yaml` (project scope) | `.mcp.json`              | [JSON merge](/guide/managed-files#json-merge)                  |
| `prompts/*.md`                     | `.claude/commands/*.md`  | Replace (frontmatter passes through)                           |
| `agents/*.md`                      | `.claude/agents/*.md`    | Replace                                                        |
| `skills/<name>/`                   | `.claude/skills/<name>/` | Replace, file by file                                          |

**Import** pulls the reverse direction: user content in `CLAUDE.md` (outside
the managed region), `.mcp.json` servers (`${VAR}` -> `${env:VAR}`), and
everything under `.claude/commands`, `.claude/agents`, `.claude/skills`.

Details:

- `${env:VAR}` references render as `${VAR}` - Claude Code's native env
  expansion in `.mcp.json`.
- `stdio` servers render as `{ command, args, env }`; `http`/`sse` servers as
  `{ type, url, headers }`.
- Hand-added servers in `.mcp.json` are preserved on `apply`.
- `scope: global` servers merge into `~/.claude.json` (the same file
  `claude mcp add --scope user` writes); the rest of its state is preserved.
- **Detection:** the target counts as detected if `~/.claude/`, `./.claude/`,
  or `./CLAUDE.md` exists.

## codex

Targets [OpenAI Codex CLI](https://developers.openai.com/codex/config-reference).

| Kata artifact                      | Native file             | Write strategy                                                               |
| ---------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `instructions/*.md` (composed)     | `AGENTS.md`             | [Managed region](/guide/managed-files#managed-region-markdown)               |
| `mcp/servers.yaml` (project scope) | `.codex/config.toml`    | TOML merge (same semantics as [JSON merge](/guide/managed-files#json-merge)) |
| `skills/<name>/`                   | `.codex/skills/<name>/` | Replace, file by file                                                        |

Prompts are skipped with a warning in project runs - Codex custom prompts are
user-level only, so `kata apply --global` emits them to `~/.codex/prompts/`.
Subagents are unsupported.

Codex's TOML config has **no string interpolation**, so `${env:VAR}`
references are mapped onto Codex's native env-sourcing fields instead of being
inlined:

| Kata                                      | Codex config.toml                        |
| ----------------------------------------- | ---------------------------------------- |
| `env: { VAR: "${env:VAR}" }` (same name)  | `env_vars = ["VAR"]`                     |
| `env: { KEY: "literal" }`                 | `env = { KEY = "literal" }`              |
| header `Authorization: Bearer ${env:VAR}` | `bearer_token_env_var = "VAR"`           |
| header `X-Foo: ${env:VAR}`                | `env_http_headers = { "X-Foo" = "VAR" }` |
| header `X-Foo: literal`                   | `http_headers = { "X-Foo" = "literal" }` |

Anything Codex can't express is skipped **with a warning**, never inlined:
renamed env vars (`KEY: ${env:OTHER}`), refs mixed into longer strings, and
`sse` servers (Codex supports stdio and streamable HTTP only). Hence the
_partial_ MCP capability. TOML comments in `.codex/config.toml` are not
preserved when kata merges into it.

**Detection:** `~/.codex/`, `./.codex/`, or `./AGENTS.md` exists.

## cursor

Targets [Cursor](https://cursor.com/docs).

| Kata artifact                      | Native file              | Write strategy                                                      |
| ---------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| `instructions/*.md` (composed)     | `.cursor/rules/kata.mdc` | Replace (kata owns this file)                                       |
| `mcp/servers.yaml` (project scope) | `.cursor/mcp.json`       | [JSON merge](/guide/managed-files#json-merge)                       |
| `prompts/*.md`                     | `.cursor/commands/*.md`  | Replace (frontmatter stripped - Cursor commands are plain markdown) |
| `skills/<name>/`                   | `.cursor/skills/<name>/` | Replace, file by file                                               |

**Import** pulls `.cursor/rules/*.mdc` (as instructions, frontmatter stripped,
excluding kata's own rule file), `.cursor/mcp.json` servers (env refs are
already kata's syntax), `.cursor/commands`, and `.cursor/skills`.

Details:

- The rule file carries `alwaysApply: true` frontmatter, so instructions load
  into every session. It's a dedicated file - your other `.cursor/rules/*.mdc`
  files are never touched.
- Cursor's `mcp.json` natively uses `${env:VAR}` interpolation - identical to
  kata's syntax - so env values pass through unchanged.
- Known Cursor limitation: `${env:...}` is **not** interpolated in remote
  (http/sse) server _headers_; kata emits a warning when a config relies
  on that.
- **Detection:** `~/.cursor/` or `./.cursor/` exists.

## gemini

Targets [Gemini CLI](https://google-gemini.github.io/gemini-cli/).

| Kata artifact       | Native file                            | Notes                                                                                                           |
| ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `instructions/*.md` | `GEMINI.md`                            | Managed region                                                                                                  |
| `mcp/servers.yaml`  | `.gemini/settings.json` (`mcpServers`) | JSON merge; `${env:VAR}` -> `${VAR}` (Gemini expands env vars in settings). `http` -> `httpUrl`, `sse` -> `url` |
| `prompts/*.md`      | `.gemini/commands/<name>.toml`         | `description` + `prompt` TOML; `$ARGUMENTS` -> `{{args}}`; other frontmatter dropped                            |

Skills and subagents are unsupported (warnings). **Detection:** `~/.gemini/`,
`./.gemini/`, or `./GEMINI.md`.

## opencode

Targets [OpenCode](https://opencode.ai/docs/).

| Kata artifact       | Native file                    | Notes                                                                                                                         |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `instructions/*.md` | `AGENTS.md`                    | Managed region (shared with codex)                                                                                            |
| `mcp/servers.yaml`  | `opencode.json` (`mcp`)        | JSON merge; `type: local/remote`, executable+args as one `command` array, `env` -> `environment`, `${env:VAR}` -> `{env:VAR}` |
| `prompts/*.md`      | `.opencode/commands/<name>.md` | Frontmatter passes through                                                                                                    |
| `agents/*.md`       | `.opencode/agents/<name>.md`   | Frontmatter rewritten: `mode: subagent` added, `tools` dropped with a warning (format differs)                                |
| `skills/<name>/`    | `.opencode/skills/<name>/`     | Replace, file by file                                                                                                         |

**Detection:** `~/.config/opencode/`, `./.opencode/`, or `./opencode.json`.

## copilot

Targets [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli).

| Kata artifact       | Native file                       | Notes                                                                                             |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `instructions/*.md` | `.github/copilot-instructions.md` | Managed region                                                                                    |
| `mcp/servers.yaml`  | `.mcp.json`                       | JSON merge (same file Claude Code reads); adds `tools: ["*"]` allowlist; `${env:VAR}` -> `${VAR}` |
| `agents/*.md`       | `.github/agents/<name>.agent.md`  | Agent profiles, frontmatter passes through                                                        |
| `skills/<name>/`    | `.github/skills/<name>/`          | Agent Skills standard                                                                             |

Prompts warn (Copilot CLI's prompt files are user-level only - use skills).
**Detection:** `~/.copilot/` or `./.github/copilot-instructions.md`.

## vscode

Targets [VS Code](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) (Copilot agent mode).

| Kata artifact       | Native file                        | Notes                                                                                       |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `instructions/*.md` | `.github/copilot-instructions.md`  | Managed region (shared with copilot)                                                        |
| `mcp/servers.yaml`  | `.vscode/mcp.json` (`servers`)     | JSON merge; explicit `type` field; `${env:VAR}` is VS Code's native syntax - passes through |
| `prompts/*.md`      | `.github/prompts/<name>.prompt.md` | `description` frontmatter kept, rest dropped                                                |
| `agents/*.md`       | `.github/agents/<name>.agent.md`   | Shared with copilot                                                                         |
| `skills/<name>/`    | `.github/skills/<name>/`           | Shared with copilot                                                                         |

**Detection:** `./.vscode/` or `~/.vscode/`.

## Writing an adapter

Adapters implement the `Adapter` interface from `@katahq/core`:

```ts
import type { Adapter } from "@katahq/core";

export const myAdapter: Adapter = {
  id: "my-tool",
  displayName: "My Tool",
  capabilities: { instructions: "full" },
  async detect(ctx) {
    // is the tool installed / initialized?
  },
  async emit(ctx) {
    // kata artifacts -> { files, warnings }; must not touch the filesystem
    return { files: [], warnings: [] };
  },
};
```

`emit` is pure: it returns file contents plus a write strategy per file, and
the core planner/applier handles diffing, merging, and writing. A stable
plugin API for community adapters (`kata-adapter-*` npm packages) is
planned for a later phase.
