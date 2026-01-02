/**
 * Command factory registry
 */

import type { GameState } from "../../state/GameState.js";
import type { PlayerAction, HexCoord } from "@mage-knight/shared";
import type { Command } from "../commands.js";
import { createMoveCommand } from "./moveCommand.js";
import { getEffectiveTerrainCost } from "../modifiers.js";

// Command factory function type
type CommandFactory = (
  state: GameState,
  playerId: string,
  action: PlayerAction
) => Command | null;

// Helper to get move target
function getMoveTarget(action: PlayerAction): HexCoord | null {
  if (action.type === "MOVE" && "target" in action) {
    return action.target;
  }
  return null;
}

// Move command factory
function createMoveCommandFromAction(
  state: GameState,
  playerId: string,
  action: PlayerAction
): Command | null {
  const player = state.players.find((p) => p.id === playerId);
  const target = getMoveTarget(action);

  if (!player?.position || !target) return null;

  const hexKey = `${target.q},${target.r}`;
  const hex = state.map.hexes[hexKey];
  if (!hex) return null;

  const terrainCost = getEffectiveTerrainCost(state, hex.terrain, playerId);

  return createMoveCommand({
    playerId,
    from: player.position,
    to: target,
    terrainCost,
    hadMovedThisTurn: player.hasMovedThisTurn,
  });
}

// Command factory registry
const commandFactoryRegistry: Record<string, CommandFactory> = {
  MOVE: createMoveCommandFromAction,
  // Add more as implemented
};

// Get command for an action
export function createCommandForAction(
  state: GameState,
  playerId: string,
  action: PlayerAction
): Command | null {
  const factory = commandFactoryRegistry[action.type];
  if (!factory) {
    return null;
  }
  return factory(state, playerId, action);
}

// Re-export command types and individual factories
export * from "../commands.js";
export { createMoveCommand, type MoveCommandParams } from "./moveCommand.js";
export {
  createRevealTileCommand,
  type RevealTileCommandParams,
} from "./revealTileCommand.js";
