# Debugger

The bug button toggles the panel independently of compilation. The panel has
breakpoint markers per source file, disabled session controls, and slots for
variables, frames and console output. No debugger backend is loaded.

A future adapter owns DAP requests/events in a dedicated Worker. Session state
controls its actions (Pause when running, steps when stopped). Closing this panel
only hides it; explicit Stop must own session teardown. Runtime reproduction
lives on the separate `wasmbolt-lldb-fresh` and `wasmbolt-swift-browser` branches.
