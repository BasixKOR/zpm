import {Filename, ppath, xfs} from '@yarnpkg/fslib';

describe(`Commands`, () => {
  describe(`constraints --fix`, () => {
    it(`shouldn't crash due to an unending fix loop`, makeTemporaryEnv({
      foo: ``,
    }, async ({path, run, source}) => {
      await run(`install`);

      await xfs.writeFilePromise(ppath.join(path, `yarn.config.cjs`), `
        exports.constraints = ({Yarn}) => {
          for (const w of Yarn.workspaces()) {
            w.set(['foo'], \`\${w.manifest.foo}x\`);
          }
        };
      `);

      await run(`constraints`, `--fix`, {
        execArgv: [
          `--require`, require.resolve(`@yarnpkg/monorepo/.pnp.cjs`),
          `--require`, require.resolve(`@yarnpkg/monorepo/scripts/setup-ts-execution`),
          `--require`, require.resolve(`@yarnpkg/monorepo/scripts/detect-unsafe-writes.ts`),
        ],
      });

      await expect(xfs.readJsonPromise(ppath.join(path, Filename.manifest))).resolves.toMatchObject({
        foo: `xxxxxxxxxx`,
      });
    }));
  });
});
