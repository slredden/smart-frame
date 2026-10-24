import js from '@eslint/js';
import compat from 'eslint-plugin-compat';
import globals from 'globals';

export default [
  { ignores: ['**/dist/**', 'node_modules/**', '**/.wrangler/**', 'test/e2e/out/**', 'test/e2e/.browsers/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['frame/src/**/*.js', 'frame/admin/**/*.js', 'shared/**/*.js'],
    plugins: { compat },
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: Object.assign({}, globals.browser, { __BUILD_ID__: 'readonly' }) },
    settings: { browsers: ['chrome >= 106'] },
    rules: { 'compat/compat': 'error' },
  },
  {
    files: ['worker/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.serviceworker },
  },
  {
    files: ['tools/**/*.mjs', 'test/**/*.js', 'test/**/*.mjs', '*.config.js', 'frame/vite.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: Object.assign({}, globals.node, globals.browser) },
  },
];
