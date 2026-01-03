import { describe, it, expect, beforeEach } from "vitest";
import { createEngine, MageKnightEngine } from "../MageKnightEngine.js";
import { createTestGameState, createTestPlayer } from "./testHelpers.js";
import {
  END_TURN_ACTION,
  TURN_ENDED,
  ROUND_ENDED,
  MOVE_ACTION,
  INVALID_ACTION,
} from "@mage-knight/shared";
import type { SkillId } from "@mage-knight/shared";
import { TERRAIN_PLAINS } from "@mage-knight/shared";
import {
  DURATION_ROUND,
  DURATION_TURN,
  EFFECT_TERRAIN_COST,
  SCOPE_SELF,
  SOURCE_SKILL,
} from "../modifierConstants.js";
import {
  CARD_MARCH,
  CARD_RAGE,
  CARD_STAMINA,
  CARD_SWIFTNESS,
  CARD_DETERMINATION,
  CARD_PROMISE,
  CARD_THREATEN,
} from "../../types/cardIds.js";

describe("END_TURN action", () => {
  let engine: MageKnightEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it("should advance to next player", () => {
    const player1 = createTestPlayer({ id: "player1", movePoints: 4 });
    const player2 = createTestPlayer({ id: "player2", movePoints: 0 });
    const state = createTestGameState({
      turnOrder: ["player1", "player2"],
      currentPlayerIndex: 0,
      players: [player1, player2],
    });

    const result = engine.processAction(state, "player1", {
      type: END_TURN_ACTION,
    });

    expect(result.state.currentPlayerIndex).toBe(1);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: TURN_ENDED,
        playerId: "player1",
        nextPlayerId: "player2",
      })
    );
  });

  it("should wrap around to first player", () => {
    const player1 = createTestPlayer({ id: "player1", movePoints: 0 });
    const player2 = createTestPlayer({ id: "player2", movePoints: 4 });
    const state = createTestGameState({
      turnOrder: ["player1", "player2"],
      currentPlayerIndex: 1,
      players: [player1, player2],
    });

    const result = engine.processAction(state, "player2", {
      type: END_TURN_ACTION,
    });

    expect(result.state.currentPlayerIndex).toBe(0);
    // When wrapping around, we also emit ROUND_ENDED
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: TURN_ENDED,
        playerId: "player2",
        nextPlayerId: "player1",
      })
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: ROUND_ENDED,
        round: 1,
      })
    );
  });

  it("should reset current player turn state", () => {
    const player = createTestPlayer({
      id: "player1",
      movePoints: 2,
      hasMovedThisTurn: true,
      hasTakenActionThisTurn: true,
      influencePoints: 5,
      usedManaFromSource: true,
    });

    const state = createTestGameState({
      players: [player],
      turnOrder: ["player1"],
    });

    const result = engine.processAction(state, "player1", {
      type: END_TURN_ACTION,
    });

    const updatedPlayer = result.state.players[0];
    // Current player should have turn state reset
    expect(updatedPlayer?.movePoints).toBe(4); // Gets new points for next turn (since single player)
    expect(updatedPlayer?.hasMovedThisTurn).toBe(false);
    expect(updatedPlayer?.hasTakenActionThisTurn).toBe(false);
    expect(updatedPlayer?.influencePoints).toBe(0);
    expect(updatedPlayer?.usedManaFromSource).toBe(false);
  });

  it("should give next player starting move points", () => {
    const player1 = createTestPlayer({ id: "player1", movePoints: 4 });
    const player2 = createTestPlayer({ id: "player2", movePoints: 0 });
    const state = createTestGameState({
      turnOrder: ["player1", "player2"],
      currentPlayerIndex: 0,
      players: [player1, player2],
    });

    const result = engine.processAction(state, "player1", {
      type: END_TURN_ACTION,
    });

    const nextPlayer = result.state.players.find((p) => p.id === "player2");
    expect(nextPlayer?.movePoints).toBe(4); // TEMPORARY starting move points
  });

  it("should clear command stack (not undoable)", () => {
    const state = createTestGameState();

    // Move first
    const afterMove = engine.processAction(state, "player1", {
      type: MOVE_ACTION,
      target: { q: 1, r: 0 },
    });

    expect(afterMove.state.commandStack.commands.length).toBe(1);

    // End turn
    const afterEnd = engine.processAction(afterMove.state, "player1", {
      type: END_TURN_ACTION,
    });

    // Command stack should be cleared (checkpoint set)
    expect(afterEnd.state.commandStack.commands.length).toBe(0);
    expect(afterEnd.state.commandStack.checkpoint).not.toBeNull();
  });

  it("should expire turn-duration modifiers", () => {
    const state = createTestGameState({
      activeModifiers: [
        {
          id: "test-mod",
          source: {
            type: SOURCE_SKILL,
            skillId: "test" as SkillId,
            playerId: "player1",
          },
          duration: DURATION_TURN,
          scope: { type: SCOPE_SELF },
          effect: {
            type: EFFECT_TERRAIN_COST,
            terrain: TERRAIN_PLAINS,
            amount: -1,
            minimum: 0,
          },
          createdAtRound: 1,
          createdByPlayerId: "player1",
        },
      ],
    });

    const result = engine.processAction(state, "player1", {
      type: END_TURN_ACTION,
    });

    expect(result.state.activeModifiers.length).toBe(0);
  });

  it("should not expire round-duration modifiers", () => {
    const state = createTestGameState({
      activeModifiers: [
        {
          id: "round-mod",
          source: {
            type: SOURCE_SKILL,
            skillId: "test" as SkillId,
            playerId: "player1",
          },
          duration: DURATION_ROUND,
          scope: { type: SCOPE_SELF },
          effect: {
            type: EFFECT_TERRAIN_COST,
            terrain: TERRAIN_PLAINS,
            amount: -1,
            minimum: 0,
          },
          createdAtRound: 1,
          createdByPlayerId: "player1",
        },
      ],
    });

    const result = engine.processAction(state, "player1", {
      type: END_TURN_ACTION,
    });

    expect(result.state.activeModifiers.length).toBe(1);
  });

  it("should reject if not player's turn", () => {
    const player1 = createTestPlayer({ id: "player1", movePoints: 4 });
    const player2 = createTestPlayer({ id: "player2", movePoints: 0 });
    const state = createTestGameState({
      turnOrder: ["player1", "player2"],
      currentPlayerIndex: 0, // player1's turn
      players: [player1, player2],
    });

    const result = engine.processAction(state, "player2", {
      type: END_TURN_ACTION,
    });

    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: INVALID_ACTION,
        playerId: "player2",
      })
    );
  });

  it("should reject during combat", () => {
    const state = createTestGameState({
      combat: { _placeholder: undefined },
    });

    const result = engine.processAction(state, "player1", {
      type: END_TURN_ACTION,
    });

    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: INVALID_ACTION,
        reason: "Cannot perform this action during combat",
      })
    );
  });
});

