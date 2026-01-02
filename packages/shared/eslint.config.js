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
  // Red/green guardrail: eliminate magic event `type` strings at the type-definition level.
  // Scope this to `events.ts` first to keep the rollout safe.
  {
    files: ["src/events.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSPropertySignature[key.name="type"] TSLiteralType > Literal[value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal event types in event interfaces. Export a `const` (e.g. `GAME_STARTED = "GAME_STARTED" as const`) and use `typeof GAME_STARTED`.',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate magic action `type` strings at the type-definition level.
  // Scope this to `actions.ts` first to keep the rollout safe.
  {
    files: ["src/actions.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSPropertySignature[key.name="type"] TSLiteralType > Literal[value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal action types in action interfaces. Export a `const` (e.g. `MOVE_ACTION = "MOVE" as const`) and use `typeof MOVE_ACTION`.',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate magic string unions in shared "sub-union" fields.
  {
    files: ["src/actions.ts", "src/events.ts", "src/types/clientState.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSPropertySignature[key.name=/^(manaSource|as|offerType|source|reason)$/] TSUnionType > TSLiteralType > Literal[value=/^[a-z][a-zA-Z0-9_]*$/]',
          message:
            'Do not use string-literal unions for shared value fields (sub-unions). Export constants (see `src/valueConstants.ts`) and use `typeof CONST`.',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate client-state phase/timeOfDay unions (core state concepts).
  {
    files: ["src/types/clientState.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSPropertySignature[key.name=/^(phase|timeOfDay)$/] TSUnionType > TSLiteralType > Literal[value=/^[a-z]+$/]',
          message:
            'Do not define `phase`/`timeOfDay` as string-literal unions in client state. Use `GamePhase` / `TimeOfDay` from `src/stateConstants.ts`.',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate `"hero"` literal in wound target union (events.ts).
  {
    files: ["src/events.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSPropertySignature[key.name="target"] TSUnionType > TSLiteralType > Literal[value="hero"]',
          message:
            'Do not use `"hero"` as a string literal in wound target unions. Use `WOUND_TARGET_HERO` from `src/valueConstants.ts` and `typeof`.',
        },
      ],
    },
  },
  {
    ignores: ["dist/**", "*.config.*"],
  }
);
