/**
 * @mage-knight/server
 * Server wrapper that connects the game engine to clients
 */

import {
  type GameState,
  type Player,
  createInitialGameState,
  MageKnightEngine,
  createEngine,
  Hero,
} from "@mage-knight/core";
import {
  LocalConnection,
  type GameConnection,
  type GameEngine,
  type PlayerAction,
  type ActionResult,
  type GameEvent,
  type ClientGameState,
  type ClientPlayer,
  type ClientPlayerUnit,
  type ClientManaToken,
  type EventCallback,
} from "@mage-knight/shared";

// ============================================================================
// State conversion - full GameState to filtered ClientGameState
// ============================================================================

/**
 * Convert full GameState to ClientGameState for a specific player.
 * Filters sensitive information (other players' hands, deck contents, etc.)
 */
export function toClientState(
  state: GameState,
  forPlayerId: string
): ClientGameState {
  return {
    phase: state.phase,
    timeOfDay: state.timeOfDay,
    round: state.round,
    currentPlayerId: state.turnOrder[state.currentPlayerIndex] ?? "",
    turnOrder: state.turnOrder,
    endOfRoundAnnouncedBy: state.endOfRoundAnnouncedBy,

    players: state.players.map((player) =>
      toClientPlayer(player, forPlayerId)
    ),

    map: {
      hexes: Object.fromEntries(
        Object.entries(state.map.hexes).map(([key, hex]) => [
          key,
          {
            coord: hex.coord,
            terrain: hex.terrain,
            tileId: hex.tileId,
            site: hex.site
              ? {
                  type: hex.site.type,
                  owner: hex.site.owner,
                  isConquered: hex.site.isConquered,
                  isBurned: hex.site.isBurned,
                  ...(hex.site.cityColor && { cityColor: hex.site.cityColor }),
                  ...(hex.site.mineColor && { mineColor: hex.site.mineColor }),
                }
              : null,
            enemies: hex.enemies.map(String),
            shieldTokens: [...hex.shieldTokens],
            rampagingEnemies: hex.rampagingEnemies.map(String),
          },
        ])
      ),
      tiles: state.map.tiles,
    },

    source: {
      dice: state.source.dice,
    },

    offers: {
      units: state.offers.units,
      advancedActions: state.offers.advancedActions,
      spells: state.offers.spells,
      commonSkills: state.offers.commonSkills,
      monasteryAdvancedActions: state.offers.monasteryAdvancedActions ?? [],
    },

    combat: state.combat,

    // Only show deck counts, not contents
    deckCounts: {
      spells: state.decks.spells.length,
      advancedActions: state.decks.advancedActions.length,
      artifacts: state.decks.artifacts.length,
      regularUnits: state.decks.regularUnits.length,
      eliteUnits: state.decks.eliteUnits.length,
    },

    woundPileCount: state.woundPileCount,
    scenarioEndTriggered: state.scenarioEndTriggered,
  };
}

function toClientPlayer(player: Player, forPlayerId: string): ClientPlayer {
  const isCurrentPlayer = player.id === forPlayerId;

  return {
    id: player.id,
    heroId: player.hero,
    position: player.position,
    fame: player.fame,
    level: player.level,
    reputation: player.reputation,
    armor: player.armor,
    handLimit: player.handLimit,
    commandTokens: player.commandTokens,

    // Show full hand to self, only count to others
    hand: isCurrentPlayer ? player.hand : player.hand.length,
    deckCount: player.deck.length,
    discardCount: player.discard.length,
    playArea: player.playArea,

    units: player.units.map(
      (unit): ClientPlayerUnit => ({
        cardId: unit.cardId,
        isSpent: unit.isSpent,
        isWounded: unit.isWounded,
        woundCount: unit.woundCount,
      })
    ),

    skills: player.skills,
    crystals: player.crystals,

    movePoints: player.movePoints,
    influencePoints: player.influencePoints,
    pureMana: player.pureMana.map(
      (token): ClientManaToken => ({
        color: token.color,
        source: token.source,
      })
    ),
    hasMovedThisTurn: player.hasMovedThisTurn,
    hasTakenActionThisTurn: player.hasTakenActionThisTurn,
    usedManaFromSource: player.usedManaFromSource,

    knockedOut: player.knockedOut,
    tacticCardId: player.tacticCard,
    roundOrderTokenFaceDown: player.roundOrderTokenFaceDown,
  };
}

// ============================================================================
// Multiplayer game server
// ============================================================================

/**
 * Manages the game and all connected players for multiplayer.
 * Broadcasts events and filtered state to all connected clients.
 */
export class GameServer {
  private engine: MageKnightEngine;
  private state: GameState;
  private readonly connections: Map<string, EventCallback> = new Map();