describe("END_TURN card flow", () => {
  let engine: MageKnightEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it("should move play area cards to discard", () => {
    const player = createTestPlayer({
      playArea: [CARD_MARCH, CARD_RAGE],
      discard: [CARD_STAMINA],
      deck: [CARD_SWIFTNESS, CARD_DETERMINATION],
      hand: [],
      handLimit: 5,
    });
    const state = createTestGameState({ players: [player] });

    const result = engine.processAction(state, "player1", {
      type: END_TURN_ACTION,
    });

    const updatedPlayer = result.state.players[0];
    expect(updatedPlayer?.playArea).toHaveLength(0);
    expect(updatedPlayer?.discard).toContain(CARD_MARCH);
    expect(updatedPlayer?.discard).toContain(CARD_RAGE);
    expect(updatedPlayer?.discard).toContain(CARD_STAMINA);
    expect(updatedPlayer?.discard).toHaveLength(3);
  });

  it("should draw up to hand limit", () => {
    const player = createTestPlayer({
      hand: [CARD_MARCH], // 1 card in hand
      deck: [
        CARD_RAGE,
        CARD_STAMINA,
        CARD_SWIFTNESS,
        CARD_DETERMINATION,
        CARD_PROMISE,
      ],
      discard: [],
      playArea: [],
      handLimit: 5,
    });
    const state = createTestGameState({ players: [player] });

    const result = engine.processAction(state, "player1", {
      type: END_TURN_ACTION,
    });

    const updatedPlayer = result.state.players[0];
    expect(updatedPlayer?.hand).toHaveLength(5); // Drew 4 cards to reach limit
    expect(updatedPlayer?.deck).toHaveLength(1); // 5 - 4 = 1 remaining
  });

  it("should stop drawing if deck empties (no mid-round reshuffle)", () => {
    const player = createTestPlayer({
      hand: [CARD_MARCH], // 1 card
      deck: [CARD_RAGE, CARD_STAMINA], // Only 2 cards in deck
      discard: [CARD_SWIFTNESS, CARD_DETERMINATION], // Cards in discard
      playArea: [],
      handLimit: 5,
    });
    const state = createTestGameState({ players: [player] });

    const result = engine.processAction(state, "player1", {
      type: END_TURN_ACTION,
    });

    const updatedPlayer = result.state.players[0];
    expect(updatedPlayer?.hand).toHaveLength(3); // 1 + 2 drawn = 3 (not 5)
    expect(updatedPlayer?.deck).toHaveLength(0); // Deck empty
    expect(updatedPlayer?.discard).toHaveLength(2); // Discard NOT shuffled back
  });

  it("should not discard down if over hand limit", () => {
    const player = createTestPlayer({
      hand: [
        CARD_MARCH,
        CARD_RAGE,
        CARD_STAMINA,
        CARD_SWIFTNESS,
        CARD_DETERMINATION,
        CARD_PROMISE,
      ], // 6 cards
      deck: [CARD_THREATEN],
      discard: [],
      playArea: [],
      handLimit: 5, // Over limit
    });
    const state = createTestGameState({ players: [player] });

    const result = engine.processAction(state, "player1", {
      type: END_TURN_ACTION,
    });

    const updatedPlayer = result.state.players[0];
    expect(updatedPlayer?.hand).toHaveLength(6); // Still 6, no forced discard
  });

  it("should include card counts in TURN_ENDED event", () => {
    const player = createTestPlayer({
      hand: [CARD_MARCH],
      deck: [CARD_RAGE, CARD_STAMINA, CARD_SWIFTNESS, CARD_DETERMINATION],
      discard: [],
      playArea: [CARD_PROMISE, CARD_THREATEN],
      handLimit: 5,
    });
    const state = createTestGameState({ players: [player] });

    const result = engine.processAction(state, "player1", {
      type: END_TURN_ACTION,
    });

    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: TURN_ENDED,
        cardsDiscarded: 2,
        cardsDrawn: 4,
      })
    );
  });

  it("should reset combat accumulator at end of turn", () => {
    const player = createTestPlayer({
      combatAccumulator: {
        attack: { normal: 5, ranged: 3, siege: 0 },
        block: 4,
      },
    });
    const state = createTestGameState({ players: [player] });

    const result = engine.processAction(state, "player1", {
      type: END_TURN_ACTION,
    });

    const updatedPlayer = result.state.players[0];
    expect(updatedPlayer?.combatAccumulator).toEqual({
      attack: { normal: 0, ranged: 0, siege: 0 },
      block: 0,
    });
  });
});

