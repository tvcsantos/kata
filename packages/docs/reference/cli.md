# CLI commands

```
kata <command> [options]
```

All commands operate on the nearest `.kata/` found by walking up from
the current directory. Every command except `import` also accepts
`-g, --global` to operate on the user-level `~/.kata/` instead - see
[Scopes](/guide/kata-format#scopes). The home directory itself is never
picked up as a project root; `~/.kata/` is only reachable via `--global`.

## `kata init`

Scaffold `.kata/` in the current directory and detect installed tools.

```sh
kata init
kata init --global   # scaffold the user-level ~/.kata/
```

Creates `config.yaml` (with each known target enabled if the tool was detected
on your machine), a sample `instructions/base.md`, and an empty
`mcp/servers.yaml`. Safe to run in an already-initialized project - it's a
no-op if `config.yaml` exists.

## `kata add mcp`

Add an MCP server definition to `.kata/mcp/servers.yaml`. The file is
edited through the YAML document API, so comments survive; the definition is
schema-validated before writing.

```sh
kata add mcp github \
  --command npx --arg -y --arg @modelcontextprotocol/server-github \
  --env 'GITHUB_TOKEN=${env:GITHUB_TOKEN}'

kata add mcp remote \
  --transport http --url https://mcp.example.com/mcp \
  --header 'Authorization=Bearer ${env:EXAMPLE_TOKEN}'
```

| Option                 | Description                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `--transport <kind>`   | `stdio` (default), `http`, or `sse`                                                                                                 |
| `--command <cmd>`      | Executable to launch (stdio)                                                                                                        |
| `--arg <value>`        | Command argument, repeatable                                                                                                        |
| `--env <KEY=VALUE>`    | Env var, repeatable; value may use `${env:VAR}`                                                                                     |
| `--url <url>`          | Server endpoint (http/sse)                                                                                                          |
| `--header <KEY=VALUE>` | HTTP header, repeatable                                                                                                             |
| `--scope <scope>`      | `project` (default) or `global` - a `global` server is written to the tool's user-level MCP config (e.g. `~/.claude.json`) on apply |
| `--force`              | Overwrite an existing server with the same name                                                                                     |

## `kata add <artifact>`

Scaffold other kata artifacts:

```sh
kata add instruction 20-testing
kata add prompt review --description "Review the current diff"
kata add agent reviewer --description "Reviews PRs"
kata add skill deploy --description "Deploys the app"
```

Each creates a templated file under `.kata/` (skills get
`skills/<name>/SKILL.md`) and refuses to overwrite without `--force`.

## `kata plan`

Dry run: show which native files would be created or updated, per target, with
content diffs.

```sh
kata plan
kata plan --target claude-code   # only these targets
kata plan --no-diff              # actions only, no diffs
kata plan --check                # CI gate: exit 1 when changes exist
kata plan --json                 # machine-readable plan with structured diffs
```

| Option                 | Description                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `-t, --target <id...>` | Only plan the listed targets                                                                  |
| `--no-diff`            | Hide content diffs                                                                            |
| `--check`              | Exit 1 when changes exist (like `status`, but with diffs)                                     |
| `--json`               | Print the plan as JSON: per-file actions, diff hunks, and a `managedRegionOnly` flag per file |

Actions shown per file: `+ create`, `~ update`, or `ok` (unchanged). Adapter
warnings (e.g. skipped artifacts) are listed with a leading `!`.

## `kata apply`

Compute the plan and write every create/update to disk. Unchanged files are
never touched.

```sh
kata apply
kata apply --target claude-code
kata apply --global              # write user-level files from ~/.kata/
```

| Option                 | Description                            |
| ---------------------- | -------------------------------------- |
| `-t, --target <id...>` | Only apply the listed targets          |
| `-g, --global`         | Apply the user-level `~/.kata/` config |

Global-scope files are shown with a `~/` prefix in plan, apply, and status
output.

## `kata import`

Ingest existing native configs into `.kata/` - the onboarding path for
projects that already have CLAUDE.md, `.mcp.json`, `.cursor/` rules, etc.

```sh
kata import --from claude-code
kata import --all            # every enabled target that supports import
kata import --from cursor --force
```

| Option           | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `--from <id...>` | Import from these targets (currently: `claude-code`, `cursor`) |
| `--all`          | Import from every enabled target that supports import          |
| `--force`        | Overwrite artifacts in `.kata/` that already exist             |

Behavior:

- Content generated by kata itself is excluded: managed regions are
  stripped from CLAUDE.md, and `.cursor/rules/kata.mdc` is ignored.
- Native env expansions are converted back to kata's `${env:VAR}` syntax.
- Conflicts are **skipped by default** - an artifact that already exists in
  `.kata/` is left untouched unless you pass `--force`. Import is
  idempotent: running it twice changes nothing.

## `kata status`

Drift detection: report native files that changed out-of-band (or were never
applied), without writing anything.

```sh
kata status
kata status --target claude-code
```

Each out-of-sync file is reported as `missing` (would be created) or
`drifted` (differs from what `.kata/` would render). Exits with code **1**
when anything is out of sync, so it can gate CI; `0` when clean.

## `kata doctor`

Environment checks for the current project:

```sh
kata doctor
```

- kata config parses and validates
- every enabled target has a registered adapter (hard error if not)
- each target's tool is detected on this machine
- adapter capability warnings (lossy mappings, skipped artifacts)
- every `${env:VAR}` reference resolves in the current shell
- every stdio MCP server's `command` is found on `PATH`

Exits 1 only on hard errors; warnings are informational.

## `kata install`

Install a shared config package and add it to `compose`. See
[Sharing & packages](/guide/sharing).

```sh
kata install https://github.com/acme/agent-standards.git   # vendored git
kata install npm:@company/kata-standards               # from node_modules
kata install ./shared/base-pkg                              # local folder
```

| Option          | Description                                            |
| --------------- | ------------------------------------------------------ |
| `--name <slug>` | Directory name for git installs (default: repo name)   |
| `--force`       | Replace an already-installed package (git update path) |
| `--json`        | Print the install result as JSON                       |

Git installs record their provenance (source URL and pinned commit) in a
`.kata-source.yaml` next to the vendored content, so update checks can
compare the vendored commit against the source later.

## `kata uninstall`

Remove an installed package by its manifest name: the compose entry is
deleted, and packages vendored under `.kata/packages/` are removed from
disk (local-path and npm packages are only unwired).

```sh
kata uninstall team-standards
```

| Option   | Description                        |
| -------- | ---------------------------------- |
| `--json` | Print the uninstall result as JSON |

## `kata watch`

Re-apply automatically whenever `.kata/` changes. Ctrl-C to stop.

```sh
kata watch
kata watch --target claude-code
```

## `kata targets`

Manage the `targets` section of `config.yaml`.

```sh
kata targets list           # each target: enabled/disabled, detected, adapter
kata targets enable <id>
kata targets disable <id>
```

`enable`/`disable` edit `config.yaml` through the YAML document API, so
comments and formatting you added by hand survive.
