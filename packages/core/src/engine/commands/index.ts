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
  PLAY_CARD_SIDEWAYS_ACTION,
  RESOLVE_CHOICE_ACTION,
  REST_ACTION,
  ENTER_COMBAT_ACTION,
  END_COMBAT_PHASE_ACTION,
  DECLARE_BLOCK_ACTION,
  DECLARE_ATTACK_ACTION,
  ASSIGN_DAMAGE_ACTION,
  hexKey,
} from "@mage-knight/shared";
import type { Command } from "../commands.js";
import { createMoveCommand } from "./moveCommand.js";
import { createEndTurnCommand } from "./endTurnCommand.js";
import { createExploreCommand } from "./exploreCommand.js";
import { createPlayCardCommand } from "./playCardCommand.js";
import { createPlayCardSidewaysCommand } from "./playCardSidewaysCommand.js";
import type { SidewaysAs } from "./playCardSidewaysCommand.js";
import { createResolveChoiceCommand } from "./resolveChoiceCommand.js";
import { createRestCommand } from "./restCommand.js";
import { getEffectiveTerrainCost } from "../modifiers.js";
import {
  createEnterCombatCommand,
  createEndCombatPhaseCommand,
  createDeclareBlockCommand,
  createDeclareAttackCommand,
  createAssignDamageCommand,
} from "./combat/index.js";

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

// Helper to get card id from sideways action
function getCardIdFromSidewaysAction(action: PlayerAction): CardId | null {
  if (action.type === PLAY_CARD_SIDEWAYS_ACTION && "cardId" in action) {
    return action.cardId;
  }
  return null;
}

// Helper to get sideways choice
function getSidewaysChoice(action: PlayerAction): SidewaysAs | null {
  if (action.type === PLAY_CARD_SIDEWAYS_ACTION && "as" in action) {
    return action.as as SidewaysAs;
  }
  return null;
}

