/**
 * Elemental Calculation Tests
 *
 * Tests for block efficiency, attack resistances, and elemental interactions.
 */

import { describe, it, expect } from "vitest";
import {
  isBlockEfficient,
  calculateTotalBlock,
  isAttackResisted,
  calculateEffectiveAttack,
  combineResistances,
  NO_RESISTANCES,
  type Resistances,
} from "../elementalCalc.js";
import {
  ELEMENT_PHYSICAL,
  ELEMENT_FIRE,
  ELEMENT_ICE,
  ELEMENT_COLD_FIRE,
} from "@mage-knight/shared";

describe("Block Efficiency", () => {
  describe("isBlockEfficient", () => {
    describe("against Physical attacks", () => {
      it("should be efficient with Physical block", () => {
        expect(isBlockEfficient(ELEMENT_PHYSICAL, ELEMENT_PHYSICAL)).toBe(true);
      });

      it("should be efficient with Fire block", () => {
        expect(isBlockEfficient(ELEMENT_FIRE, ELEMENT_PHYSICAL)).toBe(true);
      });

      it("should be efficient with Ice block", () => {
        expect(isBlockEfficient(ELEMENT_ICE, ELEMENT_PHYSICAL)).toBe(true);
      });

      it("should be efficient with Cold Fire block", () => {
        expect(isBlockEfficient(ELEMENT_COLD_FIRE, ELEMENT_PHYSICAL)).toBe(true);
      });
    });

    describe("against Fire attacks", () => {
      it("should be inefficient with Physical block", () => {
        expect(isBlockEfficient(ELEMENT_PHYSICAL, ELEMENT_FIRE)).toBe(false);
      });

      it("should be inefficient with Fire block (same element)", () => {
        expect(isBlockEfficient(ELEMENT_FIRE, ELEMENT_FIRE)).toBe(false);
      });

      it("should be efficient with Ice block", () => {
        expect(isBlockEfficient(ELEMENT_ICE, ELEMENT_FIRE)).toBe(true);
      });

      it("should be efficient with Cold Fire block", () => {
        expect(isBlockEfficient(ELEMENT_COLD_FIRE, ELEMENT_FIRE)).toBe(true);
      });
    });

    describe("against Ice attacks", () => {
      it("should be inefficient with Physical block", () => {
        expect(isBlockEfficient(ELEMENT_PHYSICAL, ELEMENT_ICE)).toBe(false);
      });

      it("should be efficient with Fire block", () => {
        expect(isBlockEfficient(ELEMENT_FIRE, ELEMENT_ICE)).toBe(true);
      });

      it("should be inefficient with Ice block (same element)", () => {
        expect(isBlockEfficient(ELEMENT_ICE, ELEMENT_ICE)).toBe(false);
      });

      it("should be efficient with Cold Fire block", () => {
        expect(isBlockEfficient(ELEMENT_COLD_FIRE, ELEMENT_ICE)).toBe(true);
      });
    });

    describe("against Cold Fire attacks", () => {
      it("should be inefficient with Physical block", () => {
        expect(isBlockEfficient(ELEMENT_PHYSICAL, ELEMENT_COLD_FIRE)).toBe(false);
      });

      it("should be inefficient with Fire block", () => {
        expect(isBlockEfficient(ELEMENT_FIRE, ELEMENT_COLD_FIRE)).toBe(false);
      });

      it("should be inefficient with Ice block", () => {
        expect(isBlockEfficient(ELEMENT_ICE, ELEMENT_COLD_FIRE)).toBe(false);
      });

      it("should be efficient with Cold Fire block (only Cold Fire)", () => {
        expect(isBlockEfficient(ELEMENT_COLD_FIRE, ELEMENT_COLD_FIRE)).toBe(true);
      });
    });
  });

  describe("calculateTotalBlock", () => {
    it("should count all blocks at full value against Physical", () => {
      const blocks = [
        { element: ELEMENT_PHYSICAL, value: 3 },
        { element: ELEMENT_FIRE, value: 2 },
        { element: ELEMENT_ICE, value: 1 },
      ];
      expect(calculateTotalBlock(blocks, ELEMENT_PHYSICAL)).toBe(6);
    });

    it("should halve inefficient blocks (Physical vs Fire attack)", () => {
      // Physical 6 vs Fire Attack -> 6 / 2 = 3
      const blocks = [{ element: ELEMENT_PHYSICAL, value: 6 }];
      expect(calculateTotalBlock(blocks, ELEMENT_FIRE)).toBe(3);
    });

    it("should combine efficient and inefficient blocks correctly", () => {
      // Ice 3 (efficient) + Physical 6 (inefficient, halved to 3) = 6
      const blocks = [
        { element: ELEMENT_ICE, value: 3 },
        { element: ELEMENT_PHYSICAL, value: 6 },
      ];
      expect(calculateTotalBlock(blocks, ELEMENT_FIRE)).toBe(6);
    });

    it("should round down inefficient blocks", () => {
      // Physical 5 vs Fire Attack -> 5 / 2 = 2.5 -> 2
      const blocks = [{ element: ELEMENT_PHYSICAL, value: 5 }];
      expect(calculateTotalBlock(blocks, ELEMENT_FIRE)).toBe(2);
    });

    it("should handle Cold Fire attacks (only Cold Fire blocks efficient)", () => {
      // Cold Fire 2 (efficient) + Physical 4 (inefficient, halved to 2) + Ice 2 (inefficient, halved to 1) = 5
      const blocks = [
        { element: ELEMENT_COLD_FIRE, value: 2 },
        { element: ELEMENT_PHYSICAL, value: 4 },
        { element: ELEMENT_ICE, value: 2 },
      ];
      expect(calculateTotalBlock(blocks, ELEMENT_COLD_FIRE)).toBe(5);
    });

    it("should handle empty block array", () => {
      expect(calculateTotalBlock([], ELEMENT_PHYSICAL)).toBe(0);
    });

    it("should work with real combat scenario: Physical block vs Fire attack fails", () => {
      // Player has Physical block 6, enemy has Fire Attack 5
      // Effective block: 6 / 2 = 3, which is < 5, so block fails
      const blocks = [{ element: ELEMENT_PHYSICAL, value: 6 }];
      const effectiveBlock = calculateTotalBlock(blocks, ELEMENT_FIRE);
      expect(effectiveBlock).toBe(3);
      expect(effectiveBlock < 5).toBe(true); // Block fails
    });
  });
});

