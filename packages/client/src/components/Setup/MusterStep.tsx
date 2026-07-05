/**
 * Beat II — Take Your Seats (the heart of the muster).
 *
 * Player count and hero pick are unified into one moment: a row of seats across
 * the top fills one hero at a time. The active seat is spotlit; selecting a hero
 * from the roster filmstrip (bottom) seats them and advances to the next open
 * seat. A persistent status bar always says where you are and what's next.
 */

import { useMemo, useState } from "react";
import type { HeroId } from "@mage-knight/shared";
import { HERO_LORE, HERO_NAMES } from "@mage-knight/shared";
import { getHeroTokenUrl } from "../../assets/assetPaths";

type ManaAffinity = "red" | "blue" | "green" | "white";

/**
 * Short title + mana affinity aren't tracked in @mage-knight/shared today
 * (HERO_LORE.title is a full display line, e.g. "Arythea, the Blood Cultist").
 * Kept local until the shared package grows a per-hero affinity export.
 */
const HERO_SHORT_TITLE: Record<HeroId, string> = {
  arythea: "the Blood Cultist",
  tovak: "Head of the Ninth Circle",
  goldyx: "Mightiest of the Draconum",
  norowas: "Greatest of the Elf-Lords",
  wolfhawk: "the Silent Blade",
  krang: "the Reforged Shaman",
  braevalar: "the Storm Druid",
};

const HERO_MANA: Record<HeroId, ManaAffinity> = {
  arythea: "red",
  tovak: "blue",
  goldyx: "green",
  norowas: "white",
  wolfhawk: "red",
  krang: "green",
  braevalar: "blue",
};

const MANA_LABEL: Record<ManaAffinity, string> = {
  red: "Red affinity",
  blue: "Blue affinity",
  green: "Green affinity",
  white: "White affinity",
};

const MANA_COLOR: Record<ManaAffinity, string> = {
  red: "var(--mk-mana-red, #d6483b)",
  blue: "var(--mk-mana-blue, #4a7fd6)",
  green: "var(--mk-mana-green, #4caf6a)",
  white: "var(--mk-mana-white, #e8e2d0)",
};

interface HeroMeta {
  readonly name: string;
  readonly title: string;
  readonly mana: ManaAffinity;
  readonly flavor: string;
}

function metaFor(heroId: HeroId): HeroMeta {
  return {
    name: HERO_NAMES[heroId],
    title: HERO_SHORT_TITLE[heroId],
    mana: HERO_MANA[heroId],
    flavor: HERO_LORE[heroId].flavorText,
  };
}

interface MusterStepProps {
  readonly availableHeroes: readonly HeroId[];
  readonly seats: readonly (HeroId | null)[];
  readonly playerCount: number;
  readonly activeSeatIndex: number;
  readonly allSelected: boolean;
  readonly onSelectSeat: (index: number) => void;
  readonly onAssignHero: (hero: HeroId) => void;
  readonly onClearSeat: (index: number) => void;
  readonly onNext: () => void;
}

