/**
 * Seeded random number generator utilities
 *
 * All randomness in the game engine should go through this module
 * to ensure games are reproducible for testing, replays, and debugging.
 */

/**
 * RNG state tracked in game state
 */
export interface RngState {
  readonly seed: number;
  readonly counter: number;
}

/**
 * Create initial RNG state with optional seed
 */
export function createRng(seed?: number): RngState {
  return {
    seed: seed ?? Date.now(),
    counter: 0,
  };
}

/**
 * Mulberry32 — fast, good distribution, seedable
 * Returns a value in [0, 1)
 */
function mulberry32(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Get next random value (0-1) and updated RNG state
 */
export function nextRandom(rng: RngState): { value: number; rng: RngState } {
  const newCounter = rng.counter + 1;
  const value = mulberry32(rng.seed + newCounter);

  return {
    value,
    rng: { seed: rng.seed, counter: newCounter },
  };
}

/**
 * Get random integer in range [min, max] inclusive
 */
export function randomInt(
  rng: RngState,
  min: number,
  max: number
): { value: number; rng: RngState } {
  const { value, rng: newRng } = nextRandom(rng);
  const intValue = min + Math.floor(value * (max - min + 1));
  return { value: intValue, rng: newRng };
}

/**
 * Shuffle array using seeded RNG (Fisher-Yates)
 * Returns a new shuffled array and the updated RNG state
 */
export function shuffleWithRng<T>(
  array: readonly T[],
  rng: RngState
): { result: T[]; rng: RngState } {
  const result = [...array];
  let currentRng = rng;

  for (let i = result.length - 1; i > 0; i--) {
    const { value, rng: newRng } = nextRandom(currentRng);
    currentRng = newRng;
    const j = Math.floor(value * (i + 1));
    const temp = result[i];
    const swap = result[j];
    if (temp !== undefined && swap !== undefined) {
      result[i] = swap;
      result[j] = temp;
    }
  }

  return { result, rng: currentRng };
}

/**
 * Pick random element from array
 * Returns undefined if array is empty
 */
export function randomElement<T>(
  array: readonly T[],
  rng: RngState
): { value: T | undefined; rng: RngState } {
  if (array.length === 0) {
    return { value: undefined, rng };
  }
  const { value: index, rng: newRng } = randomInt(rng, 0, array.length - 1);
  return { value: array[index], rng: newRng };
}
