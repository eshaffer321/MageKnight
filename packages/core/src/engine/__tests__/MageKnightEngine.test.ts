import { describe, it, expect, beforeEach } from "vitest";
import { MageKnightEngine, createEngine } from "../MageKnightEngine.js";
import { createInitialGameState } from "../../state/GameState.js";
import type { GameState } from "../../state/GameState.js";
import { MOVE_UNDONE, PLAYER_MOVED } from "@mage-knight/shared";
import { MOVE_COMMAND } from "../commands/moveCommand.js";
import type { Player } from "../../types/player.js";
import type { HexState } from "../../types/map.js";
import { Hero } from "../../types/hero.js";
import { TileId } from "../../types/map.js";
import type { Terrain, SkillId } from "@mage-knight/shared";

// Helper to create a test player
function createTestPlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "player1",
    hero: Hero.Arythea,
    position: { q: 0, r: 0 },
    fame: 0,
    level: 1,
    reputation: 0,
    armor: 2,
    handLimit: 5,
    commandTokens: 1,
    hand: [],
    deck: [],
    discard: [],
    units: [],
    skills: [],
    skillCooldowns: {
      usedThisRound: [],
      usedThisTurn: [],
      usedThisCombat: [],
      activeUntilNextTurn: [],
    },
    crystals: { red: 0, blue: 0, green: 0, white: 0 },
    tacticCard: null,
    knockedOut: false,
    roundOrderTokenFaceDown: false,
    movePoints: 0,
    influencePoints: 0,
    playArea: [],
    pureMana: [],
    usedManaFromSource: false,
    hasMovedThisTurn: false,
    hasTakenActionThisTurn: false,
    ...overrides,
  };
}

// Helper to create a test hex
function createTestHex(
  q: number,
  r: number,
  terrain: Terrain = "plains"
): HexState {
  return {
    coord: { q, r },
    terrain,
    tileId: TileId.StartingTileA,
    site: null,
    enemies: [],
    shieldTokens: [],
    rampagingEnemies: [],
  };
}

// Helper to create a test game state
function createTestGameState(overrides: Partial<GameState> = {}): GameState {
  const baseState = createInitialGameState();
  const player = createTestPlayer({ movePoints: 4 });

  // Create a small map with adjacent hexes
  const hexes: Record<string, HexState> = {
    "0,0": createTestHex(0, 0, "plains"), // Player starts here
    "1,0": createTestHex(1, 0, "plains"), // East - cost 2
    "0,1": createTestHex(0, 1, "forest"), // Southeast - cost 3 day, 5 night
    "-1,0": createTestHex(-1, 0, "hills"), // West - cost 3
  };

  return {
    ...baseState,
    phase: "round",
    timeOfDay: "day",
    turnOrder: ["player1"],
    currentPlayerIndex: 0,
    players: [player],
    map: {
      ...baseState.map,
      hexes,
    },
    ...overrides,
  };
}

