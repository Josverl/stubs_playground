let verboseOutput = false;

export function setVerboseOutput(enabled) {
    verboseOutput = enabled === true;
}

export function logVerbose(...args) {
    if (verboseOutput) {
        console.log(...args);
    }
}
