---
layout: ../../layouts/MarkdownDocsLayout.astro
title: ".yarnrc.yml — Yarn reference"
activePage: reference
sidebarActivePage: yarnrc
sidebar: reference
breadcrumb: ["Docs", "Reference", "Settings"]
mainMaxWidth: "820px"
prev: { href: "manifest/", label: "Manifest (package.json)" }
next: { href: "cli-add/", label: "CLI: yarn add" }
---

# .yarnrc.yml

Yarn's project and user settings live in `.yarnrc.yml`. A file at the project root takes precedence over `~/.yarnrc.yml`; every setting is mergeable, so enterprise environments can layer defaults centrally.

:::note[NOTE]
Run `yarn config set <key> <value>` to edit a setting from the CLI — it will rewrite `.yarnrc.yml` in place, preserving comments and ordering.
:::

## Core

### `yarnPath` :type[path]

Path to the Yarn binary this project expects. Set automatically by `yarn set version`. Everyone running `yarn` in the repo will transparently defer to this file, regardless of their global install.

```yaml
yarnPath: .yarn/releases/yarn-4.8.1.cjs
```

### `nodeLinker` :type['pnp' | 'pnpm' | 'node-modules'] :default[pnp]

How packages materialize on disk. See [Node.js linkers](concepts/#nodejs-linkers) for the trade-offs.

### `packageExtensions` :type[{ \[selector\]: object }]

Patches applied to third-party manifests — typically to add missing peer dependencies that upstream forgot to declare. Unlike `resolutions`, this modifies the <em class="not-italic">shape</em> of the package, not its version.

```yaml
packageExtensions:
  "debug@*":
    peerDependenciesMeta:
      supports-color:
        optional: true
  "react-native@*":
    dependencies:
      scheduler: "*"
```

## Installation

### `enableGlobalCache` :type[boolean] :default[true]

When `true`, package tarballs are stored in a single global cache (`~/.yarn/berry/cache`) shared across all projects. Set to `false` to use `.yarn/cache` per-project — required for [Zero Installs](concepts/#zero-installs).

### `enableImmutableInstalls` :type[boolean] :default[auto]

Refuse to modify `yarn.lock` during install. Set to `true` to enforce in CI. Auto-detected from common CI environment variables (`CI=true`, `GITHUB_ACTIONS`, etc.).

### `pnpMode` :type['strict' | 'loose'] :default[strict]

Under `strict`, importing a package that isn't declared in `dependencies` throws. Under `loose`, Yarn falls back to the hoisted tree when it can.

### `pnpFallbackMode` :type['none' | 'dependencies-only' | 'all'] :default[dependencies-only]

Controls which packages are eligible for the PnP fallback that papers over undeclared peers in third-party code.

### `nmHoistingLimits` :type['workspaces' | 'dependencies' | 'none'] :default[none]

Applies only when `nodeLinker` is `node-modules`. Limits how far packages can hoist — `workspaces` keeps each workspace's `node_modules` isolated, which prevents accidental cross-imports.

## Registry

### `npmRegistryServer` :type[url] :default[https://registry.npmjs.org]

The default registry. Override per-scope via `npmScopes`.

### `npmScopes` :type[{ \[scope\]: object }]

Per-scope registry + auth configuration. The classic use case is pointing `@internal` at a private registry while keeping public packages on npmjs.

```yaml
npmScopes:
  acme:
    npmRegistryServer: "https://npm.acme.internal"
    npmAlwaysAuth: true
    npmAuthToken: "${ACME_NPM_TOKEN}"
```

### `npmAuthToken` :type[string]

Bearer token for registry authentication. Reads `${VAR}` interpolation at load time — prefer that to committing secrets.

## Network

### `httpProxy` :type[url]

HTTP proxy used for all outbound requests. Accepts `${VAR}` interpolation.

### `httpsProxy` :type[url]

HTTPS proxy. Defaults to `httpProxy` if unset.

### `networkTimeout` :type[number] :default[60000]

Milliseconds before a network request is considered failed.

### `networkConcurrency` :type[number] :default[50]

Maximum simultaneous network requests. Lower this on constrained CI workers if you see ECONNRESET errors.

## Plugins

### `plugins` :type[array]

Loaded plugins, committed into `.yarn/plugins/`. The list is populated automatically by `yarn plugin import`.

```yaml
plugins:
  - path: .yarn/plugins/@yarnpkg/plugin-typescript.cjs
    spec: "@yarnpkg/plugin-typescript"
  - path: .yarn/plugins/@yarnpkg/plugin-interactive-tools.cjs
    spec: "@yarnpkg/plugin-interactive-tools"
```

### `enableTelemetry` :type[boolean] :default[true]

Anonymous usage counters. No project paths, package names, or user identifiers are ever sent. Disable globally with `yarn config set --home enableTelemetry 0`.

## Deprecated

### `pnpPurgeOnInstall` :type[boolean] :deprecated[removed in 5.0]

Replaced by the automatic PnP reconciliation introduced in Yarn 4.2. No longer has any effect — remove it from your config.
