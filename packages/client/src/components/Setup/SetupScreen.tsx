/**
 * Pre-game setup — "The Muster".
 *
 * A single coherent lobby told as three beats, tied together by a persistent
 * progress spine:
 *   I.  Adventure  — choose the scenario AND how many players sit at the table
 *   II. Party      — take your seats: each seat fills with a hero, one by one
 *   III. March      — review the assembled party, then launch
 *
 * IMPORTANT (do not change without updating tests):
 *   The exported pure helpers `createGameConfigForSetup` and
 *   `getSetupScenarioLaunchConfig`, the `SetupScenarioKey` union, and every
 *   entry in `SETUP_SCENARIOS` (keys, categories, min/max players,
 *   launchConfig / launchVariants → engine scenario ids) are load-bearing.
 *   `__tests__/hotseatSetup.test.tsx` imports them. The redesign is presentational:
 *   only the rendered JSX, copy, and CSS changed.
 */

import { useCallback, useMemo, useState } from "react";
import type { GameConfig, HeroId } from "@mage-knight/shared";
import {
  ALL_HEROES,
  GAME_LAUNCH_MODE_HOTSEAT,
  GAME_LAUNCH_MODE_SOLO,
  GAME_SEAT_CONTROLLER_LOCAL,
  SCENARIO_BLITZ_CONQUEST_2P,
  SCENARIO_BLITZ_CONQUEST_3P,
  SCENARIO_BLITZ_CONQUEST_4P,
  SCENARIO_DISPLAY_NAMES,
  SCENARIO_FIRST_RECONNAISSANCE,
  SCENARIO_FULL_CONQUEST_2P,
  SCENARIO_FULL_CONQUEST_3P,
  SCENARIO_FULL_CONQUEST_4P,
} from "@mage-knight/shared";
import { SetupSpine, type SetupStepKey } from "./SetupSpine";
import { AdventureStep } from "./AdventureStep";
import { MusterStep } from "./MusterStep";
import { MarchReview } from "./MarchReview";
import "./SetupScreen.css";

const SETUP_MAX_PLAYERS = 4;
const SETUP_PLAYER_ID_PREFIX = "player_" as const;
const SETUP_SCENARIO_STANDARD = "standard" as const;
const SETUP_SCENARIO_FULL_CONQUEST = "full_conquest" as const;
const SETUP_SCENARIO_BLITZ_CONQUEST = "blitz_conquest" as const;
const SETUP_SCENARIO_RECON_EXPLORE = "recon_explore" as const;
const SETUP_SCENARIO_EXPLORATION = "exploration" as const;
const SETUP_SCENARIO_EXPLORATION_TINY = "exploration_tiny" as const;
const SETUP_CATEGORY_LEARNING = "learning" as const;
const SETUP_CATEGORY_CONQUEST = "conquest" as const;
const SETUP_CATEGORY_DRILLS = "drills" as const;

export type SetupScenarioKey =
  | typeof SETUP_SCENARIO_STANDARD
  | typeof SETUP_SCENARIO_FULL_CONQUEST
  | typeof SETUP_SCENARIO_BLITZ_CONQUEST
  | typeof SETUP_SCENARIO_RECON_EXPLORE
  | typeof SETUP_SCENARIO_EXPLORATION
  | typeof SETUP_SCENARIO_EXPLORATION_TINY;

type SetupScenarioCategory =
  | typeof SETUP_CATEGORY_LEARNING
  | typeof SETUP_CATEGORY_CONQUEST
  | typeof SETUP_CATEGORY_DRILLS;

type SetupPlayerCount = 1 | 2 | 3 | 4;

export interface SetupScenarioLaunchConfig {
  readonly scenarioId: GameConfig["scenarioId"];
  readonly serverScenario?: string;
}

/** Player-facing grouping label for each category, shown in the adventure rail. */
export const SETUP_CATEGORY_LABELS: Record<SetupScenarioCategory, string> = {
  [SETUP_CATEGORY_LEARNING]: "Learning the Land",
  [SETUP_CATEGORY_CONQUEST]: "Conquest",
  [SETUP_CATEGORY_DRILLS]: "Training Grounds",
};

