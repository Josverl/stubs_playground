export function logVerbose(enabled, ...args) {
    if (enabled === true) {
        console.log(...args);
    }
}
