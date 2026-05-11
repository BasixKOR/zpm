# Review List

Items to discuss with the maintainer about how to proceed.

## `YARN_CACHE_FOLDER` should override the cache path

`commands/add.test.ts: "it should not clean the cache when cache lives
outside the project"` (and likely similar tests) set
`YARN_CACHE_FOLDER` and expect package zips to live there. zpm currently
splits the cache into:

- `global_folder/cache` (`enableGlobalCache=true`, the default)
- `cache_folder` (`enableGlobalCache=false`)

`YARN_CACHE_FOLDER` maps to the `cacheFolder` setting, which is only
used as the local cache - so the env var has no effect when the
default global cache is enabled.

Berry has a single `cacheFolder` (no global/local split), so the env
var simply works. Should we collapse the two caches, or have an
explicit `cacheFolder` override take precedence over
`enableGlobalCache`?
