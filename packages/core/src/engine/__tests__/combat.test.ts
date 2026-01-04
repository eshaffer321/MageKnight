/**
 * Combat Phase 2 Tests
 *
 * Tests for combat with elemental attacks, block efficiency, and resistances
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
  ENEMY_FIRE_MAGE,
  ENEMY_ICE_GOLEM,
  ENEMY_FIRE_DRAGON,
  ENEMY_FREEZERS,
  ENEMY_DIGGERS,
  ENEMY_PROWLERS,
  COMBAT_TYPE_MELEE,
  COMBAT_TYPE_RANGED,
  COMBAT_TYPE_SIEGE,
  CARD_WOUND,
  ELEMENT_PHYSICAL,
  ELEMENT_FIRE,
  ELEMENT_ICE,
  ELEMENT_COLD_FIRE,
} from "@mage-knight/shared";
import {
  COMBAT_PHASE_RANGED_SIEGE,
  COMBAT_PHASE_BLOCK,
  COMBAT_PHASE_ASSIGN_DAMAGE,
  COMBAT_PHASE_ATTACK,
} from "../../types/combat.js";

describe("Combat Phase 2", () => {
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

      // Block with Physical 3
      const result = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
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

      // Block with Physical 5 (Orc needs 3)
      const result = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_PHYSICAL, value: 5 }],
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

      // Block with Physical 2 (Orc needs 3)
      const result = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_PHYSICAL, value: 2 }],
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
        blocks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
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
        blocks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
      }).state;

      // Assign Damage phase - skip (enemy is blocked)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack with Physical 3
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
        attackType: COMBAT_TYPE_MELEE,
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
        blocks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
      }).state;

      // Assign Damage phase - skip (enemy is blocked)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack with Physical 2 (Orc has armor 3)
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attacks: [{ element: ELEMENT_PHYSICAL, value: 2 }],
        attackType: COMBAT_TYPE_MELEE,
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
        blocks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
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
        attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
        attackType: COMBAT_TYPE_RANGED,
      });

      expect(result.state.combat?.enemies[0].isDefeated).toBe(true);
    });

    it("should allow ranged attacks in Ranged/Siege phase", () => {
      let state = createTestGameState();

      // Use Prowlers (non-fortified) since ENEMY_ORC is aliased to Diggers (fortified)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_PROWLERS],
      }).state;

      // Still in Ranged/Siege phase
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }], // Prowlers have armor 3
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
        attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
        attackType: COMBAT_TYPE_MELEE,
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
        blocks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
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

      // Use Prowlers (non-fortified, fame 2) to test ranged attacks
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_PROWLERS],
      }).state;

      // Defeat enemy in Ranged/Siege phase with ranged attack
      state = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }], // Prowlers have armor 3
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
          totalFameGained: 2, // Prowlers give 2 fame
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
        blocks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
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

      // Enter combat with Orc (Diggers: attack 3, armor 3, fame 2) and Wolf (Guardsmen: attack 3, armor 4, fame 3)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ORC, ENEMY_WOLF],
      }).state;

      // Ranged/Siege phase - defeat Wolf with ranged attack
      state = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_1"],
        attacks: [{ element: ELEMENT_PHYSICAL, value: 4 }], // Wolf (Guardsmen) has armor 4
        attackType: COMBAT_TYPE_RANGED,
      }).state;

      expect(state.combat?.enemies[1].isDefeated).toBe(true);
      expect(state.players[0].fame).toBe(3); // Wolf (Guardsmen) gives 3 fame

      // Block phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Block the Orc
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
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
        attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
        attackType: COMBAT_TYPE_MELEE,
      }).state;

      expect(state.combat?.enemies[0].isDefeated).toBe(true);
      expect(state.players[0].fame).toBe(5); // 3 from Wolf (Guardsmen) + 2 from Orc (Diggers)

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
          totalFameGained: 5,
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
        blocks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
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

      // Use Prowlers (non-fortified) to allow ranged attack
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_PROWLERS],
      }).state;

      // Defeat enemy in Ranged/Siege phase
      state = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }], // Prowlers have armor 3
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

  describe("Elemental block efficiency", () => {
    it("should halve Physical block against Fire attack", () => {
      let state = createTestGameState();

      // Enter combat with Fire Mage (Fire attack 6, armor 5)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_FIRE_MAGE],
      }).state;

      // Advance to Block phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Block with Physical 8 vs Fire Attack 6
      // Effective block: 8 / 2 = 4, which is < 6, so block fails
      const result = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_PHYSICAL, value: 8 }],
      });

      expect(result.state.combat?.enemies[0].isBlocked).toBe(false);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: BLOCK_FAILED,
          enemyInstanceId: "enemy_0",
          blockValue: 4, // 8 / 2 = 4
          requiredBlock: 6,
        })
      );
    });

    it("should use Ice block efficiently against Fire attack", () => {
      let state = createTestGameState();

      // Enter combat with Fire Mage (Fire attack 6, armor 5)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_FIRE_MAGE],
      }).state;

      // Advance to Block phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Block with Ice 6 vs Fire Attack 6 (efficient)
      const result = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_ICE, value: 6 }],
      });

      expect(result.state.combat?.enemies[0].isBlocked).toBe(true);
    });

    it("should only allow Cold Fire block against Cold Fire attack", () => {
      let state = createTestGameState();

      // Enter combat with Freezers (Cold Fire attack 3, armor 4)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_FREEZERS],
      }).state;

      // Advance to Block phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Block with Physical 6 vs Cold Fire Attack 3
      // Physical is inefficient against Cold Fire: 6 / 2 = 3, which is >= 3, so block succeeds
      const result = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_PHYSICAL, value: 6 }],
      });

      expect(result.state.combat?.enemies[0].isBlocked).toBe(true);
    });

    it("should block Cold Fire with Cold Fire efficiently", () => {
      let state = createTestGameState();

      // Enter combat with Freezers (Cold Fire attack 3, armor 4)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_FREEZERS],
      }).state;

      // Advance to Block phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Block with Cold Fire 3 vs Cold Fire Attack 3 (efficient)
      const result = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_COLD_FIRE, value: 3 }],
      });

      expect(result.state.combat?.enemies[0].isBlocked).toBe(true);
    });

    it("should combine efficient and inefficient blocks", () => {
      let state = createTestGameState();

      // Enter combat with Fire Mage (Fire attack 6, armor 5)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_FIRE_MAGE],
      }).state;

      // Advance to Block phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Block with Ice 4 (efficient) + Physical 4 (inefficient, halved to 2) = 6
      const result = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [
          { element: ELEMENT_ICE, value: 4 },
          { element: ELEMENT_PHYSICAL, value: 4 },
        ],
      });

      expect(result.state.combat?.enemies[0].isBlocked).toBe(true);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: ENEMY_BLOCKED,
          enemyInstanceId: "enemy_0",
          blockValue: 6, // 4 + 4/2 = 6
        })
      );
    });
  });

  describe("Attack resistances", () => {
    it("should halve Fire attack against Fire resistance", () => {
      let state = createTestGameState();

      // Enter combat with Fire Mage (Fire attack 6, Fire resistance, armor 5)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_FIRE_MAGE],
      }).state;

      // Block phase - block the enemy with Ice (efficient vs Fire)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_ICE, value: 6 }],
      }).state;

      // Assign damage (blocked, so skip)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack with Fire 8 vs armor 5 with Fire resistance
      // Effective attack: 8 / 2 = 4, which is < 5, so attack fails
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attacks: [{ element: ELEMENT_FIRE, value: 8 }],
        attackType: COMBAT_TYPE_MELEE,
      });

      expect(result.state.combat?.enemies[0].isDefeated).toBe(false);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: ATTACK_FAILED,
          attackValue: 4, // 8 / 2 = 4
          requiredAttack: 5,
        })
      );
    });

    it("should deal full damage with unresisted element", () => {
      let state = createTestGameState();

      // Enter combat with Fire Mage (Fire attack 6, Fire resistance, armor 5)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_FIRE_MAGE],
      }).state;

      // Block phase - block the enemy with Ice (efficient vs Fire)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_ICE, value: 6 }],
      }).state;

      // Assign damage (blocked, so skip)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack with Ice 5 vs armor 5 - Ice is not resisted
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attacks: [{ element: ELEMENT_ICE, value: 5 }],
        attackType: COMBAT_TYPE_MELEE,
      });

      expect(result.state.combat?.enemies[0].isDefeated).toBe(true);
    });

    it("should halve Physical attack against Physical resistance", () => {
      let state = createTestGameState();

      // Enter combat with Ice Golem (Physical resistance, Ice attack 4, armor 5)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_ICE_GOLEM],
      }).state;

      // Block phase - block with Fire (efficient vs Ice)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_FIRE, value: 4 }],
      }).state;

      // Assign damage (blocked, so skip)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack with Physical 8 vs armor 5 with Physical resistance
      // Effective attack: 8 / 2 = 4, which is < 5, so attack fails
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attacks: [{ element: ELEMENT_PHYSICAL, value: 8 }],
        attackType: COMBAT_TYPE_MELEE,
      });

      expect(result.state.combat?.enemies[0].isDefeated).toBe(false);
    });

    it("should combine resisted and unresisted attacks", () => {
      let state = createTestGameState();

      // Enter combat with Fire Mage (Fire attack 6, Fire resistance, armor 5)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_FIRE_MAGE],
      }).state;

      // Block phase - block the enemy with Ice (efficient vs Fire)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_ICE, value: 6 }],
      }).state;

      // Assign damage (blocked, so skip)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack with Fire 4 (resisted, halved to 2) + Physical 3 (unresisted) = 5
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attacks: [
          { element: ELEMENT_FIRE, value: 4 },
          { element: ELEMENT_PHYSICAL, value: 3 },
        ],
        attackType: COMBAT_TYPE_MELEE,
      });

      expect(result.state.combat?.enemies[0].isDefeated).toBe(true);
    });
  });

  describe("Elemental enemies in combat", () => {
    it("should fight Fire Dragon with Ice attacks", () => {
      let state = createTestGameState();

      // Enter combat with Fire Dragon (Fire attack 9, Fire resistance, armor 7)
      state = engine.processAction(state, "player1", {
        type: ENTER_COMBAT_ACTION,
        enemyIds: [ENEMY_FIRE_DRAGON],
      }).state;

      // Block phase - block with Ice (efficient vs Fire)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;
      state = engine.processAction(state, "player1", {
        type: DECLARE_BLOCK_ACTION,
        targetEnemyInstanceId: "enemy_0",
        blocks: [{ element: ELEMENT_ICE, value: 9 }],
      }).state;

      // Assign damage (blocked, so skip)
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack phase
      state = engine.processAction(state, "player1", {
        type: END_COMBAT_PHASE_ACTION,
      }).state;

      // Attack with Ice 7 - not resisted
      const result = engine.processAction(state, "player1", {
        type: DECLARE_ATTACK_ACTION,
        targetEnemyInstanceIds: ["enemy_0"],
        attacks: [{ element: ELEMENT_ICE, value: 7 }],
        attackType: COMBAT_TYPE_MELEE,
      });

      expect(result.state.combat?.enemies[0].isDefeated).toBe(true);
      expect(result.state.players[0].fame).toBe(8); // Fire Dragon gives 8 fame
    });
  });

  describe("Fortification", () => {
    describe("Enemy ability fortification", () => {
      it("should require Siege attack for fortified enemy in Ranged/Siege phase", () => {
        let state = createTestGameState();

        // Enter combat with Diggers (has ABILITY_FORTIFIED)
        state = engine.processAction(state, "player1", {
          type: ENTER_COMBAT_ACTION,
          enemyIds: [ENEMY_DIGGERS],
        }).state;

        // Try to attack with Ranged in Ranged/Siege phase - should fail
        const result = engine.processAction(state, "player1", {
          type: DECLARE_ATTACK_ACTION,
          targetEnemyInstanceIds: ["enemy_0"],
          attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
          attackType: COMBAT_TYPE_RANGED,
        });

        expect(result.events).toContainEqual(
          expect.objectContaining({
            type: "INVALID_ACTION",
            reason: expect.stringContaining("Fortified enemies"),
          })
        );
      });

      it("should allow Siege attack for fortified enemy in Ranged/Siege phase", () => {
        let state = createTestGameState();

        // Enter combat with Diggers (has ABILITY_FORTIFIED, armor 3)
        state = engine.processAction(state, "player1", {
          type: ENTER_COMBAT_ACTION,
          enemyIds: [ENEMY_DIGGERS],
        }).state;

        // Attack with Siege - should work
        const result = engine.processAction(state, "player1", {
          type: DECLARE_ATTACK_ACTION,
          targetEnemyInstanceIds: ["enemy_0"],
          attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
          attackType: COMBAT_TYPE_SIEGE,
        });

        expect(result.state.combat?.enemies[0].isDefeated).toBe(true);
      });

      it("should allow any attack type for non-fortified enemy", () => {
        let state = createTestGameState();

        // Enter combat with Prowlers (no ABILITY_FORTIFIED)
        state = engine.processAction(state, "player1", {
          type: ENTER_COMBAT_ACTION,
          enemyIds: [ENEMY_PROWLERS],
        }).state;

        // Ranged attack should work for non-fortified enemy
        const result = engine.processAction(state, "player1", {
          type: DECLARE_ATTACK_ACTION,
          targetEnemyInstanceIds: ["enemy_0"],
          attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
          attackType: COMBAT_TYPE_RANGED,
        });

        expect(result.state.combat?.enemies[0].isDefeated).toBe(true);
      });
    });

    describe("Site fortification", () => {
      it("should require Siege attack at fortified site in Ranged/Siege phase", () => {
        let state = createTestGameState();

        // Enter combat at fortified site with Prowlers (no ABILITY_FORTIFIED)
        state = engine.processAction(state, "player1", {
          type: ENTER_COMBAT_ACTION,
          enemyIds: [ENEMY_PROWLERS],
          isAtFortifiedSite: true,
        }).state;

        // Try to attack with Ranged - should fail due to site fortification
        const result = engine.processAction(state, "player1", {
          type: DECLARE_ATTACK_ACTION,
          targetEnemyInstanceIds: ["enemy_0"],
          attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
          attackType: COMBAT_TYPE_RANGED,
        });

        expect(result.events).toContainEqual(
          expect.objectContaining({
            type: "INVALID_ACTION",
            reason: expect.stringContaining("Fortified enemies"),
          })
        );
      });

      it("should allow Siege attack at fortified site", () => {
        let state = createTestGameState();

        // Enter combat at fortified site with Prowlers
        state = engine.processAction(state, "player1", {
          type: ENTER_COMBAT_ACTION,
          enemyIds: [ENEMY_PROWLERS],
          isAtFortifiedSite: true,
        }).state;

        // Siege attack should work
        const result = engine.processAction(state, "player1", {
          type: DECLARE_ATTACK_ACTION,
          targetEnemyInstanceIds: ["enemy_0"],
          attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
          attackType: COMBAT_TYPE_SIEGE,
        });

        expect(result.state.combat?.enemies[0].isDefeated).toBe(true);
      });

      it("should track isAtFortifiedSite in combat state", () => {
        let state = createTestGameState();

        // Enter combat at fortified site
        state = engine.processAction(state, "player1", {
          type: ENTER_COMBAT_ACTION,
          enemyIds: [ENEMY_PROWLERS],
          isAtFortifiedSite: true,
        }).state;

        expect(state.combat?.isAtFortifiedSite).toBe(true);
      });

      it("should default isAtFortifiedSite to false", () => {
        let state = createTestGameState();

        // Enter combat without specifying site
        state = engine.processAction(state, "player1", {
          type: ENTER_COMBAT_ACTION,
          enemyIds: [ENEMY_PROWLERS],
        }).state;

        expect(state.combat?.isAtFortifiedSite).toBe(false);
      });
    });

    describe("Attack phase (melee)", () => {
      it("should allow any attack type in Attack phase regardless of fortification", () => {
        let state = createTestGameState();

        // Enter combat with Diggers (fortified) at fortified site
        state = engine.processAction(state, "player1", {
          type: ENTER_COMBAT_ACTION,
          enemyIds: [ENEMY_DIGGERS],
          isAtFortifiedSite: true,
        }).state;

        // Block phase - block the enemy
        state = engine.processAction(state, "player1", {
          type: END_COMBAT_PHASE_ACTION,
        }).state;
        state = engine.processAction(state, "player1", {
          type: DECLARE_BLOCK_ACTION,
          targetEnemyInstanceId: "enemy_0",
          blocks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
        }).state;

        // Assign Damage phase - skip (enemy is blocked)
        state = engine.processAction(state, "player1", {
          type: END_COMBAT_PHASE_ACTION,
        }).state;

        // Attack phase
        state = engine.processAction(state, "player1", {
          type: END_COMBAT_PHASE_ACTION,
        }).state;

        // Melee attack should work in Attack phase (fortification doesn't apply)
        const result = engine.processAction(state, "player1", {
          type: DECLARE_ATTACK_ACTION,
          targetEnemyInstanceIds: ["enemy_0"],
          attacks: [{ element: ELEMENT_PHYSICAL, value: 3 }],
          attackType: COMBAT_TYPE_MELEE,
        });

        expect(result.state.combat?.enemies[0].isDefeated).toBe(true);
      });
    });
  });
});
