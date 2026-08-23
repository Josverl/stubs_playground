/**
 * Log informational output only when the consumer opted in.
 *
 * @param {boolean} [enabled] - Whether verbose logging is enabled.
 * @param {...unknown} args - Values forwarded to `console.log`.
 * @returns {void}
 */
export function logVerbose(enabled?: boolean, ...args: unknown[]): void;
