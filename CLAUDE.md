# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**PRs should always target the `main` branch.**

## Build & Test Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm lint             # Lint all packages

# Package-specific (run from package directory)
pnpm test:watch       # Watch mode for tests (core, shared)
pnpm build:esm        # Build ESM only
pnpm build:cjs        # Build CJS only
```

## Architecture

This is a pnpm monorepo implementing the Mage Knight board game with a client/server architecture.

### Package Dependency Graph

```
client → shared
server → core → shared
```

### Packages

- **@mage-knight/shared**: Types shared between client and server:
  - `PlayerAction` (discriminated union of player inputs)
  - `GameEvent` (discriminated union of engine outputs)
  - `ClientGameState` and related types (filtered state sent to clients)
  - `GameConnection` abstraction for local/networked play
  - Core types: `CardId`, `SkillId`, `ManaColor`, `HexCoord`, `Terrain`

- **@mage-knight/core**: Pure TypeScript game engine (server-side only, never imported by client):
  - `GameState` — full server-side state (players, map, combat, modifiers, etc.)
  - **Modifier System** — tracks active effects from skills/cards/units with duration and scope
  - **Command Pattern** — undo support for reversible actions (WIP)
  - Type domains: player, hero, enemy, map, mana, offers, cards, decks, city, modifiers
  - Data: tile definitions, site properties
  - Exports dual ESM/CJS builds

- **@mage-knight/server**: Connects the game engine to clients:
  - `GameServer` — multiplayer support with per-player state filtering
  - `toClientState()` — converts full GameState to filtered ClientGameState
  - `createGame()` / `createGameServer()` — factory functions

- **@mage-knight/client**: Web UI (scaffold only). Sends actions, receives events through GameConnection.

### Communication Pattern

Client ↔ Server communication uses a simple action/event model:
1. Client sends `PlayerAction` to server via `GameConnection.sendAction()`
2. Server's engine processes action, returns `GameEvent[]`
3. Server filters state per-player via `toClientState()` (hides other players' hands, deck contents, etc.)
4. Events + filtered state dispatched to clients via `EventCallback`

The `LocalConnection` class implements this for single-process play; `GameServer` handles multiplayer with broadcast to all connected players.

### Key Systems

**Modifier System** (`core/src/engine/modifiers.ts`):
- Skills, cards, and units apply modifiers with duration (`turn`, `combat`, `round`, `permanent`) and scope (`self`, `one_enemy`, `all_players`, etc.)
- All game calculations use "effective value" functions that query active modifiers
- Examples: terrain cost reduction, sideways card bonuses, enemy armor reduction

**Command Pattern** (`core/src/engine/commands.ts`, `commandStack.ts`):
- Enables undo during a player's turn until an irreversible event (tile revealed, enemy drawn, die rolled)
- Commands implement `execute()` and `undo()` methods

**Seeded RNG System** (`core/src/utils/rng.ts`):
- All randomness goes through seeded RNG for reproducible games (testing, replays, debugging)
- `RngState` is stored in `GameState.rng` and threaded through operations
- Uses Mulberry32 algorithm for fast, well-distributed random numbers
- Key functions:
  - `createRng(seed?)` — create initial RNG state (defaults to `Date.now()`)
  - `shuffleWithRng(array, rng)` — returns `{ result, rng }` (Fisher-Yates)
  - `randomInt(rng, min, max)` — returns `{ value, rng }`
  - `randomElement(array, rng)` — returns `{ value, rng }`
- Pattern: All RNG functions return updated state, must thread through:
  ```typescript
  const { result: shuffled, rng: rng1 } = shuffleWithRng(cards, state.rng);
  const { value: picked, rng: rng2 } = randomElement(enemies, rng1);
  return { ...state, rng: rng2 };
  ```
- Pass optional `seed` to `createInitialGameState(seed)` for deterministic games

### Dependency Rules

- **@mage-knight/shared is the foundation** — defines types used by both client and server
- **@mage-knight/core imports from shared, never the reverse**
- **Don't re-export shared types through core files** — import directly from shared where needed
- **Within core, keep import chains shallow** — one level deep is fine, avoid A → B → C → D chains
- **Branded ID types live with their domain** — `EnemyTokenId` with enemy types, `TileId` with map types, etc.
- **When in doubt, check: "if I delete this file, what breaks?"** — minimize blast radius

## No Magic Strings (Policy + Workflow)

This repo aims to avoid hard-coded string literals for anything that behaves like an identifier:
- Discriminators (`type` fields in discriminated unions)
- Command kinds / event kinds / action kinds
- Validation codes
- “Enum-ish” domains (phases, time-of-day, categories, reasons, sources, etc.)

### Preferred Pattern

- **Define exported constants**:
  - `export const SOME_KIND = "some_kind" as const;`
- **Type from constants** (keeps runtime + type-level in sync):
  - `export type SomeKind = typeof SOME_KIND | typeof OTHER_KIND | ...;`
- **Use constants everywhere**:
  - comparisons (`x.type === SOME_KIND`)
  - object literals (`{ type: SOME_KIND, ... }`)
  - switches (`case SOME_KIND: ...`)
  - tests (assert against constants, not string literals)

We intentionally prefer **`as const` + `typeof`** over TypeScript `enum`s to keep values tree-shakeable and ergonomic across packages.

### Red → Green Refactor Workflow (Lint-First)

When cleaning up a “magic string” area:
- **Red**: add a *blocking* ESLint rule (typically `no-restricted-syntax`) scoped as narrowly as possible (file or field).
  - The rule should catch the exact pattern (e.g., string-literal unions for a field, or returning a string literal from a mapper).
- **Green**: introduce constants/types in an appropriate “constants module”, refactor callsites to use them, and keep narrowing via `typeof`.
- **Expand**: once green, you can broaden the lint scope to cover more files/fields.

The goal is to make the linter act like a “test” that prevents regressions.

### Domain Boundaries Matter

It’s OK for multiple domains to share the same underlying string values, but **do not alias semantic domains** unless they truly mean the same thing.
Example: two domains can both contain `"blue"`, but should still have separate constant sets if they represent different concepts.

### Monorepo Gotcha: Shared Builds

Core/server consume `@mage-knight/shared` via built outputs. When adding new exports/constants to shared:
- rebuild shared (`pnpm -C packages/shared build`) before expecting other packages to “see” them
- then re-run lint/tests (`pnpm -r lint`, `pnpm test`)