describe("MageKnightEngine", () => {
  let engine: MageKnightEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  describe("MOVE action", () => {
    it("should move player to adjacent hex and deduct move points", () => {
      const state = createTestGameState();

      const result = engine.processAction(state, "player1", {
        type: MOVE_COMMAND,
        target: { q: 1, r: 0 },
      });

      // Player should have moved
      const player = result.state.players[0];
      expect(player.position).toEqual({ q: 1, r: 0 });

      // Move points should be deducted (plains = 2)
      expect(player.movePoints).toBe(2); // Started with 4, spent 2

      // hasMovedThisTurn should be true
      expect(player.hasMovedThisTurn).toBe(true);

      // Should have PLAYER_MOVED event
      expect(result.events).toContainEqual({
        type: PLAYER_MOVED,
        playerId: "player1",
        from: { q: 0, r: 0 },
        to: { q: 1, r: 0 },
      });

      // Command should be on the stack
      expect(result.state.commandStack.commands.length).toBe(1);
    });

    it("should reject move when not player's turn", () => {
      const state = createTestGameState({
        turnOrder: ["player2", "player1"],
        currentPlayerIndex: 0, // player2's turn
      });

      const result = engine.processAction(state, "player1", {
        type: MOVE_COMMAND,
        target: { q: 1, r: 0 },
      });

      // Should have INVALID_ACTION event
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "INVALID_ACTION",
          playerId: "player1",
          reason: "It is not your turn",
        })
      );

      // State should be unchanged
      expect(result.state.players[0].position).toEqual({ q: 0, r: 0 });
    });

    it("should reject move to non-adjacent hex", () => {
      const state = createTestGameState();

      const result = engine.processAction(state, "player1", {
        type: MOVE_COMMAND,
        target: { q: 2, r: 0 }, // Two hexes away
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "INVALID_ACTION",
          reason: "Target hex is not adjacent",
        })
      );
    });

    it("should reject move to non-existent hex", () => {
      const state = createTestGameState();

      const result = engine.processAction(state, "player1", {
        type: MOVE_COMMAND,
        target: { q: 1, r: -1 }, // Adjacent to (0,0) but not in our test map
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "INVALID_ACTION",
          reason: "Target hex does not exist",
        })
      );
    });

    it("should reject move with insufficient move points", () => {
      const player = createTestPlayer({ movePoints: 1 }); // Only 1 point
      const state = createTestGameState({
        players: [player],
      });

      const result = engine.processAction(state, "player1", {
        type: MOVE_COMMAND,
        target: { q: 1, r: 0 }, // Plains costs 2
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "INVALID_ACTION",
          reason: "Need 2 move points, have 1",
        })
      );
    });

    it("should reject move after player has taken action", () => {
      const player = createTestPlayer({
        movePoints: 4,
        hasTakenActionThisTurn: true,
      });
      const state = createTestGameState({
        players: [player],
      });

      const result = engine.processAction(state, "player1", {
        type: MOVE_COMMAND,
        target: { q: 1, r: 0 },
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "INVALID_ACTION",
          reason: "You have already taken an action this turn",
        })
      );
    });

    it("should use correct terrain cost for forest during day", () => {
      const state = createTestGameState();

      const result = engine.processAction(state, "player1", {
        type: MOVE_COMMAND,
        target: { q: 0, r: 1 }, // Forest
      });

      const player = result.state.players[0];
      expect(player.movePoints).toBe(1); // Started with 4, forest costs 3 during day
    });

    it("should use correct terrain cost for forest during night", () => {
      const state = createTestGameState({
        timeOfDay: "night",
      });

      // Give player enough points for night forest (5)
      const player = createTestPlayer({ movePoints: 6 });
      const stateWithPoints = { ...state, players: [player] };

      const result = engine.processAction(stateWithPoints, "player1", {
        type: MOVE_COMMAND,
        target: { q: 0, r: 1 }, // Forest
      });

      const updatedPlayer = result.state.players[0];
      expect(updatedPlayer.movePoints).toBe(1); // Started with 6, forest costs 5 at night
    });

    it("should reject move during combat", () => {
      const state = createTestGameState({
        combat: { _placeholder: undefined }, // In combat
      });

      const result = engine.processAction(state, "player1", {
        type: MOVE_COMMAND,
        target: { q: 1, r: 0 },
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "INVALID_ACTION",
          reason: "Cannot perform this action during combat",
        })
      );
    });
  });

  describe("UNDO action", () => {
    it("should undo a move and restore previous state", () => {
      const state = createTestGameState();

      // First, move
      const afterMove = engine.processAction(state, "player1", {
        type: MOVE_COMMAND,
        target: { q: 1, r: 0 },
      });

      expect(afterMove.state.players[0].position).toEqual({ q: 1, r: 0 });
      expect(afterMove.state.players[0].movePoints).toBe(2);

      // Now undo
      const afterUndo = engine.processAction(afterMove.state, "player1", {
        type: "UNDO",
      });

      // Player should be back
      expect(afterUndo.state.players[0].position).toEqual({ q: 0, r: 0 });
      expect(afterUndo.state.players[0].movePoints).toBe(4);
      expect(afterUndo.state.players[0].hasMovedThisTurn).toBe(false);

      // Should have MOVE_UNDONE event
      expect(afterUndo.events).toContainEqual({
        type: MOVE_UNDONE,
        playerId: "player1",
        from: { q: 1, r: 0 },
        to: { q: 0, r: 0 },
      });

      // Command stack should be empty
      expect(afterUndo.state.commandStack.commands.length).toBe(0);
    });

    it("should undo multiple moves in order", () => {
      const state = createTestGameState();

      // Move twice
      const afterMove1 = engine.processAction(state, "player1", {
        type: MOVE_COMMAND,
        target: { q: 1, r: 0 },
      });

      // Add the destination hex so we can move again
      const stateWithMoreHexes = {
        ...afterMove1.state,
        map: {
          ...afterMove1.state.map,
          hexes: {
            ...afterMove1.state.map.hexes,
            "2,0": createTestHex(2, 0, "plains"),
          },
        },
      };

      const afterMove2 = engine.processAction(stateWithMoreHexes, "player1", {
        type: MOVE_COMMAND,
        target: { q: 2, r: 0 },
      });

      expect(afterMove2.state.players[0].position).toEqual({ q: 2, r: 0 });
      expect(afterMove2.state.commandStack.commands.length).toBe(2);

      // Undo second move
      const afterUndo1 = engine.processAction(afterMove2.state, "player1", {
        type: "UNDO",
      });

      expect(afterUndo1.state.players[0].position).toEqual({ q: 1, r: 0 });
      expect(afterUndo1.state.commandStack.commands.length).toBe(1);

      // Undo first move
      const afterUndo2 = engine.processAction(afterUndo1.state, "player1", {
        type: "UNDO",
      });

      expect(afterUndo2.state.players[0].position).toEqual({ q: 0, r: 0 });
      expect(afterUndo2.state.commandStack.commands.length).toBe(0);
    });

    it("should fail undo when nothing to undo", () => {
      const state = createTestGameState();

      const result = engine.processAction(state, "player1", {
        type: "UNDO",
      });

      expect(result.events).toContainEqual({
        type: "UNDO_FAILED",
        playerId: "player1",
        reason: "nothing_to_undo",
      });
    });

    it("should fail undo when not player's turn", () => {
      const state = createTestGameState({
        turnOrder: ["player2", "player1"],
        currentPlayerIndex: 0,
      });

      const result = engine.processAction(state, "player1", {
        type: "UNDO",
      });

      expect(result.events).toContainEqual({
        type: "UNDO_FAILED",
        playerId: "player1",
        reason: "not_your_turn",
      });
    });
  });

  describe("Modifier integration", () => {
    it("should apply terrain cost modifiers", () => {
      const state = createTestGameState();

      // Add a modifier that reduces plains cost by 1
      const stateWithModifier: GameState = {
        ...state,
        activeModifiers: [
          {
            id: "test-mod",
            source: {
              type: "skill",
              skillId: "test" as SkillId,
              playerId: "player1",
            },
            duration: "turn",
            scope: { type: "self" },
            effect: {
              type: "terrain_cost",
              terrain: "plains",
              amount: -1,
              minimum: 0,
            },
            createdAtRound: 1,
            createdByPlayerId: "player1",
          },
        ],
      };

      const result = engine.processAction(stateWithModifier, "player1", {
        type: MOVE_COMMAND,
        target: { q: 1, r: 0 }, // Plains, normally costs 2
      });

      const player = result.state.players[0];
      // Should only cost 1 now (2 - 1 = 1)
      expect(player.movePoints).toBe(3); // Started with 4, spent 1
    });
  });
});
