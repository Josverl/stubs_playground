let verboseOutput = false;

export function setVerboseOutput(enabled: boolean): void {
    verboseOutput = enabled === true;
}

export function logVerbose(...args: unknown[]): void {
    if (verboseOutput) {
        console.log(...args);
    }
}