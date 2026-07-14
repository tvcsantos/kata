# Getting started

## What is kata?

_**kata** - English /ˈkɑːtə/, Japanese 型 [ka̠ta̠] - a mold, model, or pattern:
a standardized template that produces the same form every time._

Every agent harness - Claude Code, Codex CLI, Cursor, Gemini CLI - supports the
same customization concepts (instruction files, MCP servers, prompts, skills),
but the file names, locations, and formats all diverge. A customization written
for one tool has to be manually ported to every other - error-prone,
unscalable, and unshareable.

**kata** gives you a single source of truth in a `.kata/` directory and
compiles it into each tool's native format - think Babel or Terraform, but for
agent configs. Commit `.kata/` to your repo, and every teammate's preferred
tool gets configured with one `kata apply`.

## Requirements

- Node.js ≥ 24

## Install

```sh
npm install -g @katahq/cli
```

This puts the `kata` command on your PATH. Or run it ad-hoc without installing:

```sh
npx @katahq/cli init
```

### From source

To hack on kata itself:

```sh
git clone https://github.com/tvcsantos/kata
cd kata
npm install
npm run build
npm link -w @katahq/cli   # makes `kata` available on your PATH
```

## Initialize a project

In the project you want to configure:

```sh
kata init
```

This scaffolds the `.kata/` config directory and detects which tools are
installed on your machine:

```
.kata/
  config.yaml            # enabled targets
  instructions/base.md   # shared instructions
  mcp/servers.yaml       # MCP server definitions
```

## Write your customization once

Edit `instructions/base.md` with the guidance you want every agent to follow:

```md
# Project instructions

Always run the test suite before committing.
Prefer small, focused PRs.
```

Add an MCP server to `mcp/servers.yaml`:

```yaml
version: 1
servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: ${env:GITHUB_TOKEN}
```

## Plan and apply

```sh
kata plan
```

```
target claude-code
  + create  CLAUDE.md
  + create  .mcp.json

2 file(s) to write. Run `kata apply` to write them.
```

`plan` shows a full diff for each file. When it looks right:

```sh
kata apply
```

Run `plan` again and it reports `No changes` - output is idempotent.

## Next steps

- [How kata works](/guide/how-it-works) - the compile model, team story, and current status
- [Kata format](/guide/kata-format) - everything `.kata/` supports
- [Managed files](/guide/managed-files) - how hand edits are preserved
- [CLI reference](/reference/cli)
