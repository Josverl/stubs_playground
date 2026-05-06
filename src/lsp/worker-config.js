/**
 * Worker Configuration Module
 * 
 * Centralized location for Pyright Web Worker URL resolution.
 * Handles different deployment scenarios (dev with /src/, production root, etc.)
 */

/**
 * Resolves the correct path to the Pyright Web Worker bundle.
 * 
 * Uses the current window.location.pathname to determine the correct relative path:
 * - If served from /src/ (dev server): returns '../dist/pyright_worker.js'
 * - Otherwise (production root): returns './pyright_worker.js'
 * 
 * @returns {string} Relative path to the worker bundle
 */
export function getWorkerUrl() {
    const path = window.location.pathname;
    
    // Dev server: served from /src/index.html → worker at /dist/pyright_worker.js
    if (path.includes('/src/')) {
        return '../dist/pyright_worker.js';
    }
    
    // Production: served from root (or /docs) → worker at root or same level
    return './pyright_worker.js';
}

/**
 * Default worker URL (lazy-evaluated at first use)
 * @type {string | null}
 */
let cachedWorkerUrl = null;

/**
 * Get cached worker URL (evaluated once per session)
 * @returns {string}
 */
export function getWorkerUrlCached() {
    if (cachedWorkerUrl === null) {
        cachedWorkerUrl = getWorkerUrl();
    }
    return cachedWorkerUrl;
}

/**
 * Validate that the worker URL path resolves correctly.
 * Useful for debugging path issues during initialization.
 * 
 * @returns {Promise<boolean>}
 */
export async function validateWorkerUrl() {
    try {
        const url = getWorkerUrl();
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok;
    } catch (err) {
        console.warn(`Worker URL validation failed: ${err.message}`);
        return false;
    }
}
