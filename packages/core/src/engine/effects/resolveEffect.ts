/**
 * Effect resolver - applies card effects to game state
 *
 * Phase 1: Basic effects only (no mana powering)
 * - GainMove: add move points
 * - GainInfluence: add influence points
 * - GainAttack: accumulate attack value for combat
 * - GainBlock: accumulate block value for combat
 * - GainHealing: track healing (wounds not yet implemented)
 * - Compound: resolve all sub-effects
 * - Choice: requires player selection (Phase 2)
 */

import type { GameState } from "../../state/GameState.js";
import type { CardEffect } from "../../types/cards.js";
import type { Player, AccumulatedAttack } from "../../types/player.js";
import {
  EFFECT_GAIN_MOVE,
  EFFECT_GAIN_INFLUENCE,
  EFFECT_GAIN_ATTACK,
  EFFECT_GAIN_BLOCK,
  EFFECT_GAIN_HEALING,
  EFFECT_COMPOUND,
  EFFECT_CHOICE,
  COMBAT_TYPE_RANGED,
  COMBAT_TYPE_SIEGE,
} from "../../types/effectTypes.js";

export interface EffectResolutionResult {
  readonly state: GameState;
  readonly description: string;
  readonly requiresChoice?: boolean;
}

export function resolveEffect(
  state: GameState,
  playerId: string,
  effect: CardEffect
): EffectResolutionResult {
  const playerIndex = state.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    throw new Error(`Player not found: ${playerId}`);
  }

  const player = state.players[playerIndex];
  if (!player) {
    throw new Error(`Player not found at index: ${playerIndex}`);
  }

  switch (effect.type) {
    case EFFECT_GAIN_MOVE:
      return applyGainMove(state, playerIndex, player, effect.amount);

    case EFFECT_GAIN_INFLUENCE:
      return applyGainInfluence(state, playerIndex, player, effect.amount);

    case EFFECT_GAIN_ATTACK:
      return applyGainAttack(
        state,
        playerIndex,
        player,
        effect.amount,
        effect.combatType
      );

    case EFFECT_GAIN_BLOCK:
      return applyGainBlock(state, playerIndex, player, effect.amount);

    case EFFECT_GAIN_HEALING:
      return applyGainHealing(state, playerIndex, player, effect.amount);

    case EFFECT_COMPOUND:
      return resolveCompoundEffect(state, playerId, effect.effects);

    case EFFECT_CHOICE:
      // Phase 1: Return that choice is required
      // Phase 2: Use choiceIndex from action to pick option
      return {
        state,
        description: "Choice required",
        requiresChoice: true,
      };

    default:
      // Unknown effect type — log and continue
      return {
        state,
        description: "Unhandled effect type",
      };
  }
}

function updatePlayer(
  state: GameState,
  playerIndex: number,
  updatedPlayer: Player
): GameState {
  const players = [...state.players];
  players[playerIndex] = updatedPlayer;
  return { ...state, players };
}

function applyGainMove(
  state: GameState,
  playerIndex: number,
  player: Player,
  amount: number
): EffectResolutionResult {
  const updatedPlayer: Player = {
    ...player,
    movePoints: player.movePoints + amount,
  };

  return {
    state: updatePlayer(state, playerIndex, updatedPlayer),
    description: `Gained ${amount} Move`,
  };
}

function applyGainInfluence(
  state: GameState,
  playerIndex: number,
  player: Player,
  amount: number
): EffectResolutionResult {
  const updatedPlayer: Player = {
    ...player,
    influencePoints: player.influencePoints + amount,
  };

  return {
    state: updatePlayer(state, playerIndex, updatedPlayer),
    description: `Gained ${amount} Influence`,
  };
}

function applyGainAttack(
  state: GameState,
  playerIndex: number,
  player: Player,
  amount: number,
  combatType: typeof COMBAT_TYPE_RANGED | typeof COMBAT_TYPE_SIEGE | "melee"
): EffectResolutionResult {
  const currentAttack = player.combatAccumulator.attack;
  let updatedAttack: AccumulatedAttack;
  let attackTypeName: string;

  switch (combatType) {
    case COMBAT_TYPE_RANGED:
      updatedAttack = { ...currentAttack, ranged: currentAttack.ranged + amount };
      attackTypeName = "Ranged Attack";
      break;
    case COMBAT_TYPE_SIEGE:
      updatedAttack = { ...currentAttack, siege: currentAttack.siege + amount };
      attackTypeName = "Siege Attack";
      break;
    default:
      updatedAttack = { ...currentAttack, normal: currentAttack.normal + amount };
      attackTypeName = "Attack";
      break;
  }

  const updatedPlayer: Player = {
    ...player,
    combatAccumulator: {
      ...player.combatAccumulator,
      attack: updatedAttack,
    },
  };

  return {
    state: updatePlayer(state, playerIndex, updatedPlayer),
    description: `Gained ${amount} ${attackTypeName}`,
  };
}

function applyGainBlock(
  state: GameState,
  playerIndex: number,
  player: Player,
  amount: number
): EffectResolutionResult {
  const updatedPlayer: Player = {
    ...player,
    combatAccumulator: {
      ...player.combatAccumulator,
      block: player.combatAccumulator.block + amount,
    },
  };

  return {
    state: updatePlayer(state, playerIndex, updatedPlayer),
    description: `Gained ${amount} Block`,
  };
}

function applyGainHealing(
  _state: GameState,
  _playerIndex: number,
  _player: Player,
  amount: number
): EffectResolutionResult {
  // Phase 1: Just track the healing value
  // Future: Actually heal wounds from hand/units
  return {
    state: _state,
    description: `Gained ${amount} Healing (wounds not yet implemented)`,
  };
}

function resolveCompoundEffect(
  state: GameState,
  playerId: string,
  effects: readonly CardEffect[]
): EffectResolutionResult {
  let currentState = state;
  const descriptions: string[] = [];

  for (const effect of effects) {
    const result = resolveEffect(currentState, playerId, effect);
    if (result.requiresChoice) {
      return result; // Stop at first choice
    }
    currentState = result.state;
    descriptions.push(result.description);
  }

  return {
    state: currentState,
    description: descriptions.join(", "),
  };
}

// Reverse an effect (for undo)
export function reverseEffect(player: Player, effect: CardEffect): Player {
  switch (effect.type) {
    case EFFECT_GAIN_MOVE:
      return { ...player, movePoints: player.movePoints - effect.amount };

    case EFFECT_GAIN_INFLUENCE:
      return {
        ...player,
        influencePoints: player.influencePoints - effect.amount,
      };

    case EFFECT_GAIN_ATTACK: {
      const attack = { ...player.combatAccumulator.attack };
      switch (effect.combatType) {
        case COMBAT_TYPE_RANGED:
          attack.ranged -= effect.amount;
          break;
        case COMBAT_TYPE_SIEGE:
          attack.siege -= effect.amount;
          break;
        default:
          attack.normal -= effect.amount;
      }
      return {
        ...player,
        combatAccumulator: { ...player.combatAccumulator, attack },
      };
    }

    case EFFECT_GAIN_BLOCK:
      return {
        ...player,
        combatAccumulator: {
          ...player.combatAccumulator,
          block: player.combatAccumulator.block - effect.amount,
        },
      };

    case EFFECT_COMPOUND: {
      let result = player;
      for (const subEffect of effect.effects) {
        result = reverseEffect(result, subEffect);
      }
      return result;
    }

    default:
      return player;
  }
}
