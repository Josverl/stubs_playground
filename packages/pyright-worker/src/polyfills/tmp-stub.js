// Stub for 'tmp' module — provides no-op implementations for browser
export function setGracefulCleanup() {}

export function fileSync() {
    return { name: '/tmp/stub', fd: -1, removeCallback: function() {} };
}

export function dirSync() {
    return { name: '/tmp/stub', removeCallback: function() {} };
}

export function tmpNameSync() {
    return '/tmp/stub';
}
