// ESLint flat config (ESLint 10). Same rules as the old .eslintrc.cjs:
// eslint recommended + typescript-eslint recommended + the two classic
// React hooks rules + react-refresh's export check.
//
// eslint-plugin-react-hooks 7's own "recommended" preset also turns on the
// React Compiler rules; they're left off here on purpose, so this upgrade
// changes the tooling, not what the code is held to.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
)
