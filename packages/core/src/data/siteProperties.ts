/**
 * Site properties for Mage Knight
 *
 * Defines the inherent properties of each site type.
 * Note: Some properties (like inhabited for Keep/MageTower/City) only apply
 * when the site is owned/conquered - game logic must check ownership too.
 */

import { SiteType } from "../types/map.js";

export interface SiteProperties {
  /** Requires Siege attacks to damage enemies, -1 Rep on assault */
  readonly fortified: boolean;
  /** Can interact with locals for Influence (when owned/conquered for some sites) */
  readonly inhabited: boolean;
  /** Can explore as action, has rewards */
  readonly adventureSite: boolean;
  /** More than one hero can end turn here (when conquered for City) */
  readonly allowsMultipleHeroes: boolean;
}

export const SITE_PROPERTIES: Record<SiteType, SiteProperties> = {
  [SiteType.Village]: {
    fortified: false,
    inhabited: true,
    adventureSite: false,
    allowsMultipleHeroes: false,
  },
  [SiteType.Monastery]: {
    fortified: false,
    inhabited: true,
    adventureSite: false,
    allowsMultipleHeroes: false,
  },
  [SiteType.MagicalGlade]: {
    fortified: false,
    inhabited: false,
    adventureSite: false,
    allowsMultipleHeroes: false,
  },
  [SiteType.Keep]: {
    fortified: true,
    inhabited: true, // when owned
    adventureSite: false,
    allowsMultipleHeroes: false,
  },
  [SiteType.MageTower]: {
    fortified: true,
    inhabited: true, // when conquered
    adventureSite: false,
    allowsMultipleHeroes: false,
  },
  [SiteType.AncientRuins]: {
    fortified: false,
    inhabited: false,
    adventureSite: true,
    allowsMultipleHeroes: false,
  },
  [SiteType.Dungeon]: {
    fortified: false,
    inhabited: false,
    adventureSite: true,
    allowsMultipleHeroes: false,
  },
  [SiteType.Tomb]: {
    fortified: false,
    inhabited: false,
    adventureSite: true,
    allowsMultipleHeroes: false,
  },
  [SiteType.MonsterDen]: {
    fortified: false,
    inhabited: false,
    adventureSite: true,
    allowsMultipleHeroes: false,
  },
  [SiteType.SpawningGrounds]: {
    fortified: false,
    inhabited: false,
    adventureSite: true,
    allowsMultipleHeroes: false,
  },
  [SiteType.Mine]: {
    fortified: false,
    inhabited: false,
    adventureSite: false,
    allowsMultipleHeroes: false,
  },
  [SiteType.Portal]: {
    fortified: false,
    inhabited: false,
    adventureSite: false,
    allowsMultipleHeroes: true,
  },
  [SiteType.City]: {
    fortified: true,
    inhabited: true, // when conquered
    adventureSite: false,
    allowsMultipleHeroes: true, // when conquered
  },

  // Lost Legion expansion sites
  [SiteType.DeepMine]: {
    fortified: false,
    inhabited: false,
    adventureSite: false,
    allowsMultipleHeroes: false,
  },
  [SiteType.Maze]: {
    fortified: false,
    inhabited: false,
    adventureSite: true, // numbered adventure site (6/4/2)
    allowsMultipleHeroes: false,
  },
  [SiteType.Labyrinth]: {
    fortified: false,
    inhabited: false,
    adventureSite: true, // core version of Maze (6/4/2)
    allowsMultipleHeroes: false,
  },
  [SiteType.RefugeeCamp]: {
    fortified: false,
    inhabited: true, // safe site similar to village
    adventureSite: false,
    allowsMultipleHeroes: false,
  },
  [SiteType.VolkaresCamp]: {
    fortified: true, // has walls
    inhabited: false,
    adventureSite: false, // special scenario site
    allowsMultipleHeroes: false,
  },
};

// Helper functions for querying site properties

export function isFortified(siteType: SiteType): boolean {
  return SITE_PROPERTIES[siteType].fortified;
}

export function isInhabited(siteType: SiteType): boolean {
  return SITE_PROPERTIES[siteType].inhabited;
}

export function isAdventureSite(siteType: SiteType): boolean {
  return SITE_PROPERTIES[siteType].adventureSite;
}

export function allowsMultipleHeroes(siteType: SiteType): boolean {
  return SITE_PROPERTIES[siteType].allowsMultipleHeroes;
}
