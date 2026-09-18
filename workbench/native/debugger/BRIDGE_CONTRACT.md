# Recovered bridge contract

The historical `dap_browser.cpp` combined two source units:

- a `lldb_private::process_gdb_remote::ProcessGDBRemote` connection backed by
  the WAMR callback/feed API; and
- an `lldb_dap::DAP` instance whose transport queues outgoing JSON messages for
  JavaScript.

The browser-facing C exports were:

```text
wasmbolt_dap_initialize
wasmbolt_dap_prepare_wamr_session(modulePath, entry, argumentsJSON)
wasmbolt_dap_debugger_id
wasmbolt_dap_target_id
wasmbolt_dap_session_json
wasmbolt_lldb_initialize
wasmbolt_dap_send_json
wasmbolt_dap_message_count
wasmbolt_dap_pop_message
wasmbolt_dap_last_error
```

The implementation must keep LLDB asynchronous. It creates a Wasm target, starts
WAMR on a guest pthread, connects LLDB's GDB-remote process plugin to an
in-memory `Connection`, and pumps WAMR stop events back as RSP stop replies.

The recovered source includes two late experimental changes that require E2E
revalidation:

1. WASI preview1 shims changed from WAMR's signature-converting native API to
   `wasm_runtime_register_natives_raw` after pointer conversion failed.
2. target creation changed from an explicit `wasm32-unknown-unknown` triple to
   triple inference. The last known-good binary may predate that relink.

The bridge is compiled by `scripts/45-build-bridge.sh` and tested using the
request tracing in [E2E_TEST_PLAN.md](E2E_TEST_PLAN.md). The script accepts an
explicit `WASMBOLT_DAP_BRIDGE_SOURCE` only for controlled experiments.

## One debugger session in the UI

The source gutter, debugger controls, Variables, Call Stack, Breakpoints, and
Source panes must all speak DAP to this one adapter. The bottom terminal may
offer an `(lldb)` prompt, but it must send commands through DAP `evaluate` with
the REPL context. It must not create a second `SBDebugger` or WAMR process. This
keeps breakpoints and process state synchronized in both directions.
