# Desktop app

The kata desktop app is the friendly face of [sharing & packages](/guide/sharing):
browse a curated registry of **bundles** (shareable agent-config packages),
inspect exactly what each one contains, and install them into your projects
with a full diff preview before anything touches disk. No Node, no CLI
knowledge required - the app embeds the same `@katahq/core` engine the CLI
uses, so both always behave identically.

## Installing

Download the latest installer for your platform from the
[**desktop-latest release**](https://github.com/tvcsantos/kata/releases/tag/desktop-latest).

::: warning Not code-signed
Kata is an open-source project without an Apple Developer account or a
Windows code-signing certificate, so the builds are not notarized/signed.
They are safe, but your OS shows a one-time warning you have to click
through. Each platform's steps are below.
:::

### macOS

The app is ad-hoc signed so it runs on Apple Silicon, but Gatekeeper still
flags it as unverified on first launch.

**Homebrew (recommended)** - avoids the warning entirely (the cask clears
the quarantine attribute after install):

```sh
brew install --cask tvcsantos/kata/kata
```

**DMG** - download `Kata-<version>-arm64.dmg` (Apple Silicon) or
`-x64.dmg` (Intel), drag Kata to Applications, then the first time you open
it: **System Settings → Privacy & Security → Open Anyway**. (Right-click →
Open no longer works on recent macOS.) Or clear the quarantine flag from a
terminal: `xattr -cr /Applications/Kata.app`.

### Windows

Download `Kata-<version>-setup.exe` and run it. SmartScreen may show
"Windows protected your PC" - click **More info → Run anyway**.

### Linux

Download the `.AppImage` (portable - `chmod +x` and run) or the `.deb`
(`sudo apt install ./Kata-<version>-x64.deb`).

## Staying up to date

The app checks for updates on launch and shows a banner when a newer version
is available:

- **Windows and Linux** download the update in the background and offer a
  **Restart to update** button.
- **macOS** links to the download page (unsigned apps can't self-update);
  with the Homebrew cask, `brew upgrade --cask kata` updates it instead.

## First run

On first launch the app asks two questions, once.

**Where should your bundles come from?** Bundles are served by registries -
static catalogs published as a single `index.json`. The official kata
registry is suggested with one click, but any registry URL works, including
`file://` paths for local development. At least one registry is required to
continue.

<img class="app-shot light-only" src="/images/app/welcome-light.png" alt="Welcome screen with registry setup, light mode" />
<img class="app-shot dark-only" src="/images/app/welcome-dark.png" alt="Welcome screen with registry setup, dark mode" />

**What kind of work do you do?** Pick one or more personas - they tailor
which bundles are suggested first, and you can change the answer anytime
from the Bundles screen.

<img class="app-shot light-only" src="/images/app/onboarding-selected-light.png" alt="Persona picker, light mode" />
<img class="app-shot dark-only" src="/images/app/onboarding-selected-dark.png" alt="Persona picker, dark mode" />

## Browsing bundles

The home screen merges every configured registry into one searchable,
filterable grid. Suggestions are ranked deterministically - curated picks
for your personas first, then persona matches, then featured bundles - and
each card states _why_ it is suggested. The persona dropdown filters the
grid; the verified toggle keeps only bundles reviewed by registry
maintainers (the green check).

<img class="app-shot light-only" src="/images/app/browse-light.png" alt="Bundle browser, light mode" />
<img class="app-shot dark-only" src="/images/app/browse-dark.png" alt="Bundle browser, dark mode" />

Everything works offline after the first fetch - each registry is cached
locally, and a banner tells you when you are looking at a cached copy.

## Bundle details

Clicking a card opens the trust-building view: provenance (which registry
listed it, the source repository and pinned commit, license, authors) and a
complete inventory of what the bundle adds - instructions, prompts, agents,
skills, and **MCP servers with the exact commands they run** and the
environment variables they need. Nothing is hidden: what you review here is
what gets installed.

<img class="app-shot light-only" src="/images/app/detail-light.png" alt="Bundle detail page, light mode" />
<img class="app-shot dark-only" src="/images/app/detail-dark.png" alt="Bundle detail page, dark mode" />

## Installing into a project

Installs are **plan-before-apply, always**. Clicking _Install on a
project..._ opens a self-contained flow:

**1. Pick the target project** - recent projects are offered, or open any
folder. If the folder is not a kata project yet, the app offers to run
`kata init` inline.

<img class="app-shot light-only" src="/images/app/install-pick-light.png" alt="Project picker step, light mode" />
<img class="app-shot dark-only" src="/images/app/install-pick-dark.png" alt="Project picker step, dark mode" />

**2. Review the diff** - the bundle is fetched into a staging area outside
your repository and a plan is computed for every enabled target. Each file
shows its exact hunks; the _managed region only_ badge means only the
kata-managed block changes and your hand edits are untouched.

<img class="app-shot light-only" src="/images/app/install-preview-light.png" alt="Install diff preview, light mode" />
<img class="app-shot dark-only" src="/images/app/install-preview-dark.png" alt="Install diff preview, dark mode" />

**3. Apply - or walk away.** _Cancel_ discards the staging area and leaves
your repository byte-identical. _Apply_ vendors the bundle into
`.kata/packages/`, wires it into `compose`, and writes the native files -
then reminds you of any environment variables (like `GITHUB_TOKEN`) the
bundle needs before use.

## Managing registries

Add as many registries as you like - a company-internal one next to the
official one, or a local `file://` checkout while developing bundles.
Bundles are merged in order (first registry wins on a name clash), each
registry caches independently, and one being unreachable never takes the
others down.

<img class="app-shot light-only" src="/images/app/registries-light.png" alt="Registries management, light mode" />
<img class="app-shot dark-only" src="/images/app/registries-dark.png" alt="Registries management, dark mode" />

## About & appearance

The About screen shows the app, embedded engine, and Electron versions
(handy when reporting issues), links to this documentation and the GitHub
repository, and an appearance switch: follow the system theme, or force
light or dark.

<img class="app-shot light-only" src="/images/app/about-light.png" alt="About screen, light mode" />
<img class="app-shot dark-only" src="/images/app/about-dark.png" alt="About screen, dark mode" />

## Security posture

The app renders third-party content (bundle READMEs and instruction
files), so the interface runs fully sandboxed: no Node integration, no
direct network or filesystem access, a strict content-security policy, and
every operation crossing a typed bridge into the main process. MCP server
commands are always shown verbatim before install, and secrets never pass
through the app - it only ever displays environment variable _names_.
