/**
 * Hero types and definitions for Mage Knight
 */

import type { CardId, SkillId, ManaColor } from "@mage-knight/shared";
import { BASIC_MANA_BLUE, BASIC_MANA_GREEN, BASIC_MANA_RED, BASIC_MANA_WHITE } from "@mage-knight/shared";

export enum Hero {
  Arythea = "arythea",
  Tovak = "tovak",
  Goldyx = "goldyx",
  Norowas = "norowas",
  // Krang expansion heroes
  Wolfhawk = "wolfhawk",
  Braevalar = "braevalar",
}

export interface HeroDefinition {
  readonly id: Hero;
  readonly name: string;
  readonly startingCards: readonly CardId[];
  readonly skills: readonly SkillId[];
  readonly crystalColors: readonly [ManaColor, ManaColor, ManaColor]; // for dummy player
}

// Hero definitions will be populated when cards/skills are defined
export const HEROES: Record<Hero, HeroDefinition> = {
  [Hero.Arythea]: {
    id: Hero.Arythea,
    name: "Arythea",
    startingCards: [] as CardId[],
    skills: [] as SkillId[],
    crystalColors: [BASIC_MANA_RED, BASIC_MANA_RED, BASIC_MANA_WHITE],
  },
  [Hero.Tovak]: {
    id: Hero.Tovak,
    name: "Tovak",
    startingCards: [] as CardId[],
    skills: [] as SkillId[],
    crystalColors: [BASIC_MANA_BLUE, BASIC_MANA_RED, BASIC_MANA_WHITE],
  },
  [Hero.Goldyx]: {
    id: Hero.Goldyx,
    name: "Goldyx",
    startingCards: [] as CardId[],
    skills: [] as SkillId[],
    crystalColors: [BASIC_MANA_BLUE, BASIC_MANA_BLUE, BASIC_MANA_WHITE],
  },
  [Hero.Norowas]: {
    id: Hero.Norowas,
    name: "Norowas",
    startingCards: [] as CardId[],
    skills: [] as SkillId[],
    crystalColors: [BASIC_MANA_GREEN, BASIC_MANA_GREEN, BASIC_MANA_WHITE],
  },
  [Hero.Wolfhawk]: {
    id: Hero.Wolfhawk,
    name: "Wolfhawk",
    startingCards: [] as CardId[],
    skills: [] as SkillId[],
    crystalColors: [BASIC_MANA_GREEN, BASIC_MANA_WHITE, BASIC_MANA_WHITE],
  },
  [Hero.Braevalar]: {
    id: Hero.Braevalar,
    name: "Braevalar",
    startingCards: [] as CardId[],
    skills: [] as SkillId[],
    crystalColors: [BASIC_MANA_GREEN, BASIC_MANA_BLUE, BASIC_MANA_WHITE],
  },
};
