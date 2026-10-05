import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import i18next from 'eslint-plugin-i18next';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/coverage/**',
      'playwright-report/**',
      'test-results/**',
      'resources/**',
      'data/**',
      '.e2e-data/**',
      'graphify-out/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Design-system guard (docs/design-system.md): feature code composes components from
    // src/components/ui (shadcn) and src/components/app, and uses token colour classes only.
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['apps/web/src/components/ui/**', 'apps/web/src/components/app/**', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name=/^(button|dialog|select)$/]',
          message: 'Use Button / Dialog / Select from @/components/ui instead of raw elements.',
        },
        {
          selector:
            'Literal[value=/(^|\\s|:)(bg|text|border|ring|fill|stroke|from|to)-(emerald|neutral|slate|gray|zinc|stone|amber|red|green|sky|teal|blue|yellow|orange)-\\d/]',
          message:
            'Use design tokens (bg-primary, text-muted-foreground, ...) instead of Tailwind palette colours.',
        },
      ],
    },
  },
  {
    // i18n guard (docs/i18n.md): user-facing text goes through t(); add keys to every locale.
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['apps/web/src/components/ui/**', '**/*.test.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': {
            include: ['aria-label', 'aria-description', 'placeholder', 'title', 'alt', 'label'],
          },
          words: { exclude: ['[0-9!-/:-@[-`{-~]+', /^[^\p{L}]+$/u] },
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**', 'e2e/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
