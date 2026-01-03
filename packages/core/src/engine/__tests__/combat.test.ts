/**
 * Combat Phase 1 Tests
 *
 * Tests for bare-bones combat: single enemy, no abilities, hero only, physical damage
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createEngine, MageKnightEngine } from "../MageKnightEngine.js";
import { createTestGameState, createTestPlayer } from "./testHelpers.js";
import {
  ENTER_COMBAT_ACTION,
  END_COMBAT_PHASE_ACTION,
  DECLARE_BLOCK_ACTION,
  DECLARE_ATTACK_ACTION,
  ASSIGN_DAMAGE_ACTION,
  COMBAT_STARTED,
  COMBAT_PHASE_CHANGED,
  ENEMY_BLOCKED,
  BLOCK_FAILED,
  ENEMY_DEFEATED,
  ATTACK_FAILED,
  DAMAGE_ASSIGNED,
  COMBAT_ENDED,
  ENEMY_ORC,
  ENEMY_WOLF,
  COMBAT_TYPE_NORMAL,
  COMBAT_TYPE_RANGED,
  CARD_WOUND,
} from "@mage-knight/shared";
import {
  COMBAT_PHASE_RANGED_SIEGE,
  COMBAT_PHASE_BLOCK,
  COMBAT_PHASE_ASSIGN_DAMAGE,
  COMBAT_PHASE_ATTACK,
} from "../../types/combat.js";

describe("Combat Phase 1", () => {
  let engine: MageKnightEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  describe("ENTER_COMBAT", () => {
    it("should start combat with enemies", () => {
      const state = createTestGameState();

      const result = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      });

      expect(result.state.combat).not.toBeNull();
      expect(result.state.combat?.enemies).toHaveLength(1);
      expect(result.state.combat?.phase).toBe(COMBAT_PHASE_RANGED_SIEGE);
      expect(result.events).toContainEqual(
        expect.objectContaining({ type: COMBAT_STARTED })
      );
    });

    it("should start combat with multiple enemies", () => {
      const state = createTestGameState();

      const result = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC, ENEMY_WOLF],
      });

      expect(result.state.combat?.enemies).toHaveLength(2);
      expect(result.state.combat?.enemies[0].enemyId).toBe(ENEMY_ORC);
      expect(result.state.combat?.enemies[1].enemyId).toBe(ENEMY_WOLF);
    });

    it("should fail to enter combat when already in combat", () => {
      let state = createTestGameState();

      // Enter combat
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Try to enter combat again
      const result = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_WOLF],
      });

      // Should fail with invalid action event
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "INVALID_ACTION",
          reason: "Already in combat",
        })
      );
    });
  });

  describe("Phase progression", () => {
    it("should advance through all phases", () => {
      let state = createTestGameState();

      // Enter combat
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      expect(state.combat?.phase).toBe(COMBAT_PHASE_RANGED_SIEGE);

      // Skip to Block
      const result1 = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      });
      state = result1.state;
      expect(state.combat?.phase).toBe(COMBAT_PHASE_BLOCK);
      expect(result1.events).toContainEqual(
        expect.objectContaining({
          type: COMBAT_PHASE_CHANGED,
          previousPhase: COMBAT_PHASE_RANGED_SIEGE,
          newPhase: COMBAT_PHASE_BLOCK,
        })
      );

      // Skip to Assign Damage
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      expect(state.combat?.phase).toBe(COMBAT_PHASE_ASSIGN_DAMAGE);

      // Assign damage from the enemy (mandatory before advancing)
      state = engine.processAction(state, "player1", {
        type: ASSIGN_DAMAGE_ACTION,
        enemyInstanceId: "enemy_0",
      }).state;

      // Now advance to Attack
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      expect(state.combat?.phase).toBe(COMBAT_PHASE_ATTACK);
    });
  });

  describe("Blocking", () => {
    it("should block enemy with sufficient block value", () => {
      let state = createTestGameState();

      // Enter combat with Orc (attack 3)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Advance to Block phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Block with value 3
      const result = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blockValue: 3,
      });

      expect(result.state.combat?.enemies[0].isBlocked).toBe(true);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: ENEMY_BLOCKED,
          enemyInstanceId: "enemy_0",
          blockValue: 3,
        })
      );
    });

    it("should block enemy with more than required block", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Block with value 5 (Orc needs 3)
      const result = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blockValue: 5,
      });

      expect(result.state.combat?.enemies[0].isBlocked).toBe(true);
    });

    it("should fail block with insufficient value", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Block with value 2 (Orc needs 3)
      const result = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blockValue: 2,
      });

      expect(result.state.combat?.enemies[0].isBlocked).toBe(false);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: BLOCK_FAILED,
          enemyInstanceId: "enemy_0",
          blockValue: 2,
          requiredBlock: 3,
        })
      );
    });

    it("should reject block in wrong phase", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Still in Ranged/Siege phase, try to block
      const result = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blockValue: 3,
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "INVALID_ACTION",
          reason: "Can only block during Block phase",
        })
      );
    });
  });

  describe("Attacking", () => {
    it("should defeat enemy with sufficient attack", () => {
      let state = createTestGameState();

      // Enter combat with Orc (armor 3)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Block phase - block the enemy
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blockValue: 3,
      }).state;

      // Assign Damage phase - skip (enemy is blocked)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack with value 3
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attackValue: 3,
        attackType: COMBAT_TYPE_NORMAL,
      });

      expect(result.state.combat?.enemies[0].isDefeated).toBe(true);
      expect(result.state.players[0].fame).toBe(2); // Orc gives 2 fame
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: ENEMY_DEFEATED,
          enemyInstanceId: "enemy_0",
          fameGained: 2,
        })
      );
    });

    it("should fail attack with insufficient value", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Block phase - block the enemy
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blockValue: 3,
      }).state;

      // Assign Damage phase - skip (enemy is blocked)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack with value 2 (Orc has armor 3)
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attackValue: 2,
        attackType: COMBAT_TYPE_NORMAL,
      });

      expect(result.state.combat?.enemies[0].isDefeated).toBe(false);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: ATTACK_FAILED,
          attackValue: 2,
          requiredAttack: 3,
        })
      );
    });

    it("should allow ranged attacks in Attack phase", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Block phase - block the enemy
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blockValue: 3,
      }).state;

      // Assign Damage phase - skip (enemy is blocked)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Ranged attack should work in Attack phase (per rulebook)
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attackValue: 3,
        attackType: COMBAT_TYPE_RANGED,
      });

      expect(result.state.combat?.enemies[0].isDefeated).toBe(true);
    });

    it("should allow ranged attacks in Ranged/Siege phase", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Still in Ranged/Siege phase
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attackValue: 3,
        attackType: COMBAT_TYPE_RANGED,
      });

      expect(result.state.combat?.enemies[0].isDefeated).toBe(true);
    });

    it("should reject normal attacks in Ranged/Siege phase", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Still in Ranged/Siege phase, try normal attack
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attackValue: 3,
        attackType: COMBAT_TYPE_NORMAL,
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "INVALID_ACTION",
          reason: "Only Ranged or Siege attacks allowed in Ranged/Siege phase",
        })
      );
    });
  });

  describe("Damage assignment", () => {
    it("should assign wounds to hero from unblocked enemy", () => {
      const player = createTestPlayer({
        hand: [],
        handLimit: 5,
      });
      let state = createTestGameState({ players: [player] });

      // Enter combat with Orc (attack 3)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Skip to Assign Damage phase (don't block)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Assign damage
      const result = engine.processAction(state, "player1", {
        type: ASSIGN_DAMAGE_ACTION,
        enemyInstanceId: "enemy_0",
      });

      // 3 damage / 2 armor = 2 wounds (rounded up)
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: DAMAGE_ASSIGNED,
          damage: 3,
          woundsTaken: 2,
        })
      );
      // Wounds added to hand
      expect(result.state.players[0].hand).toContain(CARD_WOUND);
      expect(result.state.players[0].hand.filter((c) => c === CARD_WOUND)).toHaveLength(2);
    });

    it("should not assign damage from blocked enemy", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Block phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Block the enemy
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blockValue: 3,
      }).state;

      // Assign damage phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Try to assign damage from blocked enemy
      const result = engine.processAction(state, "player1", {
        type: ASSIGN_DAMAGE_ACTION,
        enemyInstanceId: "enemy_0",
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "INVALID_ACTION",
          reason: "Enemy is blocked, no damage to assign",
        })
      );
    });
  });

  describe("Combat end", () => {
    it("should end combat with victory when all enemies defeated", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Defeat enemy in Ranged/Siege phase with ranged attack
      state = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attackValue: 3,
        attackType: COMBAT_TYPE_RANGED,
      }).state;

      // Block phase - skip (enemy defeated)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Assign Damage phase - skip (enemy defeated)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase - skip
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // End combat
      const result = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      });

      expect(result.state.combat).toBeNull();
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: COMBAT_ENDED,
          victory: true,
          enemiesDefeated: 1,
          enemiesSurvived: 0,
          totalFameGained: 2,
        })
      );
    });

    it("should end combat without victory when enemies survive (blocked)", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Block phase - block the enemy
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blockValue: 3,
      }).state;

      // Assign Damage phase - skip (enemy is blocked)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase - skip without attacking
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // End combat without defeating enemy
      const result = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      });

      expect(result.state.combat).toBeNull();
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: COMBAT_ENDED,
          victory: false,
          enemiesDefeated: 0,
          enemiesSurvived: 1,
        })
      );
    });
  });

  describe("Integration: Full combat flow", () => {
    it("should complete a full combat: enter, block, attack, end", () => {
      let state = createTestGameState();

      // Enter combat with Orc and Wolf
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC, ENEMY_WOLF],
      }).state;

      // Ranged/Siege phase - defeat Wolf with ranged attack
      state = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_1"],
        attackValue: 2, // Wolf has armor 2
        attackType: COMBAT_TYPE_RANGED,
      }).state;

      expect(state.combat?.enemies[1].isDefeated).toBe(true);
      expect(state.players[0].fame).toBe(2); // Wolf gives 2 fame

      // Block phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Block the Orc
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blockValue: 3,
      }).state;

      expect(state.combat?.enemies[0].isBlocked).toBe(true);

      // Assign Damage phase - skip (Orc is blocked)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase - defeat Orc
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      state = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attackValue: 3,
        attackType: COMBAT_TYPE_NORMAL,
      }).state;

      expect(state.combat?.enemies[0].isDefeated).toBe(true);
      expect(state.players[0].fame).toBe(4); // 2 from Wolf + 2 from Orc

      // End combat
      const result = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      });

      expect(result.state.combat).toBeNull();
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: COMBAT_ENDED,
          victory: true,
          enemiesDefeated: 2,
          enemiesSurvived: 0,
          totalFameGained: 4,
        })
      );
    });
  });

  describe("Mandatory damage assignment", () => {
    it("should require damage assignment before leaving Assign Damage phase", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Skip to Assign Damage phase (don't block)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Try to skip Assign Damage without assigning
      const result = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      });

      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: "INVALID_ACTION",
          reason: expect.stringContaining("Must assign damage"),
        })
      );
    });

    it("should allow leaving Assign Damage phase after assigning damage", () => {
      const player = createTestPlayer({
        hand: [],
        handLimit: 5,
      });
      let state = createTestGameState({ players: [player] });

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Skip to Assign Damage phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Assign damage from unblocked enemy
      state = engine.processAction(state, "player1", {
        type: ASSIGN_DAMAGE_ACTION,
        enemyInstanceId: "enemy_0",
      }).state;

      // Now we can advance to Attack phase
      const result = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      });

      expect(result.state.combat?.phase).toBe(COMBAT_PHASE_ATTACK);
    });

    it("should allow skipping Assign Damage phase when enemy is blocked", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Block phase - block the enemy
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blockValue: 3,
      }).state;

      // Assign Damage phase - should be able to skip (enemy is blocked)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      const result = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      });

      expect(result.state.combat?.phase).toBe(COMBAT_PHASE_ATTACK);
    });

    it("should allow skipping Assign Damage phase when enemy is defeated", () => {
      let state = createTestGameState();

      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC],
      }).state;

      // Defeat enemy in Ranged/Siege phase
      state = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attackValue: 3,
        attackType: COMBAT_TYPE_RANGED,
      }).state;

      expect(state.combat?.enemies[0].isDefeated).toBe(true);

      // Ranged/Siege → Block
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      expect(state.combat?.phase).toBe(COMBAT_PHASE_BLOCK);

      // Block → Assign Damage
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      expect(state.combat?.phase).toBe(COMBAT_PHASE_ASSIGN_DAMAGE);

      // Assign Damage → Attack (should succeed because enemy is defeated, no damage to assign)
      const result = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      });

      expect(result.state.combat?.phase).toBe(COMBAT_PHASE_ATTACK);
    });
  });
});
