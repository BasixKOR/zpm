---
layout: ../../layouts/MarkdownDocsLayout.astro
title: "package.json — Yarn reference"
activePage: reference
sidebarActivePage: manifest
sidebar: reference
breadcrumb: ["Docs", "Reference", "Manifest"]
mainMaxWidth: "820px"
prev: { href: "concepts.html", label: "Concepts" }
next: { href: "yarnrc.html", label: "Settings (.yarnrc.yml)" }
---

# package.json

The manifest describes a package — its name, version, dependencies, scripts, and the handful of fields that Yarn reads to orchestrate resolution, linking, and publishing.

## Required fields

Every package must declare `name` and `version`. Everything else is optional unless you publish to a registry.

### `name` :type[string] :required

A globally unique identifier for your package on the registry. Scoped names (`@scope/name`) are strongly recommended — they avoid collisions and group related packages.

```json
{ "name": "@acme/eslint-config" }
```

- Must be lowercase and URL-safe.
- Must not start with `.` or `_`.
- Maximum 214 characters, including any scope prefix.

### `version` :type[string] :required

The package version, as a valid [semver](https://semver.org) string. Yarn uses this to resolve `workspace:` protocols and to decide what `yarn npm publish` pushes to the registry.

```json
{ "version": "4.8.1" }
```

## Descriptive fields

Metadata shown on registry pages and surfaced in `yarn why`, `yarn info`, and IDE hovers.

### `description` :type[string]

A one-sentence summary of the package. Shown as the subtitle on the npm website and as the hover tooltip in most IDEs.

### `keywords` :type[string\[\]]

Search terms registries use to index the package. Five to ten specific terms beats thirty vague ones.

```json
{ "keywords": ["cli", "monorepo", "build-tools"] }
```

### `license` :type[string]

An [SPDX expression](https://spdx.org/licenses/) like `MIT`, `BSD-3-Clause`, or `(MIT OR Apache-2.0)`. Use `UNLICENSED` for private code.

### `author` :type[string | object]

The primary author. Accepts either a person object or the shorthand string form `"Name <email> (url)"`.

```json
{
  "author": {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "url": "https://adalovelace.dev"
  }
}
```

### `homepage` :type[string]

URL of the project's landing page. Linked from registry listings.

### `repository` :type[string | object]

Where the source lives. Shorthand `"github:owner/name"` or a full object with `type`, `url`, and `directory` (useful for monorepos).

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/acme/monorepo.git",
    "directory": "packages/api"
  }
}
```

## Dependencies

Five related fields control what ends up in your dependency graph. Each maps package names to [version ranges or protocols](concepts.html#dependency-protocols).

### `dependencies` :type[{ \[name\]: range }]

Runtime dependencies. Installed when your package is installed as a dependency by another project.

```json title="package.json"
{
  "dependencies": {
    "lodash": "npm:^4.17.21",
    "@acme/ui": "workspace:^"
  }
}
```

### `devDependencies` :type[{ \[name\]: range }]

Dependencies needed only at development time — bundlers, type checkers, test runners. Never installed by downstream consumers.

### `peerDependencies` :type[{ \[name\]: range }]

Dependencies the <em class="not-italic text-[var(--fg)]">host</em> must provide. Used for plugins and framework extensions that need to share a single instance with the application.

:::tip[TIP]
Pair with `peerDependenciesMeta` to mark individual peers as `optional`; Yarn won't fail an install if an optional peer is missing.
:::

### `optionalDependencies` :type[{ \[name\]: range }]

Dependencies that may fail to install without causing the whole install to fail. Commonly used for platform-specific native modules.

### `resolutions` :type[{ \[pattern\]: range }] :since[Yarn only]

Overrides for the resolver. Force every instance of a transitive dependency to a specific version, patch a nested package, or redirect a package to an alternate source.

```json title="package.json"
{
  "resolutions": {
    "minimatch": "9.0.3",
    "react-dom/scheduler": "0.23.0",
    "tap-parser@^11": "patch:tap-parser@npm:11.0.2#./patches/tap.patch"
  }
}
```

## Scripts

### `scripts` :type[{ \[name\]: command }]

Arbitrary shell commands you can run with `yarn <name>`. A handful of names are reserved and run automatically: `preinstall`, `install`, `postinstall`, `prepack`, `postpack`, `prepublish`, `prepare`.

```json
{
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "lint": "eslint src",
    "prepare": "yarn build"
  }
}
```

## Yarn-specific fields

### `workspaces` :type[string\[\] | object]

Declares child packages of a monorepo root. Paths are glob patterns relative to the manifest.

```json
{
  "private": true,
  "workspaces": ["packages/*", "apps/*"]
}
```

### `packageManager` :type[string] :since[since 3.0]

Pins which package manager and version should install this project. Corepack reads this field and shims the right binary automatically.

```json
{ "packageManager": "yarn@4.8.1" }
```

### `engines` :type[{ node?, yarn? }]

Version ranges the package is known to work with. When `enableEngineChecks` is on, Yarn refuses installs whose runtime is out of range.

### `private` :type[boolean] :default[false]

When `true`, `yarn npm publish` refuses to publish the package. Always set on monorepo roots.

### `publishConfig` :type[object]

Overrides applied at publish time. The classic use case is rewriting paths from source to dist:

```json
{
  "main": "src/index.ts",
  "publishConfig": {
    "main": "dist/index.js",
    "types": "dist/index.d.ts",
    "access": "public"
  }
}
```

### `installConfig` :type[object] :since[since 4.0]

Per-workspace install overrides. Most commonly used to opt a workspace out of hoisting or to force a specific linker.

```json
{
  "installConfig": {
    "hoistingLimits": "workspaces",
    "selfReferences": false
  }
}
```

### `preferUnplugged` :type[boolean] :default[false]

When `true`, forces the package to be extracted to disk instead of served from its zipped cache entry. Set on packages that call `fs.realpath` on their own files or include native binaries.

### `dependenciesMeta` :type[{ \[name\]: meta }]

Per-dependency flags that don't fit in a version range: `built` (run install scripts), `optional`, `unplugged`.

```json
{
  "dependenciesMeta": {
    "sharp": { "built": true, "unplugged": true }
  }
}
```
