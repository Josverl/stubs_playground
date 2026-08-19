// Sanity check: both stacks must expose the same files with the same contents.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Zip } from '@zenfs/archives';
import { resolveMountConfig } from '@zenfs/core';

const file = process.argv[2];
const lazy = process.argv.includes('--lazy');
const buf = readFileSync(file);
const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const fs = await resolveMountConfig({ backend: Zip, data, ...(lazy ? { lazy: true } : {}) });

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
// core 1.x exposes stats.isDirectory(); core 2.x does not, so use the mode bits.
const isDir = (stats) => (stats.mode & S_IFMT) === S_IFDIR;

const files = [];
const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
        const path = dir === '/' ? `/${name}` : `${dir}/${name}`;
        const stats = fs.statSync(path);
        if (isDir(stats)) walk(path);
        else files.push([path, stats.size]);
    }
};
walk('/');
files.sort(([a], [b]) => (a < b ? -1 : 1));

const hash = createHash('sha256');
let bytes = 0;
for (const [path, size] of files) {
    const buffer = new Uint8Array(size);
    fs.readSync(path, buffer, 0, size);
    bytes += size;
    hash.update(path).update(buffer);
}
console.log(`files=${files.length} bytes=${bytes} sha256=${hash.digest('hex').slice(0, 16)}`);
