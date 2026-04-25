---
layout: ../../layouts/MarkdownDocsLayout.astro
title: "Concepts — Yarn docs"
activePage: concepts
sidebar: concepts
breadcrumb: Concepts
prev: { href: "get-started.html", label: "Get Started" }
next: { href: "#", label: "Reference" }
---

# Concepts

Yarn makes a handful of strong opinions about what a package manager should do. This section explains *why* those opinions exist — and how to leverage them as your projects grow from a single package to a hundred.

## Core concepts

Every Yarn project — from the smallest CLI tool to the largest monorepo — is built on four primitives. Understanding them is enough to use Yarn productively. The later sections build on these.

### Dependency protocols

Yarn extends `package.json` with a rich set of protocols that declare **where** a dependency comes from, not just its version. A protocol prefix in a version range reroutes resolution to a non-registry source.

```json title="package.json"
{
  "dependencies": {
    "lodash": "npm:^4.17.21",
    "my-fork": "npm:lodash@npm:4.17.21",
    "internal-ui": "workspace:^",
    "design-system": "portal:../design-system",
    "tap-parser": "patch:tap-parser@npm:11.0.2#./patches/tap.patch",
    "prettier": "github:prettier/prettier#main",
    "legacy-lib": "file:./vendor/legacy.tgz"
  }
}
```

Each protocol resolves to a cache entry, so installs remain deterministic. The most common protocols are:

- **npm:** — the default. Points at a semver range on the npm registry (or your configured mirror).
- **workspace:** — always resolve to another workspace in the same monorepo. Enforces co-versioning at install time.
- **portal:** — symlink to a local path. Unlike `file:`, dependencies of the portal are resolved by *your* project, not theirs.
- **patch:** — apply a unified diff to a package before it's written to the cache. Survives re-install; commits to git.
- **github: / git:** — pin to a git commit, branch, or tag. Resolution records the exact SHA in the lockfile.

:::tip[TIP]
Use `workspace:^` in monorepos instead of pinning versions. At publish time, Yarn rewrites it to the concrete version your workspace currently resolves to — so consumers of your package see a normal semver range.
:::

### Node.js linkers

A **linker** decides how resolved packages end up on disk. Yarn ships three first-class linkers; all produce the same module graph, only the strategy differs.

:::steps

1. Plug'n'Play (`pnp`) — the default

   Yarn generates a single `.pnp.cjs` file that maps every import to a zipped tarball in the global cache. No `node_modules` is created at all. Imports are resolved in O(1) at runtime.

2. PnPM-style (`pnpm`)

   Packages are hoisted into a content-addressable store, and `node_modules` contains symlinks into that store. Compatible with tools that walk the filesystem.

3. Classic (`node-modules`)

   A traditional `node_modules` tree, hoisted the same way npm would. Slowest but maximally compatible — useful for React Native, some legacy bundlers, and CI shells that cannot register a Node loader.

:::

Configure in `.yarnrc.yml`:

```yaml title=".yarnrc.yml"
nodeLinker: pnp              # or 'pnpm' or 'node-modules'
pnpMode: strict              # 'strict' forbids unlisted imports
enableGlobalCache: true
```

:::note[NOTE]
Switching linkers is a one-command operation. Yarn re-materializes the project to match the new strategy; no changes to source code are required unless you relied on specific `node_modules` paths (e.g. `require.resolve` with a hard-coded traversal).
:::

### Workspaces

A workspace is a package that belongs to a larger repository — a monorepo. Declaring workspaces unlocks topologically-ordered scripts, shared dependency ranges, and constraint enforcement across packages.

```json title="package.json (root)"
{
  "private": true,
  "name": "acme",
  "workspaces": [
    "packages/*",
    "apps/*",
    "tools/*"
  ]
}
```

Common workspace commands:

```terminal
yarn workspaces list --json
# Run a script in every workspace, in topological order
yarn workspaces foreach -At run build
# Add a dep to a single workspace
yarn workspace @acme/api add fastify
```

### Yarn Switch

**Yarn Switch** lets a single repository declare the exact Yarn version it expects — down to the patch — and transparently fetches that binary the first time someone runs `yarn`. Everyone on the team runs the same Yarn, without globally installing anything.

