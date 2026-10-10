# Debugger

The bug button toggles the panel independently of compilation. The panel has
breakpoint markers per source file, disabled session controls, and slots for
variables, frames and console output. Debug target offers **Build current source**
or an existing workspace `.wasm`, with its path shown below. No debugger backend
is loaded; session controls remain disabled until an adapter is installed.

A future adapter owns DAP requests/events in a dedicated Worker. Session state
controls its actions (Pause when running, steps when stopped). Closing this panel
only hides it; explicit Stop must own session teardown. Runtime reproduction
lives on the separate `wasmbolt-lldb-fresh` and `wasmbolt-swift-browser` branches.