  constructor() {
    this.engine = createEngine();
    this.state = createInitialGameState();
  }

  /**
   * Initialize game with players.
   */
  initializeGame(playerIds: string[]): void {
    this.state = this.createGameWithPlayers(playerIds);

    // Broadcast initial state to all connected players
    this.broadcastState([
      {
        type: "GAME_STARTED",
        playerCount: playerIds.length,
        scenario: "conquest", // placeholder
      },
    ]);
  }

  /**
   * Player connects and provides their callback for receiving events/state.
   */
  connect(playerId: string, callback: EventCallback): void {
    this.connections.set(playerId, callback);

    // Send current state to newly connected player
    const clientState = toClientState(this.state, playerId);
    callback([], clientState);
  }

  /**
   * Player disconnects.
   */
  disconnect(playerId: string): void {
    this.connections.delete(playerId);
  }

  /**
   * Player sends an action. Broadcasts result to ALL connected players.
   */
  handleAction(playerId: string, action: PlayerAction): void {
    // Process through engine
    const result = this.engine.processAction(this.state, playerId, action);

    // Update server state
    this.state = result.state;

    // Broadcast to all connected players
    this.broadcastState(result.events);
  }

  /**
   * Get current state (for testing/debugging).
   */
  getState(): GameState {
    return this.state;
  }

  /**
   * Get filtered state for a specific player.
   */
  getStateForPlayer(playerId: string): ClientGameState {
    return toClientState(this.state, playerId);
  }

  /**
   * Broadcast events and filtered state to all connections.
   */
  private broadcastState(events: readonly GameEvent[]): void {
    for (const [playerId, callback] of this.connections) {
      const clientState = toClientState(this.state, playerId);
      callback(events, clientState);
    }
  }

  /**
   * Create initial game state with players.
   */
  private createGameWithPlayers(playerIds: string[]): GameState {
    const baseState = createInitialGameState();

    const players = playerIds.map((id, index) => this.createPlayer(id, index));

    return {
      ...baseState,
      phase: "round" as const,
      turnOrder: playerIds,
      currentPlayerIndex: 0,
      players,
    };
  }

  /**
   * Create a player with default values.
   */
  private createPlayer(id: string, index: number): Player {
    const heroes: readonly Hero[] = [
      Hero.Arythea,
      Hero.Tovak,
      Hero.Goldyx,
      Hero.Norowas,
    ];
    const heroIndex = index % heroes.length;
    const hero = heroes[heroIndex] ?? Hero.Arythea;

    return {
      id,
      hero,
      position: null, // Not on map yet
      fame: 0,
      level: 1,
      reputation: 0,
      armor: 2,
      handLimit: 5,
      commandTokens: 1,
      hand: [],
      deck: [],
      discard: [],
      units: [],
      skills: [],
      skillCooldowns: {
        usedThisRound: [],
        usedThisTurn: [],
        usedThisCombat: [],
        activeUntilNextTurn: [],
      },
      crystals: { red: 0, blue: 0, green: 0, white: 0 },
      tacticCard: null,
      knockedOut: false,
      roundOrderTokenFaceDown: false,
      movePoints: 0,
      influencePoints: 0,
      playArea: [],
      pureMana: [],
      usedManaFromSource: false,
      hasMovedThisTurn: false,
      hasTakenActionThisTurn: false,
    };
  }
}

// ============================================================================
// Single-player game instance (uses LocalConnection)
// ============================================================================

export interface GameInstance {
  readonly engine: GameEngine;
  readonly connection: GameConnection;
}

/**
 * Adapter to make MageKnightEngine compatible with GameEngine interface.
 * Used for LocalConnection which expects GameEngine.
 */
class EngineAdapter implements GameEngine {
  private state: GameState;
  private readonly mageKnightEngine: MageKnightEngine;

  constructor(
    private readonly playerId: string
  ) {
    this.mageKnightEngine = createEngine();
    this.state = createInitialGameState();
  }

  processAction(playerId: string, action: PlayerAction): ActionResult {
    const result = this.mageKnightEngine.processAction(
      this.state,
      playerId,
      action
    );
    this.state = result.state;
    return {
      events: result.events,
      state: toClientState(result.state, this.playerId),
    };
  }
}

// ============================================================================
// Factory functions
// ============================================================================

/**
 * Create a single-player game instance with LocalConnection.
 */
export function createGame(playerId: string): GameInstance {
  const engineAdapter = new EngineAdapter(playerId);
  const connection = new LocalConnection(engineAdapter, playerId);

  return {
    engine: engineAdapter,
    connection,
  };
}

/**
 * Create a multiplayer game server.
 */
export function createGameServer(): GameServer {
  return new GameServer();
}

// Re-export types
export type { EventCallback } from "@mage-knight/shared";
