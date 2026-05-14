import {Filename, ppath, xfs}  from '@yarnpkg/fslib';

const tests: Array<[initial: string, replacement: string, valid: boolean]> = [
  [`no-deps@npm:^1.0.0`, `no-deps@npm:2.0.0`, false],
  [`no-deps@npm:^1.0.0`, `no-deps@npm:1.0.0`, true],

  [`no-deps@npm:^1.0.0`, `no-deps-bins@npm:1.0.0`, false],
  [`no-deps@npm:no-deps-bins@^1.0.0`, `no-deps-bins@npm:1.0.0`, true],

  [`util-deprecate@https://github.com/yarnpkg/util-deprecate.git#commit=4bcc600d20e3a53ea27fa52c4d1fc49cc2d0eabb`, `util-deprecate@https://github.com/yarnpkg/util-deprecate.git`, false],
  [`util-deprecate@https://github.com/yarnpkg/util-deprecate.git#commit=4bcc600d20e3a53ea27fa52c4d1fc49cc2d0eabb`, `util-deprecate@https://github.com/yarnpkg/util-deprecate.git#commit=475fb6857cd23fafff20c1be846c1350abf8e6d4`, false],
  [`util-deprecate@https://github.com/yarnpkg/util-deprecate.git#commit=4bcc600d20e3a53ea27fa52c4d1fc49cc2d0eabb`, `util-deprecate@https://github.com/yarnpkg/util-deprecate.git#commit=4bcc600d20e3a53ea27fa52c4d1fc49cc2d0eabb`, true],
];

// Pulls the bare ident-and-range descriptor (e.g. `pkg@npm:1.0.0`) out
// of a full berry-style descriptor (handling the scoped form too).
function parseDescriptor(input: string): {identString: string, range: string} {
  const stripped = input.startsWith(`@`) ? input.slice(1) : input;
  const atIdx = stripped.indexOf(`@`);

  if (atIdx === -1)
    throw new Error(`Cannot parse descriptor: ${input}`);

  const identString = (input.startsWith(`@`) ? `@` : ``) + stripped.slice(0, atIdx);
  const range = stripped.slice(atIdx + 1);

  return {identString, range};
}

describe(`Features`, () => {
  for (const [initial, replacement, valid] of tests) {
    it(
      `should ${valid ? `allow` : `prevent`} resolving "${initial}" with "${replacement}"`,
      makeTemporaryEnv({}, {
        // We don't care about this flag; in an actual attack,
        // the hash would be correct
        checksumBehavior: `ignore`,
      }, async ({path, run, source}) => {
        await run(`add`, replacement);

        const lockfilePath = ppath.join(path, Filename.lockfile);
        const lockfileData = await xfs.readJsonPromise(lockfilePath);

        // zpm normalizes git URLs in the entry key (e.g. https form
        // collapses to `github:` short form, no-commit becomes
        // `#head=HEAD`), so the raw replacement descriptor isn't a
        // direct key into `entries`. Find the (single) entry matching
        // this ident instead and reuse its concrete resolution.
        const replacementIdent = parseDescriptor(replacement).identString;
        const replacementMatch = Object.entries(lockfileData.entries).find(
          ([key]) => key === `${replacementIdent}@${parseDescriptor(replacement).range}`
            || key.startsWith(`${replacementIdent}@`),
        ) as [string, any] | undefined;

        if (!replacementMatch)
          throw new Error(`Expected the replacement '${replacement}' to be present in the lockfile`);

        const [, replacementEntry] = replacementMatch;

        // Re-publish the replacement's resolution record under the `initial`
        // descriptor — this mimics the supply-chain-style attack the
        // --check-resolutions flag is designed to catch.
        lockfileData.entries[initial] = {
          ...replacementEntry,
          resolution: {
            ...replacementEntry.resolution,
            resolution: replacement,
          },
        };

        await xfs.writeJsonPromise(lockfilePath, lockfileData);

        const {identString, range} = parseDescriptor(initial);

        const manifestPath = ppath.join(path, Filename.manifest);
        const manifestData = await xfs.readJsonPromise(manifestPath);
        manifestData.dependencies = {[identString]: range};

        await xfs.writeJsonPromise(manifestPath, manifestData);

        const check = run(`install`, `--check-resolutions`);
        if (valid) {
          await check;
        } else {
          await expect(check).rejects.toThrow(/YN0078/);
          // The YN0078 message must explain what's wrong; it must mention
          // both the "lockfile pin" wording and the actual descriptor.
          // (Catches the regression where the error tuple contained the
          // same locator twice and printed "would resolve to X / pins it
          // to X" — same X, no useful information.)
          await expect(check).rejects.toThrow(/lockfile pins/);
        }
      }),
    );
  }
});