// Helper to get powered status and mana source from action
function getPlayCardDetails(action: PlayerAction): {
  powered: boolean;
  manaSource: import("@mage-knight/shared").ManaSourceInfo | undefined;
} | null {
  if (action.type === PLAY_CARD_ACTION) {
    return {
      powered: action.powered,
      manaSource: action.manaSource,
    };
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

  const details = getPlayCardDetails(action);
  if (!details) return null;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;

  const handIndex = player.hand.indexOf(cardId);
  if (handIndex === -1) return null;

  // Only include manaSource if it's defined (exactOptionalPropertyTypes)
  if (details.manaSource) {
    return createPlayCardCommand({
      playerId,
      cardId,
      handIndex,
      powered: details.powered,
      manaSource: details.manaSource,
    });
  }

  return createPlayCardCommand({
    playerId,
    cardId,
    handIndex,
    powered: details.powered,
  });
}

// Play card sideways command factory
function createPlayCardSidewaysCommandFromAction(
  state: GameState,
  playerId: string,
  action: PlayerAction
): Command | null {
  const cardId = getCardIdFromSidewaysAction(action);
  if (!cardId) return null;

  const sidewaysChoice = getSidewaysChoice(action);
  if (!sidewaysChoice) return null;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;

  const handIndex = player.hand.indexOf(cardId);
  if (handIndex === -1) return null;

  return createPlayCardSidewaysCommand({
    playerId,
    cardId,
    handIndex,
    as: sidewaysChoice,
  });
}

// Helper to get choice index from action
function getChoiceIndexFromAction(action: PlayerAction): number | null {
  if (action.type === RESOLVE_CHOICE_ACTION && "choiceIndex" in action) {
    return action.choiceIndex;
  }
  return null;
}

// Resolve choice command factory
function createResolveChoiceCommandFromAction(
  state: GameState,
  playerId: string,
  action: PlayerAction
): Command | null {
  const choiceIndex = getChoiceIndexFromAction(action);
  if (choiceIndex === null) return null;

  const player = state.players.find((p) => p.id === playerId);
  if (!player?.pendingChoice) return null;

  return createResolveChoiceCommand({
    playerId,
    choiceIndex,
    previousPendingChoice: player.pendingChoice,
  });
}

// Rest command factory
function createRestCommandFromAction(
  state: GameState,
  playerId: string,
  action: PlayerAction
): Command | null {
  if (action.type !== REST_ACTION) return null;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;

  return createRestCommand({
    playerId,
    restType: action.restType,
    discardCardIds: action.discardCardIds,
    announceEndOfRound: action.announceEndOfRound ?? false,
    previousHand: [...player.hand],
    previousDiscard: [...player.discard],
  });
}

// Enter combat command factory
function createEnterCombatCommandFromAction(
  _state: GameState,
  playerId: string,
  action: PlayerAction
): Command | null {
  if (action.type !== ENTER_COMBAT_ACTION) return null;
  return createEnterCombatCommand({
    playerId,
    enemyIds: action.enemyIds,
    isAtFortifiedSite: action.isAtFortifiedSite,
  });
}

// End combat phase command factory
function createEndCombatPhaseCommandFromAction(
  _state: GameState,
  playerId: string,
  action: PlayerAction
): Command | null {
  if (action.type !== END_COMBAT_PHASE_ACTION) return null;
  return createEndCombatPhaseCommand({ playerId });
}

// Declare block command factory
function createDeclareBlockCommandFromAction(
  _state: GameState,
  playerId: string,
  action: PlayerAction
): Command | null {
  if (action.type !== DECLARE_BLOCK_ACTION) return null;
  return createDeclareBlockCommand({
    playerId,
    targetEnemyInstanceId: action.targetEnemyInstanceId,
    blocks: action.blocks,
  });
}

// Declare attack command factory
function createDeclareAttackCommandFromAction(
  _state: GameState,
  playerId: string,
  action: PlayerAction
): Command | null {
  if (action.type !== DECLARE_ATTACK_ACTION) return null;
  return createDeclareAttackCommand({
    playerId,
    targetEnemyInstanceIds: action.targetEnemyInstanceIds,
    attacks: action.attacks,
    attackType: action.attackType,
  });
}

// Assign damage command factory
function createAssignDamageCommandFromAction(
  _state: GameState,
  playerId: string,
  action: PlayerAction
): Command | null {
  if (action.type !== ASSIGN_DAMAGE_ACTION) return null;
  return createAssignDamageCommand({
    playerId,
    enemyInstanceId: action.enemyInstanceId,
  });
}

// Command factory registry
const commandFactoryRegistry: Record<string, CommandFactory> = {
  [MOVE_ACTION]: createMoveCommandFromAction,
  [END_TURN_ACTION]: createEndTurnCommandFromAction,
  [EXPLORE_ACTION]: createExploreCommandFromAction,
  [PLAY_CARD_ACTION]: createPlayCardCommandFromAction,
  [PLAY_CARD_SIDEWAYS_ACTION]: createPlayCardSidewaysCommandFromAction,
  [RESOLVE_CHOICE_ACTION]: createResolveChoiceCommandFromAction,
  [REST_ACTION]: createRestCommandFromAction,
  [ENTER_COMBAT_ACTION]: createEnterCombatCommandFromAction,
  [END_COMBAT_PHASE_ACTION]: createEndCombatPhaseCommandFromAction,
  [DECLARE_BLOCK_ACTION]: createDeclareBlockCommandFromAction,
  [DECLARE_ATTACK_ACTION]: createDeclareAttackCommandFromAction,
  [ASSIGN_DAMAGE_ACTION]: createAssignDamageCommandFromAction,
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
export {
  createPlayCardSidewaysCommand,
  type PlayCardSidewaysCommandParams,
  type SidewaysAs,
} from "./playCardSidewaysCommand.js";
export {
  createResolveChoiceCommand,
  type ResolveChoiceCommandParams,
} from "./resolveChoiceCommand.js";
export {
  createRestCommand,
  type RestCommandParams,
} from "./restCommand.js";

// Combat commands
export * from "./combat/index.js";
