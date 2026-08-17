# Changelog

## Unreleased

### Changed

- The stub package catalog now uses the published MicroPython package index and includes a CircuitPython placeholder entry.
- Catalog package kind `board` is replaced by `runtime`.
- `listStubPackages` requests accept optional family, runtime version, port, and board filters.
- Requests without family or version filters default to MicroPython's highest non-preview runtime in the generated catalog.
- Catalog results expose `family`, `runtimeVersions`, `port`, and `board` metadata.
- Catalog responses expose `availableRuntimeVersions` and `defaultRuntimeVersion`.

### Added

- Added a reproducible catalog sync script backed by the published `stub-packages.json` source.
- Added generated stable runtime version metadata shared by API and playground defaults.