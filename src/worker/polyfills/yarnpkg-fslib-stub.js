// Stubs for @yarnpkg/fslib — delegates all fs operations to node's fs module
// (which webpack aliases to @zenfs/core in browser).
// Pyright's realFileSystem.ts creates YarnFS (PosixFS → VirtualFS → EggZipOpenFS)
// and uses it for ALL filesystem access. These stubs must actually work.

import * as fs from 'fs';
import pathModule from 'path';

class FakeFS {
    existsSync(p) { return fs.existsSync(p); }
    readFileSync(p, opts) { return fs.readFileSync(p, opts); }
    writeFileSync(p, content, opts) { return fs.writeFileSync(p, content, opts); }
    readdirSync(p, opts) { return fs.readdirSync(p, opts); }
    mkdirSync(p, opts) { return fs.mkdirSync(p, opts); }
    rmdirSync(p) { return fs.rmdirSync(p); }
    unlinkSync(p) { return fs.unlinkSync(p); }
    renameSync(oldP, newP) { return fs.renameSync(oldP, newP); }
    statSync(p) { return fs.statSync(p); }
    lstatSync(p) {
        try { return fs.lstatSync(p); }
        catch { return fs.statSync(p); }
    }
    realpathSync(p) {
        try { return fs.realpathSync(p); }
        catch { return p; }
    }
    readlinkSync(p) { return p; }
    openSync(p, flags) { return fs.openSync(p, flags); }
    closeSync(fd) { return fs.closeSync(fd); }
    readSync(fd, buffer, offset, length, position) {
        return fs.readSync(fd, buffer, offset, length, position);
    }
    watch() { return { close() {} }; }
    watchFile() { return { close() {} }; }
    unwatchFile() {}
}

class BasePortableFakeFS extends FakeFS {}

class ZipOpenFS extends BasePortableFakeFS {
    constructor(opts) {
        super();
        this.baseFs = opts?.baseFs || null;
        this.isZip = new Set();
        this.notZip = new Set();
        this.filter = null;
    }
    get pathUtils() { return ppath; }
    findZip() { return null; }
    getZipSync() { return null; }
}

class NodeFS extends BasePortableFakeFS {
    constructor() { super(); }
}

class PosixFS extends FakeFS {
    constructor(baseFs) {
        super();
        this._baseFs = baseFs || new NodeFS();
    }
    mapToBase(p) { return p; }
    existsSync(p) { return this._baseFs.existsSync(p); }
    readFileSync(p, opts) { return this._baseFs.readFileSync(p, opts); }
    writeFileSync(p, content, opts) { return this._baseFs.writeFileSync(p, content, opts); }
    readdirSync(p, opts) { return this._baseFs.readdirSync(p, opts); }
    mkdirSync(p, opts) { return this._baseFs.mkdirSync(p, opts); }
    rmdirSync(p) { return this._baseFs.rmdirSync(p); }
    unlinkSync(p) { return this._baseFs.unlinkSync(p); }
    renameSync(oldP, newP) { return this._baseFs.renameSync(oldP, newP); }
    statSync(p) { return this._baseFs.statSync(p); }
    lstatSync(p) { return this._baseFs.lstatSync(p); }
    realpathSync(p) { return this._baseFs.realpathSync(p); }
    readlinkSync(p) { return this._baseFs.readlinkSync(p); }
    openSync(p, flags) { return this._baseFs.openSync(p, flags); }
    closeSync(fd) { return this._baseFs.closeSync(fd); }
    readSync(fd, buffer, offset, length, position) {
        return this._baseFs.readSync(fd, buffer, offset, length, position);
    }
    watch() { return { close() {} }; }
}

class VirtualFS extends BasePortableFakeFS {
    constructor(opts) {
        super();
        this._baseFs = opts?.baseFs || new NodeFS();
    }
    existsSync(p) { return this._baseFs.existsSync(p); }
    readFileSync(p, opts) { return this._baseFs.readFileSync(p, opts); }
    writeFileSync(p, content, opts) { return this._baseFs.writeFileSync(p, content, opts); }
    readdirSync(p, opts) { return this._baseFs.readdirSync(p, opts); }
    mkdirSync(p, opts) { return this._baseFs.mkdirSync(p, opts); }
    rmdirSync(p) { return this._baseFs.rmdirSync(p); }
    unlinkSync(p) { return this._baseFs.unlinkSync(p); }
    renameSync(oldP, newP) { return this._baseFs.renameSync(oldP, newP); }
    statSync(p) { return this._baseFs.statSync(p); }
    lstatSync(p) { return this._baseFs.lstatSync(p); }
    realpathSync(p) { return this._baseFs.realpathSync(p); }
    readlinkSync(p) { return this._baseFs.readlinkSync(p); }
    openSync(p, flags) { return this._baseFs.openSync(p, flags); }
    closeSync(fd) { return this._baseFs.closeSync(fd); }
    readSync(fd, buffer, offset, length, position) {
        return this._baseFs.readSync(fd, buffer, offset, length, position);
    }
}

class ZipFS extends BasePortableFakeFS {}
class CwdFS extends BasePortableFakeFS {}
class JailFS extends BasePortableFakeFS {}
class LazyFS extends BasePortableFakeFS {}
class ProxiedFS extends BasePortableFakeFS {}
class AliasFS extends BasePortableFakeFS {}
class NoFS extends BasePortableFakeFS {}
class MountFS extends BasePortableFakeFS {}

const ppath = {
    root: '/',
    sep: '/',
    join: (...args) => pathModule.posix.join(...args),
    resolve: (...args) => pathModule.posix.resolve(...args),
    dirname: (p) => pathModule.posix.dirname(p),
    basename: (p) => pathModule.posix.basename(p),
    normalize: (p) => pathModule.posix.normalize(p),
    relative: (from, to) => pathModule.posix.relative(from, to),
    isAbsolute: (p) => pathModule.posix.isAbsolute(p),
};
const npath = ppath;
const PortablePath = '';
const Filename = '';
const NativePath = '';
const constants = {};
const errors = {};
const statUtils = {};

export {
    FakeFS,
    BasePortableFakeFS,
    ZipOpenFS,
    NodeFS,
    PosixFS,
    VirtualFS,
    ZipFS,
    CwdFS,
    JailFS,
    LazyFS,
    ProxiedFS,
    AliasFS,
    NoFS,
    MountFS,
    ppath,
    npath,
    PortablePath,
    Filename,
    NativePath,
    constants,
    errors,
    statUtils,
};
