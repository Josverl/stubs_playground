/**
 * Backward-compatible share module facade.
 *
 * New code should import from:
 * - './share-core.js' for pure utilities
 * - './share-ui.js' for app-specific DOM wiring
 */

export * from './share-core.js';
export * from './share-ui.js';
