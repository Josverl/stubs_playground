import assert from 'node:assert/strict';
import test from 'node:test';

import { logVerbose, setVerboseOutput } from '../src/logging.ts';

test('worker informational logging is quiet by default and opt-in', () => {
    const originalLog = console.log;
    const calls = [];
    console.log = (...args) => calls.push(args);

    try {
        logVerbose('quiet');
        assert.deepEqual(calls, []);

        setVerboseOutput(true);
        logVerbose('verbose', { ready: true });
        assert.deepEqual(calls, [['verbose', { ready: true }]]);
    } finally {
        setVerboseOutput(false);
        console.log = originalLog;
    }
});
