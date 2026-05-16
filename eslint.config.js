import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [
  { ignores: ['dist', 'src/components/ui/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // TypeScript handles undefined checks; no-undef causes false positives with JSX transform
      'no-undef': 'off',
      // Allow ternary expressions used as statements (common React pattern)
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
      // Allow empty catch blocks (intentional fire-and-forget error suppression)
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
]