describe("Attack Resistances", () => {
  describe("isAttackResisted", () => {
    it("should resist Physical with Physical resistance", () => {
      const resistances: Resistances = { physical: true, fire: false, ice: false };
      expect(isAttackResisted(ELEMENT_PHYSICAL, resistances)).toBe(true);
    });

    it("should not resist Physical without Physical resistance", () => {
      expect(isAttackResisted(ELEMENT_PHYSICAL, NO_RESISTANCES)).toBe(false);
    });

    it("should resist Fire with Fire resistance", () => {
      const resistances: Resistances = { physical: false, fire: true, ice: false };
      expect(isAttackResisted(ELEMENT_FIRE, resistances)).toBe(true);
    });

    it("should resist Ice with Ice resistance", () => {
      const resistances: Resistances = { physical: false, fire: false, ice: true };
      expect(isAttackResisted(ELEMENT_ICE, resistances)).toBe(true);
    });

    it("should resist Cold Fire only with BOTH Fire AND Ice resistance", () => {
      // Only Fire resistance - not enough
      expect(
        isAttackResisted(ELEMENT_COLD_FIRE, {
          physical: false,
          fire: true,
          ice: false,
        })
      ).toBe(false);

      // Only Ice resistance - not enough
      expect(
        isAttackResisted(ELEMENT_COLD_FIRE, {
          physical: false,
          fire: false,
          ice: true,
        })
      ).toBe(false);

      // Both Fire and Ice resistance - resisted
      expect(
        isAttackResisted(ELEMENT_COLD_FIRE, {
          physical: false,
          fire: true,
          ice: true,
        })
      ).toBe(true);
    });
  });

  describe("calculateEffectiveAttack", () => {
    it("should deal full damage with no resistances", () => {
      const attacks = [{ element: ELEMENT_FIRE, value: 5 }];
      expect(calculateEffectiveAttack(attacks, NO_RESISTANCES)).toBe(5);
    });

    it("should halve resisted attacks", () => {
      const attacks = [{ element: ELEMENT_FIRE, value: 6 }];
      const resistances: Resistances = { physical: false, fire: true, ice: false };
      expect(calculateEffectiveAttack(attacks, resistances)).toBe(3);
    });

    it("should round down halved attacks", () => {
      const attacks = [{ element: ELEMENT_FIRE, value: 5 }];
      const resistances: Resistances = { physical: false, fire: true, ice: false };
      expect(calculateEffectiveAttack(attacks, resistances)).toBe(2);
    });

    it("should combine resisted and unresisted attacks", () => {
      // Physical 4 (resisted, halved to 2) + Fire 6 (not resisted) = 8
      const attacks = [
        { element: ELEMENT_PHYSICAL, value: 4 },
        { element: ELEMENT_FIRE, value: 6 },
      ];
      const resistances: Resistances = { physical: true, fire: false, ice: false };
      expect(calculateEffectiveAttack(attacks, resistances)).toBe(8);
    });

    it("should handle multiple resistance types", () => {
      // Physical 4 (resisted) + Fire 4 (resisted) = 4/2 + 4/2 = 2 + 2 = 4
      const attacks = [
        { element: ELEMENT_PHYSICAL, value: 4 },
        { element: ELEMENT_FIRE, value: 4 },
      ];
      const resistances: Resistances = { physical: true, fire: true, ice: false };
      expect(calculateEffectiveAttack(attacks, resistances)).toBe(4);
    });

    it("should handle Cold Fire against dual resistance", () => {
      // Cold Fire 10 vs Fire+Ice resistance = 10/2 = 5
      const attacks = [{ element: ELEMENT_COLD_FIRE, value: 10 }];
      const resistances: Resistances = { physical: false, fire: true, ice: true };
      expect(calculateEffectiveAttack(attacks, resistances)).toBe(5);
    });

    it("should not halve Cold Fire with only one resistance", () => {
      const attacks = [{ element: ELEMENT_COLD_FIRE, value: 10 }];

      // Fire resistance only
      expect(
        calculateEffectiveAttack(attacks, {
          physical: false,
          fire: true,
          ice: false,
        })
      ).toBe(10);

      // Ice resistance only
      expect(
        calculateEffectiveAttack(attacks, {
          physical: false,
          fire: false,
          ice: true,
        })
      ).toBe(10);
    });
  });

  describe("combineResistances", () => {
    it("should return no resistances for empty array", () => {
      expect(combineResistances([])).toEqual(NO_RESISTANCES);
    });

    it("should return resistances from single enemy", () => {
      const enemies = [
        { resistances: { physical: true, fire: false, ice: false } },
      ];
      expect(combineResistances(enemies)).toEqual({
        physical: true,
        fire: false,
        ice: false,
      });
    });

    it("should combine resistances from multiple enemies with OR logic", () => {
      const enemies = [
        { resistances: { physical: true, fire: false, ice: false } },
        { resistances: { physical: false, fire: true, ice: false } },
        { resistances: { physical: false, fire: false, ice: true } },
      ];
      expect(combineResistances(enemies)).toEqual({
        physical: true,
        fire: true,
        ice: true,
      });
    });

    it("should handle overlapping resistances", () => {
      const enemies = [
        { resistances: { physical: true, fire: true, ice: false } },
        { resistances: { physical: true, fire: false, ice: true } },
      ];
      expect(combineResistances(enemies)).toEqual({
        physical: true,
        fire: true,
        ice: true,
      });
    });
  });
});
