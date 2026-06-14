import tseslint from 'typescript-eslint';
import nounsanitized from 'eslint-plugin-no-unsanitized';

// Minimal, security-focused lint for the extension source. tsc (strict) already covers types and
// style; this layer exists to make the two properties the store/security model depend on
// un-regressable: NO code-from-strings (eval/Function) and NO unsanitized DOM sinks (innerHTML etc.).
// Scoped to src/**/*.ts so dev tooling in scripts/*.mjs (node globals) isn't dragged in.
export default tseslint.config({
  files: ['src/**/*.ts'],
  languageOptions: { parser: tseslint.parser },
  plugins: { 'no-unsanitized': nounsanitized },
  rules: {
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-unsanitized/property': 'error',
    'no-unsanitized/method': 'error',
  },
});