describe("Round end reshuffling", () => {
  let engine: MageKnightEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it("should reshuffle all cards at end of round", () => {
    const player1 = createTestPlayer({
      id: "player1",
      hand: [CARD_MARCH],
      deck: [], // Empty deck
      discard: [CARD_RAGE, CARD_STAMINA, CARD_SWIFTNESS],
      playArea: [CARD_DETERMINATION],
      handLimit: 5,
    });
    const player2 = createTestPlayer({
      id: "player2",
      hand: [CARD_PROMISE],
      deck: [CARD_THREATEN],
      discard: [],
      playArea: [],
      handLimit: 5,
    });

    const state = createTestGameState({
      players: [player1, player2],
      turnOrder: ["player1", "player2"],
      currentPlayerIndex: 1, // Player 2's turn, will wrap to round end
    });

    const result = engine.processAction(state, "player2", {
      type: END_TURN_ACTION,
    });

    // Round should have ended
    expect(result.state.round).toBe(state.round + 1);

    // Player 1 should have reshuffled deck
    const updatedPlayer1 = result.state.players[0];
    expect(updatedPlayer1?.discard).toHaveLength(0); // Discard cleared
    // Total cards (hand + deck) should equal original total
    // Original: 1 (hand) + 0 (deck) + 3 (discard) + 1 (play area) = 5
    const totalCards =
      (updatedPlayer1?.hand.length ?? 0) + (updatedPlayer1?.deck.length ?? 0);
    expect(totalCards).toBe(5);
    // Should have drawn up to hand limit
    expect(updatedPlayer1?.hand).toHaveLength(5);
    expect(updatedPlayer1?.deck).toHaveLength(0);
  });

  it("should reshuffle player with more cards than hand limit", () => {
    const player1 = createTestPlayer({
      id: "player1",
      hand: [CARD_MARCH, CARD_RAGE],
      deck: [CARD_STAMINA, CARD_SWIFTNESS, CARD_DETERMINATION],
      discard: [CARD_PROMISE, CARD_THREATEN],
      playArea: [],
      handLimit: 5,
    });
    const player2 = createTestPlayer({
      id: "player2",
      hand: [],
      deck: [],
      discard: [],
      playArea: [],
      handLimit: 5,
    });

    const state = createTestGameState({
      players: [player1, player2],
      turnOrder: ["player1", "player2"],
      currentPlayerIndex: 1, // Player 2's turn
    });

    const result = engine.processAction(state, "player2", {
      type: END_TURN_ACTION,
    });

    const updatedPlayer1 = result.state.players[0];
    // Original total: 2 + 3 + 2 = 7 cards
    const totalCards =
      (updatedPlayer1?.hand.length ?? 0) + (updatedPlayer1?.deck.length ?? 0);
    expect(totalCards).toBe(7);
    expect(updatedPlayer1?.hand).toHaveLength(5); // Hand limit
    expect(updatedPlayer1?.deck).toHaveLength(2); // Remaining in deck
    expect(updatedPlayer1?.discard).toHaveLength(0); // Discard cleared
  });

  it("should emit ROUND_ENDED event with round number", () => {
    const player1 = createTestPlayer({ id: "player1" });
    const player2 = createTestPlayer({ id: "player2" });

    const state = createTestGameState({
      players: [player1, player2],
      turnOrder: ["player1", "player2"],
      currentPlayerIndex: 1,
      round: 3,
    });

    const result = engine.processAction(state, "player2", {
      type: END_TURN_ACTION,
    });

    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: ROUND_ENDED,
        round: 3,
      })
    );
  });
});