export interface SetupScenarioOption {
  readonly key: SetupScenarioKey;
  readonly category: SetupScenarioCategory;
  readonly title: string;
  /** One-line objective + length, shown in the rail list. */
  readonly tagline: string;
  /** Player-facing premise paragraph, shown in the featured panel. */
  readonly premise: string;
  readonly launchConfig?: SetupScenarioLaunchConfig;
  readonly launchVariants?: Partial<Record<SetupPlayerCount, SetupScenarioLaunchConfig>>;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly rounds: string;
  readonly tableLength: string;
  readonly objective: string;
}

/**
 * Scenario catalog. Keys, categories, player bounds, and launch mappings are
 * the engine contract — copy (title/tagline/premise/length) is free to edit.
 */
export const SETUP_SCENARIOS: readonly SetupScenarioOption[] = [
  {
    key: SETUP_SCENARIO_STANDARD,
    category: SETUP_CATEGORY_LEARNING,
    title: SCENARIO_DISPLAY_NAMES[SCENARIO_FIRST_RECONNAISSANCE],
    tagline: "Reveal a city · 4 rounds",
    premise:
      "A lone scout slips into the wild fringe of the realm. Learn the rhythm of day and night, master your deck, and uncover the first great city before the rounds run out.",
    launchConfig: { scenarioId: SCENARIO_FIRST_RECONNAISSANCE },
    minPlayers: 1,
    maxPlayers: 1,
    rounds: "4 rounds",
    tableLength: "~45 min",
    objective: "Reveal a city",
  },
  {
    key: SETUP_SCENARIO_FULL_CONQUEST,
    category: SETUP_CATEGORY_CONQUEST,
    title: "Full Conquest",
    tagline: "Conquer every city · 6 rounds",
    premise:
      "The Council's full campaign. Two to four Mage Knights race across a sprawling map, building strength to storm and hold every city on the board before their rivals do.",
    launchVariants: {
      2: { scenarioId: SCENARIO_FULL_CONQUEST_2P },
      3: { scenarioId: SCENARIO_FULL_CONQUEST_3P },
      4: { scenarioId: SCENARIO_FULL_CONQUEST_4P },
    },
    minPlayers: 2,
    maxPlayers: 4,
    rounds: "6 rounds",
    tableLength: "2–3 hrs",
    objective: "Conquer every city",
  },
  {
    key: SETUP_SCENARIO_BLITZ_CONQUEST,
    category: SETUP_CATEGORY_CONQUEST,
    title: "Blitz Conquest",
    tagline: "First to conquer · 4 rounds",
    premise:
      "A shorter, hotter war. Fame and the source of mana run faster here — strike early, strike hard, and seize the cities before anyone else can muster their strength.",
    launchVariants: {
      2: { scenarioId: SCENARIO_BLITZ_CONQUEST_2P },
      3: { scenarioId: SCENARIO_BLITZ_CONQUEST_3P },
      4: { scenarioId: SCENARIO_BLITZ_CONQUEST_4P },
    },
    minPlayers: 2,
    maxPlayers: 4,
    rounds: "4 rounds",
    tableLength: "60–90 min",
    objective: "First to conquer",
  },
  {
    key: SETUP_SCENARIO_RECON_EXPLORE,
    category: SETUP_CATEGORY_DRILLS,
    title: "Wedge of Exploration",
    tagline: "Chart the wilds · no enemies",
    premise:
      "No enemies, no clock pressure — just you, the map, and your movement deck. A calm trial for learning how tiles reveal and how to read the terrain.",
    launchConfig: {
      scenarioId: SCENARIO_FIRST_RECONNAISSANCE,
      serverScenario: SETUP_SCENARIO_RECON_EXPLORE,
    },
    minPlayers: 1,
    maxPlayers: 1,
    rounds: "Open drill",
    tableLength: "~20 min",
    objective: "Reach the city",
  },
  {
    key: SETUP_SCENARIO_EXPLORATION,
    category: SETUP_CATEGORY_DRILLS,
    title: "Countryside Drill",
    tagline: "Reveal a city · compact route",
    premise:
      "A compact countryside route for fast map and movement checks — a short, enemy-free drill that still exercises every reveal decision.",
    launchConfig: {
      scenarioId: SCENARIO_FIRST_RECONNAISSANCE,
      serverScenario: SETUP_SCENARIO_EXPLORATION,
    },
    minPlayers: 1,
    maxPlayers: 1,
    rounds: "Short drill",
    tableLength: "~12 min",
    objective: "Reveal a city",
  },
  {
    key: SETUP_SCENARIO_EXPLORATION_TINY,
    category: SETUP_CATEGORY_DRILLS,
    title: "Tiny Exploration",
    tagline: "Smoke test · smallest map",
    premise:
      "The smallest supported setup — the fastest way from the muster to live board interaction. Handy for a quick smoke test.",
    launchConfig: {
      scenarioId: SCENARIO_FIRST_RECONNAISSANCE,
      serverScenario: SETUP_SCENARIO_EXPLORATION_TINY,
    },
    minPlayers: 1,
    maxPlayers: 1,
    rounds: "Tiny drill",
    tableLength: "~5 min",
    objective: "Reveal a city",
  },
] as const;

