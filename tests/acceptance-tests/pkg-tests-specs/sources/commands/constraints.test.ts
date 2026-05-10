import {npath, ppath} from '@yarnpkg/fslib';

import {environments} from './constraints/environments';


const {
  fs: {writeFile},
} = require(`pkg-tests-core`);

const constraints: Record<string, string> = {
  [`empty constraints`]: ``,
  [`gen_enforced_dependency (missing)`]: `exports.constraints = ({Yarn}) => { for (const w of Yarn.workspaces()) w.set(['peerDependencies', 'one-fixed-dep'], '1.0.0'); };`,
  [`gen_enforced_dependency (incompatible)`]: `exports.constraints = ({Yarn}) => { for (const w of Yarn.workspaces()) w.set(['dependencies', 'no-deps'], '2.0.0'); };`,
  [`gen_enforced_dependency (extraneous)`]: `exports.constraints = ({Yarn}) => { for (const w of Yarn.workspaces()) w.set(['dependencies', 'no-deps'], undefined); };`,
  [`gen_enforced_dependency (extraneous2)`]: `
    exports.constraints = ({Yarn}) => {
      for (const d of Yarn.dependencies({ident: 'no-deps'})) d.delete();
      for (const d of Yarn.dependencies({ident: 'no-deps', range: '1.0.0'})) d.update('1.0.0');
    };
  `,
  [`gen_enforced_dependency (ambiguous)`]: `
    exports.constraints = ({Yarn}) => {
      for (const w of Yarn.workspaces()) w.set(['dependencies', 'no-deps'], '1.0.0');
      for (const w of Yarn.workspaces()) w.set(['dependencies', 'no-deps'], '2.0.0');
    };
  `,
  [`gen_enforced_field (missing)`]: `exports.constraints = ({Yarn}) => { for (const w of Yarn.workspaces()) w.set(['dependencies', 'a-new-deps'], '1.0.0'); };`,
  [`gen_enforced_field (incompatible)`]: `exports.constraints = ({Yarn}) => { for (const w of Yarn.workspaces()) w.set(['dependencies', 'no-deps'], '2.0.0'); };`,
  [`gen_enforced_field (extraneous)`]: `exports.constraints = ({Yarn}) => { for (const w of Yarn.workspaces()) w.unset(['dependencies']); };`,
  [`gen_enforced_field (ambiguous)`]: `
    exports.constraints = ({Yarn}) => {
      for (const w of Yarn.workspaces()) w.set(['dependencies', 'a-new-dep'], '1.0.0');
      for (const w of Yarn.workspaces()) w.set(['dependencies', 'a-new-dep'], '2.0.0');
    };
  `,
  [`workspace_field w/ string FieldValue`]: `exports.constraints = ({Yarn}) => { for (const w of Yarn.workspaces()) w.set('_name', w.manifest.name); };`,
  [`workspace_field w/ object FieldValue`]: `exports.constraints = ({Yarn}) => { for (const w of Yarn.workspaces()) w.set('_repository', w.manifest.repository); };`,
  [`workspace_field w/ array FieldValue`]: `exports.constraints = ({Yarn}) => { for (const w of Yarn.workspaces()) w.set('_files', w.manifest.files); };`,
};

describe(`Commands`, () => {
  describe(`constraints`, () => {
    it(`should report custom errors`, makeTemporaryEnv({}, async ({path, run, source}) => {
      await run(`install`);

      await writeFile(ppath.join(path, `yarn.config.cjs`), `
        exports.constraints = ({Yarn}) => {
          Yarn.workspace().error('This should fail');
        };
      `);

      await expect(run(`constraints`)).rejects.toThrow(/This should fail/);
    }));

    it(`should allow requiring dependencies from the yarn.config.cjs file`, makeTemporaryEnv({
      dependencies: {
        [`no-deps`]: `1.0.0`,
      },
    }, async ({path, run, source}) => {
      await run(`install`);

      await writeFile(ppath.join(path, `yarn.config.cjs`), `
        require('no-deps');

        exports.constraints = ({Yarn}) => {
        };
      `);

      await run(`constraints`);
    }));

    it(`shouldn't report errors when comparing identical objects`, makeTemporaryEnv({
      foo: {
        ok: true,
      },
    }, async ({path, run, source}) => {
      await run(`install`);

      await writeFile(ppath.join(path, `yarn.config.cjs`), `
        exports.constraints = ({Yarn}) => {
          Yarn.workspace().set('foo', {ok: true});
        };
      `);

      await run(`constraints`);
    }));

    it(`should report an error when comparing objects with different key ordering`, makeTemporaryEnv({
      foo: {
        b: true,
        a: true,
      },
    }, async ({path, run, source}) => {
      await run(`install`);

      await writeFile(ppath.join(path, `yarn.config.cjs`), `
        exports.constraints = ({Yarn}) => {
          Yarn.workspace().set('foo', {a: true, b: true});
        };
      `);

      await expect(run(`constraints`)).rejects.toThrow(`Invalid field foo; expected { "a": true, "b": true }, found { "b": true, "a": true }`);
    }));

    for (const [environmentDescription, environment] of Object.entries(environments)) {
      for (const [scriptDescription, script] of Object.entries(constraints)) {
        test(`test (${environmentDescription} / ${scriptDescription} / js)`,
          makeTemporaryEnv({}, async ({path, run, source}) => {
            await environment(path);
            await run(`install`);

            await writeFile(ppath.join(path, `yarn.config.cjs`), script);

            let code;
            let stdout;
            let stderr;

            try {
              ({code, stdout, stderr} = await run(`constraints`));
            } catch (error) {
              ({code, stdout, stderr} = error);
            }

            // TODO: Use .replaceAll when we drop support for Node.js v14
            stdout = stdout.split(npath.join(npath.fromPortablePath(path), `yarn.config.cjs`)).join(`/path/to/yarn.config.cjs`);
            stdout = stdout.replace(/(Module|Object)\.(exports\.)/g, `$2`);
            stdout = stdout.replace(/root-workspace-[a-f0-9]{6}@/g, `root-workspace@`);

            expect({code, stdout, stderr}).toMatchSnapshot();
          }),
        );
      }
    }
  });
});
