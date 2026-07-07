# Configuration schema

Kata files are validated on load. This page documents schema **version 1** (the `version: 1` declared in each file).

## `config.yaml`

| Field                  | Type     | Default      | Description                                                                     |
| ---------------------- | -------- | ------------ | ------------------------------------------------------------------------------- |
| `version`              | `1`      | - (required) | Schema version                                                                  |
| `targets`              | map      | `{}`         | Target id -> target config                                                      |
| `targets.<id>.enabled` | boolean  | `true`       | Whether `plan`/`apply` include this target                                      |
| `targets.<id>.options` | map      | `{}`         | Adapter-specific options bag                                                    |
| `compose`              | string[] | `[]`         | Shared packages, in order - `./path` or `npm:<pkg>` ([details](/guide/sharing)) |

```yaml
version: 1
targets:
  claude-code:
    enabled: true
compose:
  - npm:@company/kata-standards
```

## `mcp/servers.yaml`

| Field     | Type | Default | Description                      |
| --------- | ---- | ------- | -------------------------------- |
| `version` | `1`  | `1`     | Schema version                   |
| `servers` | map  | `{}`    | Server name -> server definition |

### Server definition

| Field       | Type                       | Default   | Description                                                                                                                             |
| ----------- | -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `transport` | `stdio` \| `http` \| `sse` | `stdio`   | How the tool talks to the server                                                                                                        |
| `command`   | string                     | -         | Executable to launch. **Required for `stdio`**                                                                                          |
| `args`      | string[]                   | `[]`      | Command arguments                                                                                                                       |
| `env`       | map                        | `{}`      | Environment variables for the server process                                                                                            |
| `url`       | string                     | -         | Server endpoint. **Required for `http`/`sse`**                                                                                          |
| `headers`   | map                        | `{}`      | HTTP headers (`http`/`sse` only)                                                                                                        |
| `scope`     | `project` \| `global`      | `project` | Where native config is written: `global` servers go to the tool's user-level MCP config (e.g. `~/.claude.json`, `~/.codex/config.toml`) |

String values in `env`, `headers`, `args`, and `url` may contain
[`${env:VAR}` references](/guide/kata-format#secrets-env-var).

```yaml
version: 1
servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: ${env:GITHUB_TOKEN}
  remote:
    transport: http
    url: https://mcp.example.com/mcp
    headers:
      Authorization: Bearer ${env:EXAMPLE_TOKEN}
```

## `instructions/*.md`

Plain markdown, no frontmatter. Files are composed in file-name order
into a single instruction block. See
[Kata format](/guide/kata-format#instructions).
