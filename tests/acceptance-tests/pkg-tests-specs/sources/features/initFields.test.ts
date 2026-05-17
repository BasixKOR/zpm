import {PortablePath, xfs} from '@yarnpkg/fslib';
import {yarn}              from 'pkg-tests-core';

describe(`Features`, () => {
  describe(`initFields`, () => {
    test(
      `it should add string fields to the generated manifest`,
      makeTemporaryEnv(
        {},
        async ({path, run, source}) => {
          const tmp = await xfs.mktempPromise();

          await yarn.writeConfiguration(tmp, {
            initFields: {
              homepage: `https://yarnpkg.com`,
            },
          });

          await xfs.mkdirpPromise(`${tmp}/my-package` as PortablePath);

          await run(`init`, {
            cwd: `${tmp}/my-package` as PortablePath,
          });

          await expect(xfs.readJsonPromise(`${tmp}/my-package/package.json` as PortablePath)).resolves.toMatchObject({
            name: `my-package`,
            homepage: `https://yarnpkg.com`,
          });
        },
      ),
    );

    test(
      `it should add array fields to the generated manifest`,
      makeTemporaryEnv(
        {},
        async ({path, run, source}) => {
          const tmp = await xfs.mktempPromise();

          await yarn.writeConfiguration(tmp, {
            initFields: {
              files: [
                `/lib/**/*`,
                `/bin/**/*`,
              ],
            },
          });

          await xfs.mkdirpPromise(`${tmp}/my-package` as PortablePath);

          await run(`init`, {
            cwd: `${tmp}/my-package` as PortablePath,
          });

          await expect(xfs.readJsonPromise(`${tmp}/my-package/package.json` as PortablePath)).resolves.toMatchObject({
            name: `my-package`,
            files: [
              `/lib/**/*`,
              `/bin/**/*`,
            ],
          });
        },
      ),
    );

    // These ones were broken before https://github.com/yarnpkg/berry/issues/2230 got fixed

    test(
      `it should add the version field to the generated manifest`,
      makeTemporaryEnv(
        {},
        async ({path, run, source}) => {
          const tmp = await xfs.mktempPromise();

          await yarn.writeConfiguration(tmp, {
            initFields: {
              version: `1.2.3`,
            },
          });

          await xfs.mkdirpPromise(`${tmp}/my-package` as PortablePath);

          await run(`init`, {
            cwd: `${tmp}/my-package` as PortablePath,
          });

          await expect(xfs.readJsonPromise(`${tmp}/my-package/package.json` as PortablePath)).resolves.toMatchObject({
            name: `my-package`,
            version: `1.2.3`,
          });
        },
      ),
    );

    test(
      `it should cascade initFields across rc files (user-rc + project-rc)`,
      makeTemporaryEnv(
        {},
        async ({path, run, source}) => {
          // Two rc files: an outer one supplies `homepage`, an inner
          // one supplies `license`. The inner one should NOT mask the
          // outer one — both fields must end up on the manifest.
          const outer = await xfs.mktempPromise();
          await yarn.writeConfiguration(outer, {
            initFields: {
              homepage: `https://yarnpkg.com`,
            },
          });

          const inner = `${outer}/inner` as PortablePath;
          await xfs.mkdirpPromise(inner);
          await yarn.writeConfiguration(inner, {
            initFields: {
              license: `MIT`,
            },
          });

          const cwd = `${inner}/my-package` as PortablePath;
          await xfs.mkdirpPromise(cwd);

          await run(`init`, {cwd});

          await expect(xfs.readJsonPromise(`${cwd}/package.json` as PortablePath)).resolves.toMatchObject({
            name: `my-package`,
            homepage: `https://yarnpkg.com`,
            license: `MIT`,
          });
        },
      ),
    );

    test(
      `it should let inner rc override outer rc on conflicting fields`,
      makeTemporaryEnv(
        {},
        async ({path, run, source}) => {
          const outer = await xfs.mktempPromise();
          await yarn.writeConfiguration(outer, {
            initFields: {
              license: `Apache-2.0`,
            },
          });

          const inner = `${outer}/inner` as PortablePath;
          await xfs.mkdirpPromise(inner);
          await yarn.writeConfiguration(inner, {
            initFields: {
              license: `MIT`,
            },
          });

          const cwd = `${inner}/my-package` as PortablePath;
          await xfs.mkdirpPromise(cwd);

          await run(`init`, {cwd});

          await expect(xfs.readJsonPromise(`${cwd}/package.json` as PortablePath)).resolves.toMatchObject({
            name: `my-package`,
            license: `MIT`,
          });
        },
      ),
    );

    test(
      `it should add the license field to the generated manifest`,
      makeTemporaryEnv(
        {},
        async ({path, run, source}) => {
          const tmp = await xfs.mktempPromise();

          await yarn.writeConfiguration(tmp, {
            initFields: {
              license: `MIT`,
            },
          });

          await xfs.mkdirpPromise(`${tmp}/my-package` as PortablePath);

          await run(`init`, {
            cwd: `${tmp}/my-package` as PortablePath,
          });

          await expect(xfs.readJsonPromise(`${tmp}/my-package/package.json` as PortablePath)).resolves.toMatchObject({
            name: `my-package`,
            license: `MIT`,
          });
        },
      ),
    );
  });
});
