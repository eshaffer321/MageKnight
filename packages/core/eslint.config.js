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
        // Prefer exported command type constants over string-literal command types.
        // This targets command object literals returned from command factories.
        {
          selector:
            'ReturnStatement > ObjectExpression > Property[key.name="type"][value.type="Literal"][value.value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal command types (e.g. `"REVEAL_TILE"`). Import a constant from `packages/core/src/engine/commands/commandTypes.ts`.',
        },
        {
          selector:
            'ReturnStatement > ObjectExpression > Property[key.name="type"][value.type="TSAsExpression"][value.expression.type="Literal"][value.expression.value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal command types (even with `as const`). Import a constant from `packages/core/src/engine/commands/commandTypes.ts`.',
        },
        // And catch command-type strings used for undo checkpoint mapping.
        {
          selector:
            'FunctionDeclaration[id.name="getCheckpointReason"] SwitchCase[test.type="Literal"][test.value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal command types in checkpoint mapping. Use constants from `packages/core/src/engine/commands/commandTypes.ts`.',
        },
        // Prefer centralized validation code constants over string literals.
        {
          selector:
            'CallExpression[callee.name="invalid"] > Literal:first-child[value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal validation codes in `invalid(...)`. Import a constant from `packages/core/src/engine/validators/validationCodes.ts`.',
        },
        {
          selector:
            'CallExpression[callee.name="invalid"] > TSAsExpression:first-child > Literal[value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal validation codes (even with `as const`) in `invalid(...)`. Import a constant from `packages/core/src/engine/validators/validationCodes.ts`.',
        },
      ],
    },
  },
  // Red/green refactor guardrails for modifiers:
  // start by enforcing in `modifiers.ts`, then we can broaden later.
  {
    files: ["src/engine/modifiers.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        // (Keep existing restrictions for this file, plus the new ones below)
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
        {
          selector:
            'ReturnStatement > ObjectExpression > Property[key.name="type"][value.type="Literal"][value.value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal command types (e.g. `"REVEAL_TILE"`). Import a constant from `packages/core/src/engine/commands/commandTypes.ts`.',
        },
        {
          selector:
            'ReturnStatement > ObjectExpression > Property[key.name="type"][value.type="TSAsExpression"][value.expression.type="Literal"][value.expression.value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal command types (even with `as const`). Import a constant from `packages/core/src/engine/commands/commandTypes.ts`.',
        },
        {
          selector:
            'FunctionDeclaration[id.name="getCheckpointReason"] SwitchCase[test.type="Literal"][test.value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal command types in checkpoint mapping. Use constants from `packages/core/src/engine/commands/commandTypes.ts`.',
        },
        {
          selector:
            'CallExpression[callee.name="invalid"] > Literal:first-child[value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal validation codes in `invalid(...)`. Import a constant from `packages/core/src/engine/validators/validationCodes.ts`.',
        },
        {
          selector:
            'CallExpression[callee.name="invalid"] > TSAsExpression:first-child > Literal[value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not use string-literal validation codes (even with `as const`) in `invalid(...)`. Import a constant from `packages/core/src/engine/validators/validationCodes.ts`.',
        },

        // === New: no magic modifier discriminator strings in modifiers.ts ===
        // effect.type / scope.type / duration / trigger.type comparisons
        {
          selector:
            'BinaryExpression[operator=/^(===|!==)$/][left.type="MemberExpression"][left.property.name="type"][right.type="Literal"][right.value=/^[a-z][a-z0-9_]*$/]',
          message:
            'Do not compare discriminator `.type` against a string literal in `modifiers.ts`. Use exported constants (we will add them) instead.',
        },
        {
          selector:
            'BinaryExpression[operator=/^(===|!==)$/][left.type="Literal"][left.value=/^[a-z][a-z0-9_]*$/][right.type="MemberExpression"][right.property.name="type"]',
          message:
            'Do not compare discriminator `.type` against a string literal in `modifiers.ts`. Use exported constants (we will add them) instead.',
        },
        {
          selector:
            'SwitchCase[test.type="Literal"][test.value=/^[a-z][a-z0-9_]*$/]',
          message:
            'Do not use string-literal switch cases for modifier/trigger discriminator types in `modifiers.ts`. Use exported constants (we will add them) instead.',
        },
        // Specific modifier fields we commonly compare
        {
          selector:
            'BinaryExpression[operator=/^(===|!==)$/][left.type="MemberExpression"][left.property.name=/^(rule|condition|stat|duration)$/][right.type="Literal"][right.value=/^[a-z][a-z0-9_]*$/]',
          message:
            'Do not compare modifier fields (rule/condition/stat/duration) against string literals in `modifiers.ts`. Use exported constants (we will add them) instead.',
        },
        {
          selector:
            'BinaryExpression[operator=/^(===|!==)$/][left.type="Literal"][left.value=/^[a-z][a-z0-9_]*$/][right.type="MemberExpression"][right.property.name=/^(rule|condition|stat|duration)$/]',
          message:
            'Do not compare modifier fields (rule/condition/stat/duration) against string literals in `modifiers.ts`. Use exported constants (we will add them) instead.',
        },
        // Type-level magic strings in ExpirationTrigger
        {
          selector:
            'TSTypeAliasDeclaration[id.name="ExpirationTrigger"] TSLiteralType > Literal[value=/^[a-z][a-z0-9_]*$/]',
          message:
            'Do not use string-literal trigger types in `ExpirationTrigger`. Use `typeof EXPIRATION_*` constants.',
        },
      ],
    },
  },
  // Red/green guardrails for modifier system types:
  // enforce centrally in the type definitions file first, then refactor to constants.
  {
    files: ["src/types/modifiers.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSPropertySignature[key.name="type"] TSLiteralType > Literal[value=/^[a-z][a-z0-9_]*$/]',
          message:
            'Do not use string-literal discriminator `type` values in modifier system types. Use exported constants and `typeof SOME_CONST`.',
        },
        {
          selector:
            'TSPropertySignature[key.name=/^(duration|rule|condition|stat|valueType|element)$/] TSLiteralType > Literal[value=/^[a-z][a-z0-9_]*$/]',
          message:
            'Do not use string-literal union values for modifier fields (duration/rule/condition/stat/valueType/element). Use exported constants and `typeof SOME_CONST`.',
        },
        {
          selector:
            'TSTypeAliasDeclaration[id.name=/^(ModifierDuration|ModifierScope|ModifierSource)$/] TSLiteralType > Literal[value=/^[a-z][a-z0-9_]*$/]',
          message:
            'Do not use string-literal unions for modifier core types. Use exported constants and `typeof SOME_CONST`.',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate magic PlayerAction discriminators in engine orchestration.
  // We exclude tests so fixtures can stay concise.
  {
    files: ["src/engine/**/*.ts"],
    ignores: ["src/engine/__tests__/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'BinaryExpression[operator=/^(===|!==)$/][left.type="MemberExpression"][left.property.name="type"][right.type="Literal"][right.value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not compare `action.type` to a string literal. Import the action constant from `@mage-knight/shared` (e.g. `UNDO_ACTION`, `MOVE_ACTION`).',
        },
        {
          selector:
            'BinaryExpression[operator=/^(===|!==)$/][right.type="MemberExpression"][right.property.name="type"][left.type="Literal"][left.value=/^[A-Z][A-Z0-9_]*$/]',
          message:
            'Do not compare `action.type` to a string literal. Import the action constant from `@mage-knight/shared` (e.g. `UNDO_ACTION`, `MOVE_ACTION`).',
        },
        {
          selector:
            'BinaryExpression[operator=/^(===|!==)$/][left.type="MemberExpression"][left.property.name="type"][right.type="Identifier"][right.name=/.*_COMMAND$/]',
          message:
            'Do not compare `action.type` to command-type constants. Use action constants from `@mage-knight/shared` (e.g. `MOVE_ACTION`).',
        },
        {
          selector:
            'BinaryExpression[operator=/^(===|!==)$/][right.type="MemberExpression"][right.property.name="type"][left.type="Identifier"][left.name=/.*_COMMAND$/]',
          message:
            'Do not compare `action.type` to command-type constants. Use action constants from `@mage-knight/shared` (e.g. `MOVE_ACTION`).',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate magic string unions in enemy type definitions.
  {
    files: ["src/types/enemy.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSLiteralType > Literal[value=/^[a-z][a-z0-9_]*$/]',
          message:
            'Do not use string-literal unions in `types/enemy.ts`. Export constants (e.g. `ATTACK_PHYSICAL = "physical" as const`) and use `typeof`.',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate magic tile type strings in tile definitions.
  {
    files: ["src/data/tiles.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSTypeAliasDeclaration[id.name="TileType"] TSLiteralType > Literal[value=/^(starting|countryside|core)$/]',
          message:
            'Do not use string-literal unions for `TileType`. Use exported constants (e.g. `TILE_TYPE_STARTING`) and `typeof`.',
        },
        {
          selector:
            'Property[key.name="type"][value.type="Literal"][value.value=/^(starting|countryside|core)$/]',
          message:
            'Do not use string-literal tile types in `TILE_DEFINITIONS`. Use exported constants (e.g. `TILE_TYPE_STARTING`).',
        },
        {
          selector:
            'Literal[value=/^(plains|hills|forest|wasteland|desert|swamp|lake|mountain|ocean)$/]',
          message:
            'Do not use string-literal terrain values in `tiles.ts`. Import `TERRAIN_*` constants from `@mage-knight/shared`.',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate duplicated mana color unions in core.
  // Special mana colors should come from `@mage-knight/shared` (ids.ts).
  {
    files: ["src/types/mana.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSTypeAliasDeclaration[id.name="SpecialManaColor"] TSUnionType > TSLiteralType > Literal[value=/^(gold|black)$/]',
          message:
            'Do not define `SpecialManaColor` as string-literal union in core. Use `@mage-knight/shared` (`packages/shared/src/ids.ts`) as the single source of truth.',
        },
      ],
    },
  },
  // Red/green guardrail: core GameState phase/timeOfDay should use shared state types.
  {
    files: ["src/state/GameState.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSTypeAliasDeclaration[id.name=/^(GamePhase|TimeOfDay)$/] TSUnionType > TSLiteralType > Literal[value=/^[a-z]+$/]',
          message:
            'Do not define GamePhase/TimeOfDay as string-literal unions in core state. Import `GamePhase`/`TimeOfDay` from `@mage-knight/shared`.',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate magic string unions for card subtypes.
  {
    files: ["src/types/cards.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSTypeAliasDeclaration[id.name=/^(RecruitmentSite|UnitTier)$/] TSUnionType > TSLiteralType > Literal[value=/^[a-z_]+$/]',
          message:
            'Do not define RecruitmentSite/UnitTier as string-literal unions. Export constants and use `typeof`.',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate magic string unions for ManaToken.source.
  {
    files: ["src/types/player.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSPropertySignature[key.name="source"] TSUnionType > TSLiteralType > Literal[value=/^(die|card|skill|site)$/]',
          message:
            'Do not define ManaToken.source as a string-literal union. Use `ManaTokenSource` from `@mage-knight/shared`.',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate magic string unions for undo checkpoint reasons.
  {
    files: ["src/engine/commands.ts", "src/engine/commandStack.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSPropertySignature[key.name="reason"] TSUnionType > TSLiteralType > Literal[value=/^(tile_revealed|enemy_drawn|card_drawn|die_rolled|player_reacted)$/]',
          message:
            'Do not use string-literal unions for undo checkpoint reasons. Use exported `CHECKPOINT_REASON_*` constants from `src/engine/commands.ts` and `typeof`.',
        },
        {
          selector:
            'ReturnStatement > Literal[value=/^(tile_revealed|enemy_drawn|card_drawn|die_rolled|player_reacted)$/]',
          message:
            'Do not return string-literal checkpoint reasons. Use `CHECKPOINT_REASON_*` constants from `src/engine/commands.ts`.',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate magic string unions for DeedCardType.
  {
    files: ["src/types/cards.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSTypeAliasDeclaration[id.name="DeedCardType"] TSUnionType > TSLiteralType > Literal[value=/^(basic_action|advanced_action|spell|artifact|wound)$/]',
          message:
            'Do not define DeedCardType as a string-literal union. Export constants and use `typeof`.',
        },
      ],
    },
  },
  // Red/green guardrail: eliminate magic city/mine color unions in core map types.
  {
    files: ["src/types/map.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSTypeAliasDeclaration[id.name=/^(CityColor|MineColor)$/] TSUnionType > TSLiteralType > Literal[value=/^(red|blue|green|white)$/]',
          message:
            'Do not use string-literal unions for CityColor/MineColor. Use constants from `src/types/mapConstants.ts` and `typeof`.',
        },
      ],
    },
  },
  {
    ignores: ["dist/**", "*.config.*"],
  }
);
