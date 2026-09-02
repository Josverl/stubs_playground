# Use the MicroPython Stubs Playground

The [MicroPython Stubs Playground](https://josverl.github.io/stubs_playground/)
checks MicroPython and CircuitPython code in your browser. It uses Pyright and
board-specific type stubs to find many mistakes before code reaches a device.
Your files stay in your browser unless you choose **Share**.

## Check code in the browser

1. Choose **MicroPython** or **CircuitPython** under **Family**.
2. Select the firmware version, port, and board that match your device.
3. Select an example and choose **Load**, or edit the current files.
4. Review inline diagnostics and the error, warning, and information counts.
5. Hover over names for documentation and type information. Use
   {kbd}`Ctrl+Space` for completion and {kbd}`F8` to move to the next
   diagnostic.

Changing the board replaces the active stub package, so diagnostics can reveal
APIs that are unavailable on another port or board. **View pyproject.toml**
shows the equivalent Pyright configuration used by the playground.

The workspace is saved in browser storage. A share link contains the files and
settings you selected; creating one is the point at which you intentionally
make that code portable outside the current browser profile.

## Set up a local project

The setup wizard from the
[`micropython-stubs` repository](https://github.com/Josverl/micropython-stubs)
can install matching stubs and configure a local type checker. Install
[`uv`](https://docs.astral.sh/uv/getting-started/installation/), open a terminal
in your project directory, and run:

```bash
uv run https://raw.githubusercontent.com/Josverl/micropython-stubs/refs/heads/main/setup_micropython_stubs.py
```

The interactive wizard asks for the project folder, source location, type
checker, and MicroPython stub package. It then installs the selected package in
a local `typings` directory. When you select a type checker, it also updates
`pyproject.toml`; it can add the generated stub directories to `.gitignore`.

The wizard requires internet access to read the package catalog and install a
stub package. It is currently an early-beta tool, so review the project file
changes after it runs. See
[Install the micropython-stubs](https://micropython-stubs.readthedocs.io/en/main/11_install_stubs.html)
for current details and manual installation alternatives.

## Find more information

- Use **Help** in the playground for the short workflow and keyboard shortcuts.
- Use **Report** to report an incorrect or missing MicroPython stub.
- Read the [component API documentation](api/overview.md) when integrating the
  browser type-checking packages into another editor.
- Read the [contributor guide](contributing.md) when changing this repository.
