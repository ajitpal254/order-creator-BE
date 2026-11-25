// ESLint flat config (QOL-02) — real lint for the H.A. Overseas API.
//
// Uses the @eslint/js recommended rule set for all first-party JS
// (src/, tests/, and root config files). The codebase is ESM Node,
// so Node globals are provided via the `globals` package. Unlike the
// old placeholder script, `npm run lint` can (and should) fail:
// recommended rules are errors by default below.
//
// Tuning notes (narrow, config-only — no mass source edits):
//  - `no-unused-vars`: identifiers prefixed with `_` are treated as
//    intentionally unused, and `next` is allowed as an unused arg —
//    Express only recognises error-handling middleware by its
//    4-argument (err, req, res, next) signature, so `next` is often
//    required but unused. Caught-error bindings are not flagged:
//    several catch blocks deliberately swallow errors after logging
//    or handling them elsewhere.
//  - `ignoreRestSiblings` covers the canonical "omit these keys"
//    destructuring idiom (`const { a, b, ...rest } = obj`).
//  - The final block downgrades single rules to *warnings* for four
//    invoice-area files that are OFF LIMITS for the v0.2 release
//    (invoice logic/PDF/tests must not be edited). These are real,
//    pre-existing issues — they stay visible in lint output and
//    should be fixed in a dedicated invoice change:
//      * orderController.js — `ensureOrderInvoice` is declared
//        *inside* `updateOrderStatus`, so the top-level
//        `retryInvoiceSync` handler references it out of scope
//        (no-undef; that route would throw at runtime).
//      * pdfGenerator.js — unused `PAGE_HEIGHT` constant.
//      * taxCalculator.js — redundant initial `taxAmount = 0`
//        assignment (every branch reassigns it).
//      * invoiceIntegration.test.js — unused `cors` import.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'coverage/**', 'uploads/**', 'dist/**', 'build/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^(_|next$)',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Invoice-area files are off limits for v0.2 — see header notes.
  // Each override below downgrades exactly one rule in exactly one
  // file, so the pre-existing issue stays visible as a warning
  // instead of being silently ignored or "fixed" out of scope.
  {
    files: ['src/controllers/orderController.js'],
    rules: { 'no-undef': 'warn' },
  },
  {
    files: ['src/utils/pdfGenerator.js'],
    rules: { 'no-unused-vars': 'warn' },
  },
  {
    files: ['src/utils/taxCalculator.js'],
    rules: { 'no-useless-assignment': 'warn' },
  },
  {
    files: ['tests/invoiceIntegration.test.js'],
    rules: { 'no-unused-vars': 'warn' },
  },
];
