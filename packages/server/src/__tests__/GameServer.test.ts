import { describe, it, expect, beforeEach, vi } from "vitest";
import { createGameServer, GameServer } from "../index.js";
import type { GameEvent, ClientGameState } from "@mage-knight/shared";
import type { HexState } from "@mage-knight/core";

describe("GameServer", () => {
  let server: GameServer;

  beforeEach(() => {
    server = createGameServer();
  });

  describe("connection", () => {
    it("should allow players to connect", () => {
      const callback = vi.fn();

      server.initializeGame(["player1"]);
      server.connect("player1", callback);

      // Should receive initial state
      expect(callback).toHaveBeenCalledTimes(1);
      const [, state] = callback.mock.calls[0] as [GameEvent[], ClientGameState];
      expect(state.players).toHaveLength(1);
      expect(state.players[0].id).toBe("player1");
    });

    it("should send filtered state to each player", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      server.initializeGame(["player1", "player2"]);
      server.connect("player1", callback1);
      server.connect("player2", callback2);

      const state1 = callback1.mock.calls[0][1] as ClientGameState;

      // Each player should see their own hand as array
      // and other player's hand as number
      const p1InState1 = state1.players.find((p) => p.id === "player1");
      const p2InState1 = state1.players.find((p) => p.id === "player2");

      expect(Array.isArray(p1InState1?.hand)).toBe(true);
      expect(typeof p2InState1?.hand).toBe("number");

      // Verify callback2 was also called (player2 receives state)
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe("action handling", () => {
    it("should process action and broadcast to all players", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      server.initializeGame(["player1", "player2"]);
      server.connect("player1", callback1);
      server.connect("player2", callback2);

      // Clear initial connection calls
      callback1.mockClear();
      callback2.mockClear();

      // Player1 sends an action (will fail validation since not on map, but that's ok)
      server.handleAction("player1", { type: "END_TURN" });

      // Both players should receive the broadcast
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it("should update state after valid action", () => {
      server.initializeGame(["player1"]);

      // Manually set up state for a valid move
      const state = server.getState();
      const testHex: HexState = {
        coord: { q: 0, r: 0 },
        terrain: "plains",
        tileId: "starting_a",
        site: null,
        enemies: [],
        shieldTokens: [],
        rampagingEnemies: [],
      };
      const targetHex: HexState = {
        coord: { q: 1, r: 0 },
        terrain: "plains",
        tileId: "starting_a",
        site: null,
        enemies: [],
        shieldTokens: [],
        rampagingEnemies: [],
      };
      const updatedState = {
        ...state,
        players: [
          {
            ...state.players[0],
            position: { q: 0, r: 0 },
            movePoints: 4,
          },
        ],
        map: {
          ...state.map,
          hexes: {
            "0,0": testHex,
            "1,0": targetHex,
          },
        },
      };

      // Hacky but works for testing - directly set state
      (server as unknown as { state: typeof updatedState }).state =
        updatedState;

      const callback = vi.fn();
      server.connect("player1", callback);
      callback.mockClear();

      // Now move
      server.handleAction("player1", { type: "MOVE", target: { q: 1, r: 0 } });

      // Should have moved
      const newState = server.getState();
      expect(newState.players[0].position).toEqual({ q: 1, r: 0 });

      // Should have received PLAYER_MOVED event
      const [events] = callback.mock.calls[0] as [GameEvent[]];
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "PLAYER_MOVED",
          playerId: "player1",
        })
      );
    });
  });

  describe("multiplayer broadcast", () => {
    it("should broadcast to all players when one acts", () => {
      const callbacks = [vi.fn(), vi.fn(), vi.fn()];

      server.initializeGame(["player1", "player2", "player3"]);
      server.connect("player1", callbacks[0]);
      server.connect("player2", callbacks[1]);
      server.connect("player3", callbacks[2]);

      callbacks.forEach((cb) => cb.mockClear());

      server.handleAction("player1", { type: "UNDO" });

      // All three should receive broadcast
      expect(callbacks[0]).toHaveBeenCalledTimes(1);
      expect(callbacks[1]).toHaveBeenCalledTimes(1);
      expect(callbacks[2]).toHaveBeenCalledTimes(1);
    });
  });

  describe("game initialization", () => {
    it("should broadcast GAME_STARTED event on initialization", () => {
      const callback = vi.fn();

      server.connect("player1", callback);
      callback.mockClear();

      server.initializeGame(["player1", "player2"]);

      // Should have broadcast GAME_STARTED
      expect(callback).toHaveBeenCalledTimes(1);
      const [events] = callback.mock.calls[0] as [GameEvent[]];
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "GAME_STARTED",
          playerCount: 2,
        })
      );
    });

    it("should assign different heroes to players", () => {
      server.initializeGame(["player1", "player2", "player3", "player4"]);

      const state = server.getState();
      const heroIds = state.players.map((p) => p.hero);

      // All 4 players should have different heroes
      const uniqueHeroes = new Set(heroIds);
      expect(uniqueHeroes.size).toBe(4);
    });
  });

  describe("getStateForPlayer", () => {
    it("should return filtered state for specific player", () => {
      server.initializeGame(["player1", "player2"]);

      const state1 = server.getStateForPlayer("player1");
      const state2 = server.getStateForPlayer("player2");

      // Player1's view should show their hand as array
      const p1InState1 = state1.players.find((p) => p.id === "player1");
      expect(Array.isArray(p1InState1?.hand)).toBe(true);

      // Player2's view should show player1's hand as number
      const p1InState2 = state2.players.find((p) => p.id === "player1");
      expect(typeof p1InState2?.hand).toBe("number");
    });
  });
});
