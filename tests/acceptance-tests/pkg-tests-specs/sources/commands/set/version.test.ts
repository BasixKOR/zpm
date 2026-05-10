import {xfs, ppath, PortablePath, Filename} from '@yarnpkg/fslib';

describe(`Commands`, () => {
  describe(`set version`, () => {
    test(
      `it should set the packageManager field to the requested semver version`,
      makeTemporaryEnv({}, async ({path, run, source}) => {
        await run(`set`, `version`, `3.0.0`);
        await check(path, {corepackVersion: `3.0.0`});
      }),
    );
  });
});

async function check(path: PortablePath, checks: {corepackVersion: string | RegExp}) {
  const manifestPath = ppath.join(path, Filename.manifest);

  await expect(xfs.readJsonPromise(manifestPath)).resolves.toMatchObject({
    packageManager: checks.corepackVersion instanceof RegExp
      ? expect.stringMatching(`yarn@${checks.corepackVersion.source}`)
      : `yarn@${checks.corepackVersion}`,
  });
}