export function MusterStep({
  availableHeroes,
  seats,
  playerCount,
  activeSeatIndex,
  allSelected,
  onSelectSeat,
  onAssignHero,
  onClearSeat,
  onNext,
}: MusterStepProps) {
  // Scrubbing the roster (hover/focus) previews a hero in the spotlight without
  // committing anything — mirrors a fighting-game character-select screen where
  // browsing and locking in are distinct gestures.
  const [previewHeroId, setPreviewHeroId] = useState<HeroId | null>(null);

  // The hero featured in the spotlight: whatever's being previewed, else the
  // active seat's pick, else the first hero not yet seated, else the first hero.
  const defaultSpotlightId = useMemo<HeroId>(() => {
    const active = activeSeatIndex >= 0 ? seats[activeSeatIndex] : null;
    if (active) return active;
    const free = availableHeroes.find((h) => !seats.includes(h));
    return free ?? availableHeroes[0]!;
  }, [activeSeatIndex, seats, availableHeroes]);

  const spotlightId = previewHeroId ?? defaultSpotlightId;
  const spotlight = metaFor(spotlightId);
  const spotlightSeat = seats.indexOf(spotlightId);
  const spotlightTaken = spotlightSeat >= 0;

  // Committing to a seat (assign/select/clear) drops any stale hover preview
  // so the spotlight snaps back to reflect the new committed state.
  const selectSeat = (index: number) => {
    setPreviewHeroId(null);
    onSelectSeat(index);
  };
  const assignHero = (hero: HeroId) => {
    setPreviewHeroId(null);
    onAssignHero(hero);
  };
  const clearSeat = (index: number) => {
    setPreviewHeroId(null);
    onClearSeat(index);
  };

  return (
    <div
      className="setup-beat setup-beat--enter setup-muster"
      onMouseLeave={() => setPreviewHeroId(null)}
    >
      {/* seats */}
      <div className="setup-seats" aria-label="Player seats">
        {Array.from({ length: playerCount }, (_, index) => {
          const heroId = seats[index] ?? null;
          const meta = heroId ? metaFor(heroId) : null;
          const isActive = index === activeSeatIndex;
          return (
            <button
              key={`seat-${index}`}
              type="button"
              className={`setup-seat ${heroId ? "is-filled" : ""} ${
                isActive ? "is-active" : ""
              }`}
              onClick={() => selectSeat(index)}
              onMouseEnter={() => heroId && setPreviewHeroId(heroId)}
              onFocus={() => heroId && setPreviewHeroId(heroId)}
              aria-label={`Seat ${index + 1}${meta ? `: ${meta.name}` : ": open"}`}
            >
              <span className="setup-seat__no">Seat {index + 1}</span>
              <span className="setup-seat__art">
                {heroId ? (
                  <img
                    key={heroId}
                    className="setup-seat__token"
                    src={getHeroTokenUrl(heroId)}
                    alt={meta?.name ?? heroId}
                  />
                ) : (
                  <span className="setup-seat__empty" aria-hidden="true">
                    <VacantGlyph />
                  </span>
                )}
              </span>
              <span className={`setup-seat__name ${heroId ? "" : "is-vacant"}`}>
                {meta ? meta.name : "Open seat"}
              </span>
              <span className="setup-seat__role">Player {index + 1}</span>
              {heroId && (
                <span
                  className="setup-seat__remove"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    clearSeat(index);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      clearSeat(index);
                    }
                  }}
                  aria-label={`Remove ${meta?.name ?? "hero"} from seat ${index + 1}`}
                >
                  ×
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* roster spotlight */}
      <div className="setup-roster">
        <div
          className="setup-roster__bg"
          key={`bg-${spotlightId}`}
          style={{ backgroundImage: `url(${getHeroTokenUrl(spotlightId)})` }}
          aria-hidden="true"
        />
        <div className="setup-roster__scrim" aria-hidden="true" />
        <div className="setup-roster__inner">
          <div className="setup-roster__figure">
            <img
              key={spotlightId}
              className="setup-roster__token"
              src={getHeroTokenUrl(spotlightId)}
              alt={spotlight.name}
            />
          </div>
          <div className="setup-roster__detail" key={`detail-${spotlightId}`}>
            <span className="setup-roster__mana">
              <i style={{ color: MANA_COLOR[spotlight.mana], background: MANA_COLOR[spotlight.mana] }} />
              <span>{MANA_LABEL[spotlight.mana]}</span>
            </span>
            <h2 className="setup-roster__name">{spotlight.name}</h2>
            <p className="setup-roster__title">{spotlight.title}</p>
            <p className="setup-roster__lore">{spotlight.flavor}</p>
            <div className="setup-roster__cta">
              {spotlightTaken ? (
                <>
                  <span className="setup-roster__taken">Seated — Player {spotlightSeat + 1}</span>
                  <button
                    type="button"
                    className="setup-button setup-button--ghost"
                    onClick={() => clearSeat(spotlightSeat)}
                  >
                    Open this seat
                  </button>
                </>
              ) : activeSeatIndex >= 0 ? (
                <button
                  type="button"
                  className="setup-button setup-button--primary"
                  onClick={() => assignHero(spotlightId)}
                >
                  Seat as Player {activeSeatIndex + 1}
                </button>
              ) : (
                <span className="setup-roster__taken setup-roster__taken--muted">
                  Every seat is filled
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* status + advance bar */}
      <div className="setup-muster__bar">
        <span className="setup-muster__status">
          {allSelected ? (
            <>
              <b>Party assembled.</b> {playerCount} {playerCount === 1 ? "knight" : "knights"} ready to march.
            </>
          ) : activeSeatIndex >= 0 ? (
            <>
              <b>Seating Player {activeSeatIndex + 1}.</b> Choose a hero from the roster below.
            </>
          ) : (
            <>Select an open seat to assign a hero.</>
          )}
        </span>
        <button
          type="button"
          className="setup-button setup-button--primary"
          disabled={!allSelected}
          onClick={onNext}
        >
          Review the muster →
        </button>
      </div>

      {/* filmstrip */}
      <div className="setup-strip" role="listbox" aria-label="Hero roster">
        {availableHeroes.map((heroId) => {
          const meta = metaFor(heroId);
          const seatOf = seats.indexOf(heroId);
          const taken = seatOf >= 0;
          const disabledForActive = taken && seatOf !== activeSeatIndex;
          return (
            <button
              key={heroId}
              type="button"
              className={`setup-strip__hero ${
                spotlightId === heroId ? "is-spot" : ""
              } ${disabledForActive ? "is-disabled" : ""}`}
              onClick={() => {
                if (!taken && activeSeatIndex >= 0) assignHero(heroId);
                else if (taken) selectSeat(seatOf);
              }}
              onMouseEnter={() => setPreviewHeroId(heroId)}
              onFocus={() => setPreviewHeroId(heroId)}
              aria-selected={spotlightId === heroId}
            >
              <span className="setup-strip__fig">
                <img src={getHeroTokenUrl(heroId)} alt="" />
                <span className="setup-strip__name">{meta.name}</span>
              </span>
              {taken && <span className="setup-strip__badge">P{seatOf + 1}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VacantGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8.5" r="3.6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 20c0-3.9 3.1-6.4 7-6.4s7 2.5 7 6.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
