// Single mount in a fresh process -> prints one number (ms).
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Zip } from '@zenfs/archives';
import { resolveMountConfig } from '@zenfs/core';

const file = process.argv[2];
const lazy = process.argv.includes('--lazy');
const buf = readFileSync(file);
const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const t0 = performance.now();
await resolveMountConfig({ backend: Zip, data, ...(lazy ? { lazy: true } : {}) });
console.log((performance.now() - t0).toFixed(1));
