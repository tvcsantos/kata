# Sharing & packages

A shareable unit of agent config is a **package**: a folder laid out exactly
like `.kata/`, plus a manifest.

```
my-standards/
  kata-package.yaml    # manifest (required)
  instructions/
    10-style.md
  mcp/servers.yaml
  prompts/…  agents/…  skills/…
```

`kata-package.yaml`:

```yaml
name: team-standards # required
version: 2.0.0 # optional
description: Our shared agent rules
```

### Discovery metadata

Optional fields let registries and marketplace UIs present a package -
packages without them still install fine, they just present poorly:

```yaml
name: backend-essentials # required; registries need lowercase kebab-case
version: 1.4.0 # semver recommended
description: >- # one-liner, <= 140 chars, shown on cards
  Test-first instructions, PR conventions, and MCP servers
  for backend services.

personas: # persona slugs this package is curated for
  - backend
  - devops
tags: # freeform, lowercase kebab-case
  - testing
  - code-review
targets: # harnesses this package is intended for; informational
  - claude-code # (kata compiles for whatever the project enables),
  - cursor # used for marketplace filtering
homepage: https://github.com/acme/agent-standards
license: MIT
icon: ./icon.png # square, <= 128px, relative to the package root
authors:
  - name: Jane Doe
    url: https://github.com/janedoe

requires: # requirements surfaced to users before install
  env: # env vars the MCP servers reference
    - GITHUB_TOKEN
  tools: # binaries MCP servers will execute
    - npx
```

`requires.env` is derivable - kata scans `${env:VAR}` references in
`mcp/servers.yaml` - so declare it only for vars kata cannot see (e.g. vars
an instruction tells the agent to use).

Programmatic consumers (registry CI, marketplace UIs) validate manifests
with `validateManifest()` from `@katahq/core`: schema violations come back
as errors, presentation lints (non-kebab-case name, non-semver version,
over-long description) as warnings.

## Composing packages

Declare packages in `config.yaml`; they apply in order, and your local
`.kata/` artifacts always win:

```yaml
version: 1
targets:
  claude-code: { enabled: true }
compose:
  - ./shared/base-pkg # local folder (monorepos)
  - npm:@company/kata-standards # from node_modules
  - ./.kata/packages/team-standards # vendored by `kata install`
```

Override rules (deterministic):

- Later compose entries override earlier ones; the project overrides all.
- Instructions, prompts, agents, and skills override **by name** (a local
  `10-style.md` completely replaces a package's `10-style.md`).
- MCP servers override by server name.
- Instructions still compose in file-name order after merging, so packages can
  interleave with local files via prefixes (`10-…`, `20-…`).

## Installing packages

**From git** - vendors the content into your repo (no submodule):

```sh
kata install https://github.com/acme/agent-standards.git
kata install git@github.com:acme/agent-standards.git --name acme
```

This shallow-clones into `.kata/packages/<name>/`, strips `.git`, and
appends the path to `compose`. Commit the result; teammates need nothing but
`kata apply`. Re-run with `--force` to update to the latest version.

**From a monorepo of bundles** - one repo can host several bundles in
subdirectories; select one with `#path:`:

```sh
kata install "https://github.com/acme/agent-bundles.git#path:bundles/backend"
```

Only that directory is vendored (named after it by default), and updates
follow the same subdirectory.

**From npm** - install with your package manager, then wire it up:

```sh
npm install -D @company/kata-standards
kata install npm:@company/kata-standards
```

The `npm:` form resolves through `node_modules`, so the package version is
managed by your lockfile like any other dependency.

**From a local folder** - validates the manifest and wires up `compose`:

```sh
kata install ./shared/base-pkg
```

**Uninstalling** - `kata uninstall <name>` (the manifest name) removes the
compose entry and deletes the vendored directory for git installs;
local-path and npm packages are only unwired.

## Adapter plugins

Adapters for tools kata doesn't ship can be distributed as npm packages
named `kata-adapter-<tool>` (scoped works too:
`@you/kata-adapter-<tool>`). Any such package found in `node_modules` is
loaded automatically and shows up in `kata targets list`.

A plugin default-exports an `Adapter` from `@katahq/core`:

```js
// kata-adapter-mytool/index.js
export default {
  id: "mytool",
  displayName: "My Tool",
  capabilities: { instructions: "full" },
  async detect(ctx) {
    /* is the tool present? */
  },
  async emit(ctx) {
    return { files: [], warnings: [] };
  },
};
```

Set `"main"` in its package.json to that entry file. Plugins that clash with a
built-in adapter id, or don't export a valid adapter shape, are skipped with a
warning. See [Adapters](/reference/adapters#writing-an-adapter) for the full
interface.

## Watch mode

While iterating on `.kata/` (or a package), keep native files in sync
automatically:

```sh
kata watch                # re-applies on every .kata/ change
kata watch -t claude-code
```
