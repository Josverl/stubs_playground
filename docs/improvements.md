## ViperIDE

*Reorganize typechecking files*

Cause: Typechecking modules and tests were mixed into general source/test directories.
Resolution: Moved production modules and unit tests into dedicated typechecking/ folders and updated imports and Rollup paths.
Commit: 15810c7

*Imported components produced excessive console output*

Cause: Informational logging was unconditional, and the worker defaulted to verbose output.
Resolution: Made informational logging opt-in while preserving warnings and errors. Published lsp-client-v0.2.10 and pyright-worker-v0.2.6.
Commit: 22739d7

*“Typecheck Files” defaulted to “All”*

Cause: Both the persisted fallback and HTML selection defaulted to workspace.
Resolution: Changed the default to openFilesOnly, displaying “Opened,” while retaining “All” as an explicit option.
Commit: 6ecec93

*Autocomplete did not reliably appear after typing .*

Cause: The shared client always delayed dotted completions by 320 ms. ViperIDE already sends document changes immediately, making the delay unnecessary and allowing CodeMirror to cancel the pending query.
Resolution: Added configurable completion timing, set ViperIDE’s delay to zero, and added a repeated first-dot browser regression test. Published lsp-client-v0.2.11.
Commits: 35dbf7f and bd2d4ea

## stubs_playground

 - Made component logging opt-in and quiet by default.
 - Preserved warning/error messages.
 - Added configurable completion timing to createLSPPlugin.
 - Kept the playground’s 320 ms completion delay because its didChange is debounced by 300 ms.
 - Updated playground component metadata to lsp-client-v0.2.11.
 - Added component unit and browser coverage.
