/**
 * Command factory registry
 */

import type { GameState } from "../../state/GameState.js";
import type { PlayerAction, HexCoord, HexDirection, CardId } from "@mage-knight/shared";
import {
  MOVE_ACTION,
  END_TURN_ACTION,
  EXPLORE_ACTION,
  PLAY_CARD_ACTION,
  hexKey,
} from "@mage-knight/shared";
import type { Command } from "../commands.js";
import { createMoveCommand } from "./moveCommand.js";
import { createEndTurnCommand } from "./endTurnCommand.js";
import { createExploreCommand } from "./exploreCommand.js";
import { createPlayCardCommand } from "./playCardCommand.js";
import { getEffectiveTerrainCost } from "../modifiers.js";

// Command factory function type
type CommandFactory = (
  state: GameState,
  playerId: string,
  action: PlayerAction
) => Command | null;

// Helper to get move target
function getMoveTarget(action: PlayerAction): HexCoord | null {
  if (action.type === MOVE_ACTION && "target" in action) {
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

  const hex = state.map.hexes[hexKey(target)];
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

// End turn command factory
function createEndTurnCommandFromAction(
  _state: GameState,
  playerId: string,
  _action: PlayerAction
): Command {
  return createEndTurnCommand({ playerId });
}

// Helper to get explore direction
function getExploreDirection(action: PlayerAction): HexDirection | null {
  if (action.type === EXPLORE_ACTION && "direction" in action) {
    return action.direction;
  }
  return null;
}

// Explore command factory
function createExploreCommandFromAction(
  state: GameState,
  playerId: string,
  action: PlayerAction
): Command | null {
  const direction = getExploreDirection(action);
  if (!direction) return null;

  const player = state.players.find((p) => p.id === playerId);
  if (!player?.position) return null;

  // Draw a tile (SIMPLE: take first from countryside, then core)
  const tileId =
    state.map.tileDeck.countryside[0] ?? state.map.tileDeck.core[0];
  if (!tileId) return null;

  return createExploreCommand({
    playerId,
    fromHex: player.position,
    direction,
    tileId,
  });
}

// Helper to get card id from action
function getCardIdFromAction(action: PlayerAction): CardId | null {
  if (action.type === PLAY_CARD_ACTION && "cardId" in action) {
    return action.cardId;
  }
  return null;
}

// Play card command factory
function createPlayCardCommandFromAction(
  state: GameState,
  playerId: string,
  action: PlayerAction
): Command | null {
  const cardId = getCardIdFromAction(action);
  if (!cardId) return null;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;

  const handIndex = player.hand.indexOf(cardId);
  if (handIndex === -1) return null;

  return createPlayCardCommand({
    playerId,
    cardId,
    handIndex,
  });
}

// Command factory registry
const commandFactoryRegistry: Record<string, CommandFactory> = {
  [MOVE_ACTION]: createMoveCommandFromAction,
  [END_TURN_ACTION]: createEndTurnCommandFromAction,
  [EXPLORE_ACTION]: createExploreCommandFromAction,
  [PLAY_CARD_ACTION]: createPlayCardCommandFromAction,
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
export {
  createEndTurnCommand,
  type EndTurnCommandParams,
} from "./endTurnCommand.js";
export {
  createExploreCommand,
  type ExploreCommandParams,
} from "./exploreCommand.js";
export {
  createPlayCardCommand,
  type PlayCardCommandParams,
} from "./playCardCommand.js";
