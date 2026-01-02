import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      // Prefer exported event constants/creators over string-literal event types.
      // This is intentionally scoped to `events: [{ type: ... }]` payloads to avoid
      // flagging unrelated discriminated unions elsewhere.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'Property[key.name="events"] > ArrayExpression > ObjectExpression > Property[key.name="type"][value.type="Literal"][value.value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal event types in `events` payloads. Import an exported constant (e.g. `TILE_REVEALED`) or use a `create*Event(...)` helper from `@mage-knight/shared`.',
        },
        {
          selector:
            'Property[key.name="events"] > ArrayExpression > ObjectExpression > Property[key.name="type"][value.type="TSAsExpression"][value.expression.type="Literal"][value.expression.value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal event types (even with `as const`) in `events` payloads. Import an exported constant (e.g. `TILE_REVEALED`) or use a `create*Event(...)` helper from `@mage-knight/shared`.',
        },
      ],
    },
  },
  {
    ignores: ["dist/**", "*.config.*"],
  }
);
