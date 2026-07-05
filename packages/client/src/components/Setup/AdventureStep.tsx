/**
 * Beat I — Choose the Adventure.
 *
 * A scenario rail (grouped by category) on the left, a cinematic featured panel
 * on the right. The "players at the table" chooser lives HERE, bound to the
 * selected scenario's min/max, so picking the adventure and sizing the table
 * are one logical moment that flows into taking seats.
 */

import { assetUrl } from "../../assets/assetPaths";
import type { SetupScenarioKey, SetupScenarioOption } from "./SetupScreen";

/** Backdrop art per scenario category, sourced from existing site art. */
const SETUP_SCENARIO_ART: Record<string, string> = {
  learning: assetUrl("sites/keep.png"),
  conquest: assetUrl("sites/city_red.png"),
  drills: assetUrl("sites/keep.png"),
};

interface AdventureStepProps {
  readonly scenarios: readonly SetupScenarioOption[];
  readonly categoryLabels: Record<string, string>;
  readonly selectedScenarioKey: SetupScenarioKey;
  readonly scenario: SetupScenarioOption;
  readonly playerCount: number;
  readonly maxPlayers: number;
  readonly isLaunchable: boolean;
  readonly onSelectScenario: (key: SetupScenarioKey) => void;
  readonly onPlayerCountChange: (count: number) => void;
  readonly onNext: () => void;
}

function playersLabel(scenario: SetupScenarioOption): string {
  return scenario.minPlayers === scenario.maxPlayers
    ? `${scenario.maxPlayers}P`
    : `${scenario.minPlayers}–${scenario.maxPlayers}P`;
}

function Plate({ k, v }: { k: string; v: string }) {
  return (
    <div className="setup-plate">
      <span className="setup-plate__key">{k}</span>
      <span className="setup-plate__value">{v}</span>
    </div>
  );
}

export function AdventureStep({
  scenarios,
  categoryLabels,
  selectedScenarioKey,
  scenario,
  playerCount,
  maxPlayers,
  isLaunchable,
  onSelectScenario,
  onPlayerCountChange,
  onNext,
}: AdventureStepProps) {
  // Preserve catalog order while grouping by category.
  const groups: { category: string; items: SetupScenarioOption[] }[] = [];
  for (const option of scenarios) {
    let group = groups.find((g) => g.category === option.category);
    if (!group) {
      group = { category: option.category, items: [] };
      groups.push(group);
    }
    group.items.push(option);
  }

  const soloOnly = scenario.minPlayers === scenario.maxPlayers;
  const art = SETUP_SCENARIO_ART[scenario.category];

  return (
    <div className="setup-beat setup-beat--enter setup-adventure">
      <aside className="setup-adventure__rail">
        <div className="setup-adventure__rail-head">
          <p className="setup-eyebrow">Choose your adventure</p>
          <b>{scenarios.length} scenarios</b>
        </div>
        <div className="setup-adventure__list">
          {groups.map((group) => (
            <div className="setup-adventure__group" key={group.category}>
              <div className="setup-adventure__group-label">
                {categoryLabels[group.category] ?? group.category}
              </div>
              {group.items.map((option) => {
                const isSelected = option.key === selectedScenarioKey;
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={`setup-scenario-item ${isSelected ? "is-selected" : ""}`}
                    onClick={() => onSelectScenario(option.key)}
                    aria-pressed={isSelected}
                  >
                    <span className="setup-scenario-item__top">
                      <span className="setup-scenario-item__name">{option.title}</span>
                      <span className="setup-scenario-item__seats">
                        {playersLabel(option)}
                      </span>
                    </span>
                    <span className="setup-scenario-item__tagline">{option.tagline}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      <section className="setup-feature" aria-label="Scenario detail">
        {art && (
          <div
            className="setup-feature__art"
            style={{ backgroundImage: `url(${art})` }}
            aria-hidden="true"
          />
        )}
        <div className="setup-feature__body">
          <p className="setup-eyebrow">{categoryLabels[scenario.category]}</p>
          <h1 className="setup-feature__title">{scenario.title}</h1>
          <p className="setup-feature__premise">{scenario.premise}</p>

          <div className="setup-feature__stats">
            <Plate k="Players" v={playersLabel(scenario)} />
            <Plate k="Length" v={scenario.rounds} />
            <Plate k="At table" v={scenario.tableLength} />
            <Plate k="Objective" v={scenario.objective} />
          </div>

          <div className="setup-feature__spacer" />

          <div className="setup-feature__seats">
            <div className="setup-feature__seats-head">
              <span className="setup-feature__seats-label">Players at the table</span>
              <span className="setup-feature__seats-hint">
                {soloOnly
                  ? "A solo trial — one seat."
                  : `This scenario seats ${scenario.minPlayers} to ${scenario.maxPlayers}.`}
              </span>
            </div>
            <div className="setup-count" role="group" aria-label="Number of players">
              {Array.from({ length: maxPlayers }, (_, index) => {
                const count = index + 1;
                const available =
                  count >= scenario.minPlayers && count <= scenario.maxPlayers;
                return (
                  <button
                    key={`count-${count}`}
                    type="button"
                    className={`setup-count__button ${playerCount === count ? "is-on" : ""}`}
                    disabled={!available}
                    onClick={() => onPlayerCountChange(count)}
                    aria-pressed={playerCount === count}
                    aria-label={`${count} player${count === 1 ? "" : "s"}`}
                  >
                    <span className="setup-count__n">{count}</span>
                    <span className="setup-count__u">{count === 1 ? "player" : "players"}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="setup-feature__foot">
            <button
              type="button"
              className="setup-button setup-button--primary"
              disabled={!isLaunchable}
              onClick={onNext}
            >
              Take your seats →
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
