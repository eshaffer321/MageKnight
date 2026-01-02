/**
 * Movement-specific validators
 */

import type { GameState } from "../../state/GameState.js";
import type { PlayerAction, HexCoord } from "@mage-knight/shared";
import type { ValidationResult } from "./types.js";
import { valid, invalid } from "./types.js";
import { getEffectiveTerrainCost } from "../modifiers.js";

// Helper to get target from action (type guard)
function getMoveTarget(action: PlayerAction): HexCoord | null {
  if (action.type === "MOVE" && "target" in action) {
    return action.target;
  }
  return null;
}

// Helper to check hex adjacency
function isAdjacent(a: HexCoord, b: HexCoord): boolean {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  const adjacentOffsets = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];
  return adjacentOffsets.some((o) => o.q === dq && o.r === dr);
}

// Check player is on the map
export function validatePlayerOnMap(
  state: GameState,
  playerId: string,
  _action: PlayerAction
): ValidationResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return invalid("PLAYER_NOT_FOUND", "Player not found");
  }
  if (!player.position) {
    return invalid("NOT_ON_MAP", "Player is not on the map");
  }
  return valid();
}

// Check target hex is adjacent to player
export function validateTargetAdjacent(
  state: GameState,
  playerId: string,
  action: PlayerAction
): ValidationResult {
  const player = state.players.find((p) => p.id === playerId);
  const target = getMoveTarget(action);

  if (!player?.position || !target) {
    return invalid("INVALID_ACTION", "Invalid move action");
  }

  if (!isAdjacent(player.position, target)) {
    return invalid("NOT_ADJACENT", "Target hex is not adjacent");
  }
  return valid();
}

// Check target hex exists
export function validateTargetHexExists(
  state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  const target = getMoveTarget(action);
  if (!target) {
    return invalid("INVALID_ACTION", "Invalid move action");
  }

  const hexKey = `${target.q},${target.r}`;
  const hex = state.map.hexes[hexKey];
  if (!hex) {
    return invalid("HEX_NOT_FOUND", "Target hex does not exist");
  }
  return valid();
}

// Check terrain is passable
export function validateTerrainPassable(
  state: GameState,
  playerId: string,
  action: PlayerAction
): ValidationResult {
  const target = getMoveTarget(action);
  if (!target) {
    return invalid("INVALID_ACTION", "Invalid move action");
  }

  const hexKey = `${target.q},${target.r}`;
  const hex = state.map.hexes[hexKey];
  if (!hex) {
    return invalid("HEX_NOT_FOUND", "Target hex does not exist");
  }

  const cost = getEffectiveTerrainCost(state, hex.terrain, playerId);
  if (cost === Infinity) {
    return invalid("IMPASSABLE", "Target terrain is impassable");
  }
  return valid();
}

// Check player has enough move points
export function validateEnoughMovePoints(
  state: GameState,
  playerId: string,
  action: PlayerAction
): ValidationResult {
  const player = state.players.find((p) => p.id === playerId);
  const target = getMoveTarget(action);

  if (!player || !target) {
    return invalid("INVALID_ACTION", "Invalid move action");
  }

  const hexKey = `${target.q},${target.r}`;
  const hex = state.map.hexes[hexKey];
  if (!hex) {
    return invalid("HEX_NOT_FOUND", "Target hex does not exist");
  }

  const cost = getEffectiveTerrainCost(state, hex.terrain, playerId);
  if (player.movePoints < cost) {
    return invalid(
      "NOT_ENOUGH_MOVE_POINTS",
      `Need ${cost} move points, have ${player.movePoints}`
    );
  }
  return valid();
}

// TODO: Add these later
// export function validateNotBlockedByRampaging(...) {}
// export function validateNotFortifiedSite(...) {}
// export function validateNoOtherPlayer(...) {}
