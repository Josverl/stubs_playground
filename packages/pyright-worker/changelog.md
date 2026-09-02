# Changelog

## Unreleased

## 0.4.5 - 2026-09-02

### Changed

- Moved the npm package to the `@mp-typing/pyright-worker` name.

## 0.4.4 - 2026-09-01

### Added

- Added worker control protocol version and capability negotiation.
- Added an immutable runtime manifest with exact Pyright/typeshed compatibility,
  asset sizes, and SHA-256 digests.
- Added verified external stub catalogs, board archives, and client-owned
  type-only overlays with bundled fallback behavior.

### Changed

- Updated the generated MicroPython package catalog to default to firmware
  1.29.0 and synchronized catalog generation with build and release workflows.
- Identified `micropython-webassembly-stubs` as the `PYSCRIPT` board so
  downstream clients can select its board-specific stubs.
- Refreshed the bundled CircuitPython fallback archive to 10.3.0.

### Fixed

- Worker shutdown now follows the standard LSP `shutdown` and `exit` ordering.

## 0.4.1 - 2026-08-23

### Changed

- The stub package catalog now uses the published MicroPython package index and includes a CircuitPython placeholder entry.
- Catalog package kind `board` is replaced by `firmware`.
- `listStubPackages` requests accept optional family, firmware version, port, and board filters.
- Requests without family or version filters default to MicroPython's highest non-preview firmware in the generated catalog.
- Catalog results expose `family`, `runtimeVersions`, `port`, and `board` metadata.
- Catalog responses expose `availableRuntimeVersions` and `defaultRuntimeVersion`.

### Fixed

- `listStubPackages` now filters each package's `versions` and `latestVersion` to the requested firmware line, so a version-scoped request no longer advertises releases from a newer runtime.
- Obsolete board stub packages are now removed before initialization reports success, preventing a stale IndexedDB record from being observed on an immediate refresh or board switch.
- The bundled `typeshed-fallback.zip` is now compressed (deflated) instead of stored, reducing the asset and inlined worker bundle from ~3.1 MB to ~0.6 MB.

### Added

- Added a reproducible catalog sync script backed by the published `stub-packages.json` source.
- Added generated stable firmware version metadata shared by API and playground defaults.