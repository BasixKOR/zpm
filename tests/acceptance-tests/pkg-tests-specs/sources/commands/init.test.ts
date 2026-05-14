import {Filename, ppath, xfs} from '@yarnpkg/fslib';

describe(`Commands`, () => {
  describe(`init`, () => {
    test(
      `it should create a new package.json in the local directory if it doesn't exist`,
      makeTemporaryEnv({}, async ({path, run, source}) => {
        await xfs.mktempPromise(async tmpDir => {
          const pkgDir = ppath.join(tmpDir, `my-package`);
          await xfs.mkdirpPromise(pkgDir);

          await run(`init`, {
            cwd: pkgDir,
          });

          await expect(xfs.readJsonPromise(ppath.join(pkgDir, Filename.manifest))).resolves.toMatchObject({
            name: `my-package`,
          });
        });
      }),
    );

    test(
      `it should create a new package.json in the specified directory if it doesn't exist`,
      makeTemporaryEnv({}, async ({path, run, source}) => {
        await xfs.mktempPromise(async tmpDir => {
          const pkgDir = ppath.join(tmpDir, `my-package`);
          await xfs.mkdirpPromise(pkgDir);

          await run(`./my-package`, `init`, {
            cwd: tmpDir,
          });

          await expect(xfs.readJsonPromise(ppath.join(pkgDir, Filename.manifest))).resolves.toMatchObject({
            name: `my-package`,
          });
        });
      }),
    );

    test(
      `it should create a new package.json in the specified directory even if said directory doesn't exist`,
      makeTemporaryEnv({}, async ({path, run, source}) => {
        await xfs.mktempPromise(async tmpDir => {
          const pkgDir = ppath.join(tmpDir, `my-package`);

          await run(`./my-package`, `init`, {
            cwd: tmpDir,
          });

          await expect(xfs.readJsonPromise(ppath.join(pkgDir, Filename.manifest))).resolves.toMatchObject({
            name: `my-package`,
          });
        });
      }),
    );
  });
});