function getSetupScenario(key: SetupScenarioKey): SetupScenarioOption {
  return SETUP_SCENARIOS.find((scenario) => scenario.key === key) ?? SETUP_SCENARIOS[0]!;
}

function clampPlayerCount(count: number, scenario: SetupScenarioOption): number {
  return Math.min(Math.max(count, scenario.minPlayers), scenario.maxPlayers);
}

function toSetupPlayerCount(count: number): SetupPlayerCount {
  return Math.min(Math.max(count, 1), SETUP_MAX_PLAYERS) as SetupPlayerCount;
}

export function getSetupScenarioLaunchConfig(
  scenarioKey: SetupScenarioKey,
  playerCount: number
): SetupScenarioLaunchConfig | undefined {
  return getLaunchConfig(getSetupScenario(scenarioKey), playerCount);
}

function getLaunchConfig(
  scenario: SetupScenarioOption,
  playerCount: number
): SetupScenarioLaunchConfig | undefined {
  return scenario.launchVariants?.[toSetupPlayerCount(playerCount)] ?? scenario.launchConfig;
}

export function createGameConfigForSetup(
  playerCount: number,
  selectedHeroes: readonly (HeroId | null)[],
  launchConfig: SetupScenarioLaunchConfig
): GameConfig | null {
  const heroIds = selectedHeroes.slice(0, playerCount);
  if (heroIds.length !== playerCount || heroIds.some((hero) => hero == null)) {
    return null;
  }

  const playerIds = Array.from(
    { length: playerCount },
    (_, i) => `${SETUP_PLAYER_ID_PREFIX}${i}`
  );
  const seats = heroIds.map((heroId, index) => ({
    playerId: playerIds[index]!,
    heroId: heroId!,
    controller: GAME_SEAT_CONTROLLER_LOCAL,
  }));

  const config: GameConfig = {
    launchMode: playerCount > 1 ? GAME_LAUNCH_MODE_HOTSEAT : GAME_LAUNCH_MODE_SOLO,
    playerIds,
    heroIds: heroIds as HeroId[],
    seats,
    scenarioId: launchConfig.scenarioId,
  };

  if (!launchConfig.serverScenario) return config;
  return { ...config, serverScenario: launchConfig.serverScenario };
}

interface SetupScreenProps {
  /** Callback when setup is complete and game should start. */
  onComplete: (config: GameConfig) => void;
}

