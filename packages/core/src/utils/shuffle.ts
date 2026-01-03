/**
 * Fisher-Yates shuffle implementation
 */

/**
 * Shuffle an array using the Fisher-Yates algorithm.
 * Returns a new array with elements in random order.
 *
 * @param array - The array to shuffle
 * @returns A new shuffled array
 */
export function shuffle<T>(array: readonly T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i];
    const swap = result[j];
    if (temp !== undefined && swap !== undefined) {
      result[i] = swap;
      result[j] = temp;
    }
  }
  return result;
}
