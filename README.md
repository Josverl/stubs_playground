# MicroPython stubs Playground

This App provides shows that Type Checking for MicroPython can be used by anyone, and that no complex setup is needed.

The goal of this repo are to provide a simple tool that: 
1. Help to spot a code issue that might otherwise first show up during runtime.
2. Allows for simple reporting of bugs to the the MicroPython stubs repo.
3. Serve as a Proof of Concept for other web based MicroPython or Python editors IDEs to implement something similar.
4. Allows for a simple sanity check - would this MicroPython code work on a different port ?
5. Allows you to share code-snippets using a simple link without needing to set up a repo or gist.
6. Shows the usefulness of static typing for MicroPython, even in a browser.


**Built on:**
- This App uses [*Codemirror 6* editor](https://codemirror.net/) with basic Python sypport
- That has been extended using the [Language Server Protocol (LSP)](https://microsoft.github.io/language-server-protocol/overviews/lsp/overview/)
- that connects to [Pyright](https://github.com/microsoft/pyright) running in a Web Worker. 
- Pyright in turn uses [**MicroPython-Stubs**](https://github.com/Josverl/micropython-stubs) (ESP32, RP2040, STM32) with live switching between different MCU families.

**How it works:**
1. Type MicroPython code in the editor
2. After 300ms of no typing, a `textDocument/didChange` notification is sent to Pyright
3. Pyright analyzes your code and returns diagnostics
4. Errors and warnings are displayed inline with visual markers
5. Hover over imports, classes, variables etc to see the documentation and type information (for the types that are present in the stubs)

**Where does it run**
The App is deployed to GitHub Pages as static files — no active server needed, no code shared (unless you choose to) - all runs in the user's browser.

I have used Pyright as an LSP, but in principle that is replacable by any other type-checker that can be made to run in a web-worker. All Python type-chekers will be able to "understand" MicroPython, with just a little configuration. 

**Can I use similar type checkingin my own IDE or setup, or CI**
Yes you can. 
There are extensions/add-ins for the most used IDEs, and as this is all standards based - you can just configure it yourself, using any combination of tooling that you prefer.
To a degree this works even if you prefer to using Nano and rshell - you'll just need to run pyright from the prompt.
There are setup instuctions in the MicroPython-Stubs repo, but I would like to offer a simple setup-script to cover the common cases. That still needs to be written and tested though.

**Non goals:**
This app does not aim to provide a live connection to an physical or emulated board.There are several great apps that do this today. I hope and would support that some of them will look at this repo and integrate the code or concepts.

## Features

- ✅ Tablestakes CodeMirror functionality 
   - ✅ All standard features
   - ✅ Responsive design (though I am no UX designer 😁)
- - ✅ **MicroPython** syntax highlighting
- ✅ **LSP Integration** - Pyright running in a Web Worker (no server needed)
- ✅ **Real-time Diagnostics** - Errors and warnings as you type (debounced 300ms)
- ✅ **Type Checking** - Full **MicroPython** type analysis
- ✅ **Board Selector** - Switch between ESP32, RP2040, STM32, CircuitPython stubs
- ✅ **Multiple documents** and folders, persisted in your local browser state
- ✅ **Share** - Create a shareable link with your code sample, and settings, to share anywhere
- ✅ **Import and Export** single files or zipped folders

## AI Use

Indeed I used AI 🔮 to create this. I have spend multiple years gradually and manually building the micropython-stubs and associated toolset, and I learned a great deal through that.  

I have suggested this approach (CM6 + LSP + Stubs) a few times before - but it was not seen as an short term achievable goal.
For me that was a hill to climb - and I failed in earlier (manual) attempts due to my lack of web dev skills combined with a lack of time.

So that is where I "hired some AI Agents" to do that part of the work for me.

As for the limited UX design - that is proably me tough.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Resources

- [Micropython Stubs](https://github.com/josverl/micropython-stubs)
- [Pyright](https://github.com/microsoft/pyright#static-type-checker-for-python)
- [CodeMirror 6 Documentation](https://codemirror.net/6/)
- [Python Language Package](https://github.com/codemirror/lang-python)
- [Micropython documentation](https://docs.micropython.org)
