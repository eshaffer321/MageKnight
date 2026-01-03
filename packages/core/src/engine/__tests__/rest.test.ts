/**
 * Tests for REST action
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createEngine, type MageKnightEngine } from "../MageKnightEngine.js";
import { createTestGameState, createTestPlayer } from "./testHelpers.js";
import {
  REST_ACTION,
  REST_TYPE_STANDARD,
  REST_TYPE_SLOW_RECOVERY,
  PLAYER_RESTED,
  END_OF_ROUND_ANNOUNCED,
  REST_UNDONE,
  UNDO_ACTION,
  INVALID_ACTION,
  CARD_MARCH,
  CARD_RAGE,
  CARD_WOUND,
} from "@mage-knight/shared";

describe("REST action", () => {
  let engine: MageKnightEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  describe("Standard Rest", () => {
    it("should discard exactly one non-wound plus wounds to discard pile", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH, CARD_WOUND, CARD_WOUND],
        discard: [],
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_STANDARD,
        discardCardIds: [CARD_MARCH, CARD_WOUND],
      });

      // ALL cards go to discard (wounds too - this is NOT healing)
      expect(result.state.players[0].discard).toContain(CARD_MARCH);
      expect(result.state.players[0].discard).toContain(CARD_WOUND);
      expect(result.state.players[0].hand).toEqual([CARD_WOUND]); // One wound remains
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: PLAYER_RESTED,
          restType: REST_TYPE_STANDARD,
          cardsDiscarded: 2,
          woundsDiscarded: 1,
        })
      );
    });

    it("should reject discarding multiple non-wound cards", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH, CARD_RAGE],
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_STANDARD,
        discardCardIds: [CARD_MARCH, CARD_RAGE], // Two non-wounds
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: INVALID_ACTION,
          reason:
            "Standard Rest requires exactly one non-wound card (plus any number of wounds)",
        })
      );
    });

    it("should reject discarding only wounds in standard rest", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH, CARD_WOUND],
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_STANDARD,
        discardCardIds: [CARD_WOUND], // Only wounds
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: INVALID_ACTION,
          reason:
            "Standard Rest requires exactly one non-wound card (plus any number of wounds)",
        })
      );
    });

    it("should emit END_OF_ROUND_ANNOUNCED when requested", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH],
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_STANDARD,
        discardCardIds: [CARD_MARCH],
        announceEndOfRound: true,
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: END_OF_ROUND_ANNOUNCED,
          playerId: "player1",
        })
      );
    });

    it("should mark player as having taken action", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH],
        hasTakenActionThisTurn: false,
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_STANDARD,
        discardCardIds: [CARD_MARCH],
      });

      expect(result.state.players[0].hasTakenActionThisTurn).toBe(true);
    });

    it("should reject rest with no cards to discard", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH],
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_STANDARD,
        discardCardIds: [],
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: INVALID_ACTION,
          reason: "Must discard at least one card to rest",
        })
      );
    });

    it("should reject rest if card not in hand", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH],
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_STANDARD,
        discardCardIds: [CARD_RAGE], // Not in hand
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: INVALID_ACTION,
          reason: expect.stringContaining("not in your hand"),
        })
      );
    });

    it("should reject rest if already taken action", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH],
        hasTakenActionThisTurn: true,
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_STANDARD,
        discardCardIds: [CARD_MARCH],
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: INVALID_ACTION,
          // Reason from validateHasNotActed
        })
      );
    });

    it("should be undoable", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH, CARD_RAGE],
        discard: [],
        hasTakenActionThisTurn: false,
      });
      const state = createTestGameState({ players: [player] });

      // Rest
      const afterRest = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_STANDARD,
        discardCardIds: [CARD_MARCH],
      });

      expect(afterRest.state.players[0].hand).toEqual([CARD_RAGE]);
      expect(afterRest.state.players[0].discard).toContain(CARD_MARCH);

      // Undo
      const afterUndo = engine.processAction(afterRest.state, "player1", {
        type: UNDO_ACTION,
      });

      expect(afterUndo.state.players[0].hand).toContain(CARD_MARCH);
      expect(afterUndo.state.players[0].hand).toContain(CARD_RAGE);
      expect(afterUndo.state.players[0].discard).not.toContain(CARD_MARCH);
      expect(afterUndo.state.players[0].hasTakenActionThisTurn).toBe(false);
      expect(afterUndo.events).toContainEqual(
        expect.objectContaining({
          type: REST_UNDONE,
        })
      );
    });

    it("should allow discarding one non-wound with multiple wounds", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH, CARD_WOUND, CARD_WOUND],
        discard: [],
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_STANDARD,
        discardCardIds: [CARD_MARCH, CARD_WOUND, CARD_WOUND],
      });

      expect(result.state.players[0].hand).toHaveLength(0);
      // All cards go to discard (wounds too)
      expect(result.state.players[0].discard).toContain(CARD_MARCH);
      expect(result.state.players[0].discard).toContain(CARD_WOUND);
      expect(result.state.players[0].discard).toHaveLength(3);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: PLAYER_RESTED,
          cardsDiscarded: 3,
          woundsDiscarded: 2,
        })
      );
    });
  });

  describe("Slow Recovery", () => {
    it("should allow discarding one wound when hand is all wounds", () => {
      const player = createTestPlayer({
        hand: [CARD_WOUND, CARD_WOUND],
        discard: [],
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_SLOW_RECOVERY,
        discardCardIds: [CARD_WOUND],
      });

      expect(result.state.players[0].hand).toHaveLength(1);
      expect(result.state.players[0].discard).toContain(CARD_WOUND);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: PLAYER_RESTED,
          restType: REST_TYPE_SLOW_RECOVERY,
          cardsDiscarded: 1,
          woundsDiscarded: 1,
        })
      );
    });

    it("should reject slow recovery when hand has non-wound cards", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH, CARD_WOUND],
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_SLOW_RECOVERY,
        discardCardIds: [CARD_WOUND],
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: INVALID_ACTION,
          reason:
            "Slow Recovery is only allowed when your hand contains only wound cards",
        })
      );
    });

    it("should reject slow recovery when discarding more than one wound", () => {
      const player = createTestPlayer({
        hand: [CARD_WOUND, CARD_WOUND],
        discard: [],
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_SLOW_RECOVERY,
        discardCardIds: [CARD_WOUND, CARD_WOUND],
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: INVALID_ACTION,
          reason: "Slow Recovery requires discarding exactly one wound card",
        })
      );
    });

    it("should be undoable", () => {
      const player = createTestPlayer({
        hand: [CARD_WOUND, CARD_WOUND],
        discard: [],
        hasTakenActionThisTurn: false,
      });
      const state = createTestGameState({ players: [player] });

      // Slow Recovery
      const afterRest = engine.processAction(state, "player1", {
        type: REST_ACTION,
        restType: REST_TYPE_SLOW_RECOVERY,
        discardCardIds: [CARD_WOUND],
      });

      expect(afterRest.state.players[0].hand).toHaveLength(1);
      expect(afterRest.state.players[0].discard).toContain(CARD_WOUND);

      // Undo
      const afterUndo = engine.processAction(afterRest.state, "player1", {
        type: UNDO_ACTION,
      });

      expect(afterUndo.state.players[0].hand).toHaveLength(2);
      expect(afterUndo.state.players[0].discard).not.toContain(CARD_WOUND);
      expect(afterUndo.state.players[0].hasTakenActionThisTurn).toBe(false);
    });
  });
});
