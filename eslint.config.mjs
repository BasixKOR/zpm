import reactEslintConfig from '@yarnpkg/eslint-config/react';
import eslintConfig      from '@yarnpkg/eslint-config';

// eslint-disable-next-line arca/no-default-export
export default [
  {
    ignores: [
      `.pnp.*`,
      `.yarn/**`,
      `**/*.rs`,
      `**/dist`,
      `tests/acceptance-tests/pkg-tests-fixtures`,
      `website/.astro`,
      `packages/zpm/src/constraints/constraints.tpl.js`,
      `**/generated/**`,
      `**/*.generated.ts`,
    ],
  },
  ...eslintConfig,
  ...reactEslintConfig,
  {
    files: [
      `website/**/*.tsx`,
    ],
    rules: {
      [`arca/no-default-export`]: `off`,
    },
  },
  {
    files: [`tests/acceptance-tests/pkg-tests-specs/**/*.test.{js,ts}`],
    languageOptions: {
      globals: {
        makeTemporaryEnv: `readonly`,
        makeTemporaryMonorepoEnv: `readonly`,
      },
    },
  },
];
