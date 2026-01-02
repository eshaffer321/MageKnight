# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### Dependency Rules

- **@mage-knight/shared is the foundation** — defines types used by both client and server
- **@mage-knight/core imports from shared, never the reverse**
- **Don't re-export shared types through core files** — import directly from shared where needed
- **Within core, keep import chains shallow** — one level deep is fine, avoid A → B → C → D chains
- **Branded ID types live with their domain** — `EnemyTokenId` with enemy types, `TileId` with map types, etc.
- **When in doubt, check: "if I delete this file, what breaks?"** — minimize blast radius
