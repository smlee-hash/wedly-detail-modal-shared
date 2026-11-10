import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import wedly from '@wedly/eslint-plugin';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' } },
  // 공용 린트 꾸러미(@wedly/eslint-plugin) 규칙 넷 + no-console — 모든 앱·공용 꾸러미 같은 묶음. 연결 확인은 src/lint-shared-probe.test.ts.
  ...wedly.preset({ code: ['src/**/*.{ts,tsx,js,jsx,mjs,cjs}'], typescript: ['src/**/*.{ts,tsx}'] }),
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
);
