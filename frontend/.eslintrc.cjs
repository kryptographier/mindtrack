module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  plugins: ["@typescript-eslint", "react", "react-refresh"],
  ignorePatterns: ["dist", "node_modules", ".tsbuild-node", "*.tsbuildinfo"],
  rules: {
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    // dangerouslySetInnerHTML is banned app-wide per SECURITY.md —
    // diary and chat content are untrusted input, and this rule is
    // the automated guardrail so it can't be reintroduced silently.
    "react/no-danger": "error",
  },
  overrides: [
    {
      // Node-executed config files (not shipped to the browser)
      // legitimately reference `process` and use CommonJS.
      files: ["vite.config.ts", "tailwind.config.js", "postcss.config.js", ".eslintrc.cjs"],
      env: { node: true },
    },
  ],
};