const STEP_ORDER: readonly SetupStepKey[] = ["adventure", "party", "march"];

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [step, setStep] = useState<SetupStepKey>("adventure");
  /** Highest step the player has unlocked — gates spine navigation. */
  const [maxStep, setMaxStep] = useState(0);
  const [selectedScenarioKey, setSelectedScenarioKey] =
    useState<SetupScenarioKey>(SETUP_SCENARIO_STANDARD);
  const [playerCount, setPlayerCount] = useState(1);
  const [selectedHeroes, setSelectedHeroes] = useState<(HeroId | null)[]>([null]);
  /** Which seat the roster is currently filling (-1 = none / all full). */
  const [activeSeatIndex, setActiveSeatIndex] = useState(0);

  const scenario = getSetupScenario(selectedScenarioKey);
  const stepIndex = STEP_ORDER.indexOf(step);
  const allSelected = useMemo(
    () => selectedHeroes.length === playerCount && selectedHeroes.every((h) => h !== null),
    [selectedHeroes, playerCount]
  );
  const filledCount = selectedHeroes.filter((h) => h !== null).length;
  const launchConfig = getLaunchConfig(scenario, playerCount);
  const isLaunchable = Boolean(launchConfig);

  const resizeSeats = useCallback((count: number) => {
    setSelectedHeroes((prev) =>
      Array.from({ length: count }, (_, index) => prev[index] ?? null)
    );
  }, []);

  const handleScenarioChange = useCallback(
    (key: SetupScenarioKey) => {
      const next = getSetupScenario(key);
      setSelectedScenarioKey(key);
      setPlayerCount((current) => {
        const nextCount = clampPlayerCount(current, next);
        resizeSeats(nextCount);
        return nextCount;
      });
    },
    [resizeSeats]
  );

  const handlePlayerCountChange = useCallback(
    (count: number) => {
      const nextCount = clampPlayerCount(count, scenario);
      setPlayerCount(nextCount);
      resizeSeats(nextCount);
    },
    [scenario, resizeSeats]
  );

  /** Advance from Adventure → Party, focusing the first open seat. */
  const enterParty = useCallback(() => {
    resizeSeats(playerCount);
    setSelectedHeroes((seats) => {
      const firstFree = seats.findIndex((s) => s == null);
      setActiveSeatIndex(firstFree >= 0 ? firstFree : 0);
      return seats;
    });
    setStep("party");
    setMaxStep((m) => Math.max(m, 1));
  }, [playerCount, resizeSeats]);

  const assignHero = useCallback(
    (hero: HeroId) => {
      setSelectedHeroes((prev) => {
        if (activeSeatIndex < 0) return prev;
        const next = [...prev];
        next[activeSeatIndex] = hero;
        const firstFree = next.findIndex((s) => s == null);
        setActiveSeatIndex(firstFree);
        return next;
      });
    },
    [activeSeatIndex]
  );

  const clearSeat = useCallback((index: number) => {
    setSelectedHeroes((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setActiveSeatIndex(index);
  }, []);

  const enterMarch = useCallback(() => {
    setStep("march");
    setMaxStep((m) => Math.max(m, 2));
  }, []);

  const goToStep = useCallback(
    (index: number) => {
      if (index <= maxStep) setStep(STEP_ORDER[index]!);
    },
    [maxStep]
  );

  const handleLaunch = useCallback(() => {
    if (!allSelected || !launchConfig) return;
    const config = createGameConfigForSetup(playerCount, selectedHeroes, launchConfig);
    if (config) onComplete(config);
  }, [allSelected, launchConfig, playerCount, selectedHeroes, onComplete]);

  return (
    <div className="setup-screen">
      <SetupSpine
        stepIndex={stepIndex}
        maxStep={maxStep}
        scenarioTitle={scenario.title}
        playerCount={playerCount}
        filledCount={filledCount}
        activeSeatIndex={activeSeatIndex}
        onGoToStep={goToStep}
      />

      {step === "adventure" && (
        <AdventureStep
          scenarios={SETUP_SCENARIOS}
          categoryLabels={SETUP_CATEGORY_LABELS}
          selectedScenarioKey={selectedScenarioKey}
          scenario={scenario}
          playerCount={playerCount}
          maxPlayers={SETUP_MAX_PLAYERS}
          isLaunchable={isLaunchable}
          onSelectScenario={handleScenarioChange}
          onPlayerCountChange={handlePlayerCountChange}
          onNext={enterParty}
        />
      )}

      {step === "party" && (
        <MusterStep
          availableHeroes={ALL_HEROES}
          seats={selectedHeroes}
          playerCount={playerCount}
          activeSeatIndex={activeSeatIndex}
          allSelected={allSelected}
          onSelectSeat={setActiveSeatIndex}
          onAssignHero={assignHero}
          onClearSeat={clearSeat}
          onNext={enterMarch}
        />
      )}

      {step === "march" && (
        <MarchReview
          scenario={scenario}
          seats={selectedHeroes}
          isLaunchable={isLaunchable}
          onBack={() => setStep("party")}
          onLaunch={handleLaunch}
        />
      )}
    </div>
  );
}
