---
layout: ../../layouts/MarkdownDocsLayout.astro
title: "Get Started — Yarn docs"
activePage: get-started
sidebar: getting-started
breadcrumb: Get Started
prev: { href: "/", label: "Home" }
next: { href: "concepts.html", label: "Concepts" }
---

# Get started with Yarn

Install Yarn, set up your first project, and learn the commands you'll reach for ten times a day. This page is short on purpose — once you're comfortable, read [Concepts](concepts.html) next.

:::note[PREREQUISITES]
You'll need **Node.js 18.12 or newer**. Verify with `node --version`. If you don't have Node, install it via [nodejs.org](#), `nvm`, or `fnm` — Yarn doesn't care which.
:::

## Installation

There are three recommended ways to install Yarn. Corepack is the official route — it ships with Node itself and guarantees each project uses the exact Yarn version it declared.

### via Corepack (recommended)

Corepack is bundled with Node 16+. One command enables it globally:

```terminal
corepack enable
# Opt-in to the latest stable Yarn release
corepack install --global yarn@stable
yarn --version
> 4.8.1
```

### via Homebrew (macOS / Linux)

```terminal
brew install yarn
```

### via winget (Windows)

```terminal
winget install Yarn.Yarn
```

:::warning[WARNING]
Do **not** install Yarn 1.x (Classic) via `npm install -g yarn`. That release is in maintenance-only mode and lacks most of the features described in these docs. If you see `1.22.x`, you're on the wrong major.
:::

## Your first project

Starting a new Yarn project takes under a minute.

:::steps

1. Create a directory and pin the Yarn version

   The `set version` command writes a Yarn binary into `.yarn/releases/` and a `packageManager` field into `package.json` — so everyone on your team runs the same Yarn.

   ```terminal
   mkdir hello-yarn && cd hello-yarn
   yarn init -2
   > ✔ Project initialized. Yarn 4.8.1 pinned.
   ```

2. Add a dependency

   ```terminal
   yarn add lodash
   > ➤ YN0000: · Yarn 4.8.1
   > ➤ YN0000: ┌ Resolution step
   > ➤ YN0000: └ Completed in 0s 214ms
   > ➤ YN0000: ┌ Fetch step
   > ➤ YN0013: │ lodash@npm:4.17.21 can't be found in the cache and will be fetched from the remote registry
   > ➤ YN0000: └ Completed in 0s 488ms
   > ➤ YN0000: ┌ Link step
   > ➤ YN0000: └ Completed
   > ➤ YN0000: · Done in 0s 782ms
   ```

3. Create an entry point and run it

   ```js title="index.js"
   import { chunk } from 'lodash';

   const rows = chunk(['a', 'b', 'c', 'd', 'e'], 2);
   console.log(rows);
   ```

   ```terminal
   yarn node index.js
   > [ [ 'a', 'b' ], [ 'c', 'd' ], [ 'e' ] ]
   ```

4. Commit the lockfile and `.yarnrc.yml`

   At minimum, commit `package.json`, `yarn.lock`, `.yarnrc.yml`, and `.yarn/releases/`. See [Migrating from npm](#migrating-from-npm) for the full `.gitignore`.

:::

## Common commands

A quick reference for the handful of commands that cover 90% of daily use:

- **`yarn`** — install everything declared in `package.json`. Equivalent to `yarn install`.
- **`yarn add <pkg>`** — add a runtime dependency. Use `-D` for dev, `-P` for peer, `-O` for optional.
- **`yarn remove <pkg>`** — remove a dependency from every section it appears in.
- **`yarn up <pkg>`** — bump to the latest version matching your range. Add `-R` to hit the entire monorepo.
- **`yarn run <script>`** — run a script from `package.json`. Can also be invoked bare: `yarn build`.
- **`yarn dlx <pkg>`** — like `npx`: one-shot run a package without installing it.
- **`yarn why <pkg>`** — show exactly why a package is in your tree.

:::tip[TIP]
Most commands accept `--json` for machine-readable output. Combine with `jq` for quick scripts: `yarn workspaces list --json | jq -r .name`.
:::

## Migrating from npm

Migrating an existing npm project is usually a three-command operation. Yarn reads your `package-lock.json`, produces an equivalent `yarn.lock`, and leaves your source untouched.

:::steps

1. Pin Yarn in the repo

   ```terminal
   cd your-project
   yarn set version stable
   ```

2. Import your existing lockfile

   ```terminal
   yarn import
   > ✔ Imported 842 packages from package-lock.json
   ```

3. Run an install

   ```terminal
   yarn install
   ```

4. Delete the old files and update `.gitignore`

   ```bash title=".gitignore"
   # dependencies
   node_modules

   # yarn — keep releases, plugins, and cache; ignore the rest
   .yarn/*
   !.yarn/cache
   !.yarn/patches
   !.yarn/plugins
   !.yarn/releases
   !.yarn/sdks
   !.yarn/versions
   .pnp.*
   ```

:::

Script invocations change subtly:

```diff title="diff"
- npm install
+ yarn
- npm install lodash --save-dev
+ yarn add lodash --dev
- npm run build
+ yarn build
- npx create-next-app
+ yarn dlx create-next-app
```

:::danger[DANGER]
Never commit both `package-lock.json` and `yarn.lock`. The two resolvers will drift and you'll end up shipping different dependency graphs to different teammates. Delete `package-lock.json` in the same commit that introduces `yarn.lock`.
:::

## Editor integration

If you're using Plug'n'Play, your editor needs to know how to resolve imports without a `node_modules` folder. Yarn generates editor SDK shims in one command:

```terminal
yarn dlx @yarnpkg/sdks vscode
> ✔ Wrote .yarn/sdks/typescript/
> ✔ Wrote .vscode/settings.json
```

Supported targets: `vscode`, `vim`, `neovim`, `emacs`, `base` (any LSP-aware editor).

## Next steps

You're ready. A few paths from here, depending on what you're building:

- Building a library or app? Read [Dependency protocols](concepts.html#dependency-protocols) to understand what goes in `package.json`.
- Working in a monorepo? Jump to [Workspaces](concepts.html#workspaces) and [Task dependencies](concepts.html#task-dependencies).
- Want the fastest possible installs? See [Plug'n'Play](concepts.html#plug-n-play) and [Zero Installs](concepts.html#zero-installs).
- Need to override an upstream bug? [Dependency patches](concepts.html#dependency-patches).
