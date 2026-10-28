import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    '.source/**',
  ]),
  /**
   * The shell architecture (see `src/shell/**`'s own doc comments) exists
   * so this app can present itself as a desktop-shell-style renderer that
   * has never heard of the simulation engine underneath it -- `src/shell/
   * main/**` is a Web Worker and the only place that may import
   * `@exoproc/simulate*` or any `node:*` built-in. Every other directory
   * reaches the engine exclusively through `window.exoproc.*`
   * (`src/shell/{common,preload,renderer}/**`, `src/base/**`,
   * `src/platform/**`, `src/workbench/**`, `src/components/**`,
   * `src/app/**`). This turns that boundary into a lint error instead of
   * a convention nobody enforces -- see the "deliberate violation" check
   * in the F8 verification notes for proof it actually fires.
   */
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/shell/main/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'win32-simulate',
                'win32-simulate/*',
                'simulate',
                'simulate/*',
                '@exoproc/simulate',
                '@exoproc/simulate/*',
              ],
              message:
                'Only src/shell/main/** may import the simulation engine directly. Reach it through window.exoproc.* (see src/shell/preload/api.ts) instead.',
            },
            {
              group: ['node:*'],
              message:
                'Only src/shell/main/** may import Node built-ins. This code runs in the browser renderer, which has no Node runtime.',
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
