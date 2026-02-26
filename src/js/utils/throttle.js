/**
 * Throttle & Debounce utilities for frame-rate limiting.
 */

/**
 * Returns a throttled version of fn that fires at most once per `limit` ms.
 * Fires on both leading and trailing edges.
 * @param {Function} fn
 * @param {number} limit  Minimum ms between calls
 * @returns {Function}
 */
export function throttle(fn, limit) {
  let lastCall = 0;
  let trailingTimer = null;
  let lastArgs = null;

  return function (...args) {
    const now = Date.now();
    lastArgs = args;

    if (now - lastCall >= limit) {
      lastCall = now;
      if (trailingTimer) { clearTimeout(trailingTimer); trailingTimer = null; }
      return fn.apply(this, args);
    } else {
      if (trailingTimer) clearTimeout(trailingTimer);
      trailingTimer = setTimeout(() => {
        lastCall = Date.now();
        trailingTimer = null;
        fn.apply(this, lastArgs);
      }, limit - (now - lastCall));
    }
  };
}

/**
 * Returns a debounced version of fn that fires only after `wait` ms of silence.
 * @param {Function} fn
 * @param {number} wait
 * @returns {Function}
 */
export function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn.apply(this, args); }, wait);
  };
}

/**
 * Creates a stability checker that returns true once `requiredCount`
 * consecutive identical values have been seen.
 * @param {number} requiredCount
 * @returns {{ check: (value: string) => boolean, reset: () => void }}
 */
export function createStabilityChecker(requiredCount = 3) {
  let lastValue = null;
  let count = 0;

  return {
    check(value) {
      if (value === lastValue) {
        count++;
      } else {
        lastValue = value;
        count = 1;
      }
      return count >= requiredCount;
    },
    reset() {
      lastValue = null;
      count = 0;
    },
  };
}