```terminal
# Pin the current repo to Yarn 4.8.1
yarn set version 4.8.1
> ✔ Yarn binary saved to .yarn/releases/yarn-4.8.1.cjs
> ✔ .yarnrc.yml updated
```

The binary is committed to the repo under `.yarn/releases/`. A tiny shim in `.yarnrc.yml` (`yarnPath:`) reroutes every subsequent `yarn` invocation to the pinned file, bypassing whatever version is globally installed.

## Intermediary concepts

Once the core is comfortable, these tools cover the gap between "a project that works on my laptop" and "a project that scales across a team and CI."

### Constraints

Constraints are declarative rules about the *contents* of `package.json` files across a monorepo. Written in Prolog (or, since 4.2, a JavaScript DSL), they answer questions like *"does every workspace declare the same version of React?"* in a single CI step.

```js title="yarn.config.cjs"
module.exports = {
  async constraints({ Yarn }) {
    // Every workspace must use the same React version
    const pinned = '18.3.1';
    for (const dep of Yarn.dependencies({ ident: 'react' })) {
      dep.update(pinned);
    }
    // No workspace may depend on lodash
    for (const dep of Yarn.dependencies({ ident: 'lodash' })) {
      dep.error('lodash is banned; use es-toolkit instead');
    }
  },
};
```

:::warning[WARNING]
Constraints run in CI by default. A failing rule will block your build — which is the point. Start strict and relax rules as the team negotiates exceptions; the opposite is much harder.
:::

### Dependency patches

Yarn's `patch:` protocol lets you fork a package without a real fork. Changes are captured as a unified diff, stored alongside your code, and re-applied every install.

:::steps

1. Open an editable copy of the package

   Yarn extracts the package to a temporary folder and opens your editor.

   ```terminal
   yarn patch react-dom
   > To apply changes, run: yarn patch-commit /tmp/xfs-abc/user
   ```

2. Make your edits in the extracted folder.

3. Commit the patch back into your project

   ```terminal
   yarn patch-commit -s /tmp/xfs-abc/user
   > ✔ Wrote patch to .yarn/patches/react-dom-npm-18.3.1-a91.patch
   > ✔ Rewrote package.json
   ```

4. The resulting `package.json` entry now reads `patch:react-dom@npm:18.3.1#./.yarn/patches/…`. Commit both the patch file and the manifest.

:::

### Node.js versioning

Projects may pin a specific Node.js version via the `engines.node` field; Yarn (when `enableEngineChecks` is on) refuses to install if your runtime is out of range. For heavier projects, use **Corepack** or **Volta** to install Node itself per-project.

```json title="package.json"
{
  "engines": {
    "node": "^20.10.0 || ^22.0.0"
  },
  "packageManager": "yarn@4.8.1"
}
```

### Peer dependencies

A peer dependency is a package your library expects the **host application** to provide. React plugins, for example, declare `react` as a peer so that every plugin shares the same React instance.

Yarn enforces peer ranges strictly:

- Missing peers cause installs to fail unless marked `peerDependenciesMeta.optional`.
- Incompatible peer ranges print a single, grouped warning — never a wall of duplicates.
- Peers participate in Plug'n'Play's "virtual package" system (see [Virtual packages](#virtual-packages)), ensuring every consumer sees the peer its author intended.

### Workspace profiles

Profiles let you describe partial installs: "CI only needs runtime dependencies," "Docker image only needs `@acme/api`," "IDE needs everything including `devDependencies`." Each is a named tuple of `--workspace`, `--focus`, and `--production` flags captured in config.

```yaml title=".yarnrc.yml"
workspaceProfiles:
  ci:
    focus: ["@acme/api", "@acme/worker"]
    production: true
  docker-api:
    focus: "@acme/api"
    production: true
    includeRoot: false
  ide:
    production: false
```

```terminal
yarn install --profile docker-api
```

### Yarn Plug'n'Play

Plug'n'Play (PnP) is Yarn's strict, hoist-free module resolver. Instead of a `node_modules` tree, Yarn generates a single lookup file — `.pnp.cjs` — that maps *(package, version, dependency)* triples to on-disk locations.

