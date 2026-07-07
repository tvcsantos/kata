# Roadmap

Planned work, grouped by theme. Each entry covers what it is and how it would
fit the current codebase.

- **Distribution & DX**
  - [ ] [Standalone binaries](#standalone-binaries)
  - [ ] [Shell completions](#shell-completions)
  - [ ] [Telemetry (opt-in)](#telemetry-opt-in)
  - [ ] [Capability-matrix docs site](#capability-matrix-docs-site)
- **Missing artifact types**
  - [ ] [Hooks](#hooks)
  - [ ] [Settings / permissions](#settings--permissions)
- **Scope follow-ups**
  - [ ] [`kata import --global`](#kata-import---global)
  - [ ] [Global-composes-under-project merge mode](#global-composes-under-project-merge-mode)

## Distribution & DX

### Standalone binaries

Today kata needs a Node >= 24 install (`npx @katahq/cli` or `npm link`). A
standalone binary is a single executable (`kata-macos-arm64`, `kata-linux-x64`,
`kata.exe`) with the JS runtime baked in, so users without Node - or with the
wrong version - can download or `brew install` and run.

Options: `bun compile` or `pkg` (named in the tech-choices table), Node 24's own
SEA (single executable applications), or oclif's `oclif pack` pipeline for
tarballs and installers.

**Codebase notes:** the build currently keeps `@oclif/core` external and loads
`dist/command-registry.js` at runtime via the `oclif` section of
`packages/cli/package.json`. A binary build needs everything truly bundled and
the oclif config resolvable without a `package.json` on disk.

### Shell completions

Tab-completion for bash/zsh/fish: `kata ap<TAB>` -> `apply`, `kata apply
--tar<TAB>` -> `--target`, ideally completing target ids (`claude-code`,
`codex`, ...) from the registry.

Oclif supports this with the plugin `@oclif/plugin-autocomplete`. It generates
completion scripts from the command/flag metadata now declared on each command
class.

### Telemetry (opt-in)

Anonymous usage signals - which commands run, which targets are enabled, which
adapter warnings fire, error categories - to decide what to build next (e.g. "is
anyone using the copilot adapter?").

"Opt-in" is load-bearing: off by default, enabled explicitly via config or env
var, no file contents or paths ever sent, documented payload. Practically: a
fire-and-forget POST at the end of a command, guarded by config, with a
`KATA_TELEMETRY=0`-style escape hatch.

### Capability-matrix docs site

Every adapter already declares `capabilities: Partial<Record<ArtifactType,
Fidelity>>` ("full / partial / unsupported" per artifact type) in code, and
`reference/adapters.md` has hand-written tables that mirror it. The idea:
_generate_ the matrix from the adapters at docs-build time, so "which tool
supports skills?" is answered by a page that can't drift from the code.

Concretely: a small script imports the registry, emits a markdown table, and the
VitePress build consumes it.

## Missing artifact types

Two artifact types - hooks and settings/permissions - have no schema or adapter
support yet.

### Hooks

Lifecycle scripts - Claude Code hooks being the main example: run a command on
PreToolUse, Stop, etc. Hard for two reasons:

- Almost no cross-tool overlap, so it's mostly "emit for claude-code, warn
  elsewhere".
- Security-sensitive: a shared kata package could inject a hook that executes
  arbitrary commands, so install/compose would need to surface them loudly.

### Settings / permissions

Allowlists, model defaults, sandbox settings (`.claude/settings.json`
permissions, etc.). Divergence is worse than MCP; each tool's permission model
differs enough that the kata schema is either a lowest-common-denominator
or per-target passthrough options. The `targets.<id>.options` bag already
reserved in `config.yaml` is the likely vehicle.

## Scope follow-ups

### `kata import --global`

Import today reads only _project-level_ native files (CLAUDE.md, `.mcp.json`,
`.cursor/`) into `.kata/`. The global variant reads _user-level_ files
(`~/.claude/CLAUDE.md`, `~/.claude.json` mcpServers, `~/.cursor/mcp.json`, ...)
into `~/.kata/` - the onboarding path for someone's personal setup.

Mechanically it's the same `import()` adapter hook pointed at home-dir paths, but
user-level files are messier in practice (years of accumulated personal servers
and settings), so conflict handling matters more.

### Global-composes-under-project merge mode

Today the two roots are fully independent: a project run reads only `.kata/`, a
`--global` run reads only `~/.kata/`. Merge mode would make a project run _also_
layer your personal `~/.kata/` underneath - like a composed package, but
implicit and lowest-precedence - so your personal instructions and MCP servers
apply in every repo while the project's own config wins on conflict.

The compose machinery (packages merged in order, local overrides last) already
exists, so implementation is mostly "prepend the global root to the compose
chain, behind a flag". Design questions:

- **Precedence visibility:** `plan` should say _where_ each artifact came from.
- **Drift semantics:** a native file can now drift against two sources.
- **Opt-out:** teams may not want teammates' personal config leaking into
  committed, project-emitted files - which is why it's flagged optional.
