/**
 * Tests for PLAY_CARD action
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createEngine, type MageKnightEngine } from "../MageKnightEngine.js";
import { createTestGameState, createTestPlayer } from "./testHelpers.js";
import {
  PLAY_CARD_ACTION,
  CARD_PLAYED,
  CARD_PLAY_UNDONE,
  UNDO_ACTION,
  INVALID_ACTION,
} from "@mage-knight/shared";
import {
  CARD_MARCH,
  CARD_RAGE,
  CARD_WOUND,
  CARD_PROMISE,
  CARD_THREATEN,
  CARD_SWIFTNESS,
} from "../../types/cardIds.js";

describe("PLAY_CARD action", () => {
  let engine: MageKnightEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  describe("basic card play", () => {
    it("should move card from hand to play area", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH, CARD_RAGE],
        playArea: [],
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_MARCH,
        powered: false,
      });

      const updatedPlayer = result.state.players[0];
      expect(updatedPlayer.hand).not.toContain(CARD_MARCH);
      expect(updatedPlayer.hand).toContain(CARD_RAGE);
      expect(updatedPlayer.playArea).toContain(CARD_MARCH);
    });

    it("should gain move points from March", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH],
        movePoints: 0,
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_MARCH,
        powered: false,
      });

      expect(result.state.players[0].movePoints).toBe(2);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: CARD_PLAYED,
          cardId: CARD_MARCH,
          effect: "Gained 2 Move",
        })
      );
    });

    it("should gain influence points from Promise", () => {
      const player = createTestPlayer({
        hand: [CARD_PROMISE],
        influencePoints: 0,
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_PROMISE,
        powered: false,
      });

      expect(result.state.players[0].influencePoints).toBe(2);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: CARD_PLAYED,
          effect: "Gained 2 Influence",
        })
      );
    });

    it("should gain influence from Threaten (basic effect)", () => {
      const player = createTestPlayer({
        hand: [CARD_THREATEN],
        influencePoints: 0,
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_THREATEN,
        powered: false,
      });

      expect(result.state.players[0].influencePoints).toBe(2);
    });
  });

  describe("choice effects", () => {
    it("should indicate choice is required for Rage", () => {
      const player = createTestPlayer({
        hand: [CARD_RAGE],
        combatAccumulator: {
          attack: { normal: 0, ranged: 0, siege: 0 },
          block: 0,
        },
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_RAGE,
        powered: false,
      });

      // Rage basic effect is Attack or Block 2 — choice required
      // For Phase 1, this should indicate choice is needed
      expect(result.events[0]).toMatchObject({
        type: CARD_PLAYED,
      });
      const cardPlayedEvent = result.events.find(
        (e) => e.type === CARD_PLAYED
      );
      expect(cardPlayedEvent).toBeDefined();
      expect((cardPlayedEvent as { effect: string }).effect).toContain("Choice");
    });
  });

  describe("validation", () => {
    it("should reject if card not in hand", () => {
      const player = createTestPlayer({
        hand: [CARD_RAGE], // March not in hand
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_MARCH,
        powered: false,
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: INVALID_ACTION,
          reason: "Card is not in your hand",
        })
      );
    });

    it("should reject playing wound cards", () => {
      const player = createTestPlayer({
        hand: [CARD_WOUND],
      });
      const state = createTestGameState({ players: [player] });

      const result = engine.processAction(state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_WOUND,
        powered: false,
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: INVALID_ACTION,
          reason: "Wound cards cannot be played for their effect",
        })
      );
    });
  });

  describe("undo", () => {
    it("should be undoable", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH],
        movePoints: 0,
      });
      const state = createTestGameState({ players: [player] });

      // Play card
      const afterPlay = engine.processAction(state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_MARCH,
        powered: false,
      });

      expect(afterPlay.state.players[0].movePoints).toBe(2);
      expect(afterPlay.state.players[0].hand).not.toContain(CARD_MARCH);
      expect(afterPlay.state.players[0].playArea).toContain(CARD_MARCH);

      // Undo
      const afterUndo = engine.processAction(afterPlay.state, "player1", {
        type: UNDO_ACTION,
      });

      expect(afterUndo.state.players[0].movePoints).toBe(0);
      expect(afterUndo.state.players[0].hand).toContain(CARD_MARCH);
      expect(afterUndo.state.players[0].playArea).not.toContain(CARD_MARCH);
      expect(afterUndo.events).toContainEqual(
        expect.objectContaining({
          type: CARD_PLAY_UNDONE,
          cardId: CARD_MARCH,
        })
      );
    });

    it("should restore card to original hand position on undo", () => {
      const player = createTestPlayer({
        hand: [CARD_RAGE, CARD_MARCH, CARD_PROMISE],
        movePoints: 0,
      });
      const state = createTestGameState({ players: [player] });

      // Play the middle card (March)
      const afterPlay = engine.processAction(state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_MARCH,
        powered: false,
      });

      expect(afterPlay.state.players[0].hand).toEqual([CARD_RAGE, CARD_PROMISE]);

      // Undo
      const afterUndo = engine.processAction(afterPlay.state, "player1", {
        type: UNDO_ACTION,
      });

      // Card should be back in original position
      expect(afterUndo.state.players[0].hand).toEqual([
        CARD_RAGE,
        CARD_MARCH,
        CARD_PROMISE,
      ]);
    });
  });

  describe("multiple cards", () => {
    it("should allow playing multiple cards", () => {
      const player = createTestPlayer({
        hand: [CARD_MARCH, CARD_SWIFTNESS],
        movePoints: 0,
      });
      const state = createTestGameState({ players: [player] });

      // Play first March
      const afterFirst = engine.processAction(state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_MARCH,
        powered: false,
      });

      expect(afterFirst.state.players[0].movePoints).toBe(2);

      // Play Swiftness (also gives Move 2)
      const afterSecond = engine.processAction(afterFirst.state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_SWIFTNESS,
        powered: false,
      });

      expect(afterSecond.state.players[0].movePoints).toBe(4);
      expect(afterSecond.state.players[0].playArea).toHaveLength(2);
      expect(afterSecond.state.players[0].hand).toHaveLength(0);
    });

    it("should allow playing duplicate cards", () => {
      // In the real game, players can have multiple copies of the same card
      const player = createTestPlayer({
        hand: [CARD_MARCH, CARD_MARCH],
        movePoints: 0,
      });
      const state = createTestGameState({ players: [player] });

      // Play first March
      const afterFirst = engine.processAction(state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_MARCH,
        powered: false,
      });

      expect(afterFirst.state.players[0].movePoints).toBe(2);
      expect(afterFirst.state.players[0].hand).toHaveLength(1);

      // Play second March
      const afterSecond = engine.processAction(afterFirst.state, "player1", {
        type: PLAY_CARD_ACTION,
        cardId: CARD_MARCH,
        powered: false,
      });

      expect(afterSecond.state.players[0].movePoints).toBe(4);
      expect(afterSecond.state.players[0].playArea).toHaveLength(2);
    });
  });
});