The result:

- **Installation is I/O-light.** No files are copied; packages stay as gzipped tarballs in the global cache.
- **Resolution is deterministic.** A module cannot accidentally require a package it didn't declare — there's no hoisted `node_modules` to fall through to.
- **Cold cache is fast.** `yarn install` on a 400-package repo drops from ~48s (npm) to ~14s (Yarn PnP) on a 4-core runner.

:::note[NOTE]
PnP requires Node to load an extra resolver. Yarn ships a loader that Corepack sets up for you; most tools (Jest, TypeScript, ESLint, webpack, esbuild, Vite, Next.js) detect PnP automatically via their own resolver plugins.
:::

### Task dependencies

Scripts in a monorepo often depend on other scripts in *other* workspaces: `@acme/web`'s `build` needs `@acme/ui`'s `build` to have run first. Yarn's `workspaces foreach` understands topological order natively:

```terminal
yarn workspaces foreach -pt run build
```

The flags:

- `-p` — parallel (bounded by `--jobs`, default = CPU count)
- `-t` — topological; never run a workspace before its dependencies
- `-A` — include the root workspace
- `--from <pattern>` — only run in workspaces downstream of `<pattern>`

## Advanced concepts

These sections cover the sharp edges. You don't need them to ship — but understanding them turns a big monorepo from a chore into a force multiplier.

### Performances

Yarn's performance model is built on three invariants:

1. Every network fetch is content-addressable and cached globally.
2. Every on-disk artifact is idempotent — running `yarn install` a second time is a no-op.
3. Every stage (resolve, fetch, link, build) runs in its own bounded worker pool.

In practice that means:

```bash title="hyperfine output — 10k-dep monorepo, warm network, empty cache"
# cold install, median of 50 runs, 4-core CI runner
Benchmark: yarn install
  Time (mean ± σ):     14.213 s ±  0.214 s
  Range (min … max):   13.889 s … 14.902 s

Benchmark: npm ci
  Time (mean ± σ):     48.441 s ±  1.108 s
  Range (min … max):   47.019 s … 50.722 s
```

With a warm cache the numbers drop another order of magnitude — a zero-install repo reaches runtime in under 400ms.

### Virtual packages

When two workspaces share a dependency but have *different* peer dependencies, Yarn creates a **virtual package**: an alias for the shared dep, parameterized by the caller's peers. This is what makes strict PnP workable — each consumer sees its own view of the dependency graph without duplication on disk.

Conceptually:

```js title="Resolved identities"
// @acme/web depends on styled-components@6, which peers react@18
// @acme/docs depends on styled-components@6, which peers react@17
//
// Yarn produces two *virtual* identities that point at the same tarball:
//
//   styled-components@virtual:abc123#npm:6.0.0  (react@18 context)
//   styled-components@virtual:def456#npm:6.0.0  (react@17 context)
```

:::danger[DANGER]
Never hard-code a virtual identity in your code. The `virtual:` hash is derived from the peer context and *will* change when peers move. Use the package name, and let PnP resolve it at runtime.
:::

### Zero Installs

A **Zero Install** repository commits its entire offline cache alongside its source. Cloning the repo is enough to run it — there is no install step, no network I/O, no CI warm-up.

The trade-off is repository size. A 400-package project typically adds 40–80MB of compressed tarballs to the repo — paid once, amortized over every future `git clone`.

:::steps

1. Enable in `.yarnrc.yml`

   ```yaml title=".yarnrc.yml"
   enableGlobalCache: false
   nmMode: classic
   nodeLinker: pnp
   ```

2. Commit `.yarn/cache/` and `.pnp.cjs` to git.

3. Add a check that the working tree is clean after `yarn install`:

   ```terminal
   yarn install --immutable --immutable-cache --check-cache
   ```

:::

:::tip[TIP]
Zero Installs pair extremely well with git's `sparse-checkout`: CI jobs that only need `apps/api` can clone just that subtree plus `.yarn/cache/` and skip the rest. `yarn install` stays a no-op.
:::
