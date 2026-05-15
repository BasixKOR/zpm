describe(`Commands`, () => {
  describe(`explain peer-requirements`, () => {
    test(
      `it should list every peer requirement with a status mark`,
      makeTemporaryEnv(
        {
          dependencies: {
            [`mismatched-peer-deps-lvl1`]: `1.0.0`,
            [`no-deps`]: `1.1.0`,
          },
        },
        async ({path, run}) => {
          await run(`install`);

          const {stdout} = await run(`explain`, `peer-requirements`);

          // Failed requirement → cross mark + the workspace as
          // subject + the peer ident + the requester chain.
          expect(stdout).toMatch(/p[a-f0-9]{6} → ✘ .* provides no-deps .* to mismatched-peer-deps-lvl1/);
          // "and 1 other dependency" rolls up the transitive
          // requester (mismatched-peer-deps-lvl2) when the
          // requirement has two requesters in total.
          expect(stdout).toContain(`and 1 other dependency`);
        },
      ),
    );

    test(
      `it should print the request tree and combined range for a specific hash`,
      makeTemporaryEnv(
        {
          dependencies: {
            [`mismatched-peer-deps-lvl0`]: `1.0.0`,
            [`no-deps`]: `1.1.0`,
          },
        },
        async ({path, run}) => {
          const {stdout: installOut} = await run(`install`);
          const match = installOut.match(/\((p[a-f0-9]{6})\)/);
          if (!match)
            throw new Error(`Expected a peer-requirement hash in install output: ${installOut}`);

          const {stdout} = await run(`explain`, `peer-requirements`, match[1]);

          // Header line.
          expect(stdout).toContain(`is requested to provide no-deps by its descendants`);
          // The transitive request chain should appear in the tree.
          expect(stdout).toContain(`mismatched-peer-deps-lvl0`);
          expect(stdout).toContain(`mismatched-peer-deps-lvl1`);
          expect(stdout).toContain(`mismatched-peer-deps-lvl2`);
          // Combined-range hint that mirrors berry's `The combined
          // requested range is …`.
          expect(stdout).toMatch(/The combined requested range is 1\.0\.0/);
          // Conclusion line marks the requirement as unsatisfied.
          expect(stdout).toMatch(/✘ Package .* provides no-deps with version 1\.1\.0, which does not satisfy all requests/);
        },
      ),
    );

    test(
      `it should reject an unknown hash`,
      makeTemporaryEnv({}, async ({path, run}) => {
        await run(`install`);
        await expect(run(`explain`, `peer-requirements`, `pdeadbe`)).rejects.toThrow(
          /No peer dependency requirements found for hash/,
        );
      }),
    );
  });
});
