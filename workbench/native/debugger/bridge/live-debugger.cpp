#include "Plugins/Process/gdb-remote/ProcessGDBRemote.h"
#include "llvm/ADT/StringRef.h"
#include "lldb/API/SBDebugger.h"
#include "lldb/Core/Debugger.h"
#include "lldb/Core/ModuleList.h"
#include "lldb/Host/FileSystem.h"
#include "lldb/Interpreter/CommandInterpreter.h"
#include "lldb/Interpreter/CommandReturnObject.h"
#include "lldb/Target/DynamicLoader.h"
#include "lldb/Target/Process.h"
#include "lldb/Target/Target.h"
#include "lldb/Target/TargetList.h"
#include "lldb/Utility/Connection.h"
#include "lldb/Utility/Status.h"
#include "lldb/Utility/Timeout.h"
#include <emscripten/emscripten.h>

extern "C" {
#include "debug_engine.h"
#include "handler.h"
#include "wasm_export.h"
}

#include <algorithm>
#include <atomic>
#include <cinttypes>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using namespace lldb;
using namespace lldb_private;
using namespace lldb_private::process_gdb_remote;

namespace {

constexpr bool TraceProtocol = false;
#define TRACE_LIFECYCLE(...)                                                   \
  do {                                                                         \
    if (TraceProtocol)                                                         \
      std::fprintf(stderr, __VA_ARGS__);                                       \
  } while (false)

std::vector<std::string> ActiveWasiArguments;
std::atomic<int32_t> ActiveExitCode{0};
std::atomic<bool> ActiveProcExit{false};
std::atomic<bool> ActiveExitReported{false};

void wasiProcExit(wasm_exec_env_t Environment, uint32_t Code) {
  ActiveExitCode.store(static_cast<int32_t>(Code));
  ActiveProcExit.store(true);
  wasm_runtime_set_exception(wasm_runtime_get_module_inst(Environment),
                             "wasmbolt proc exit");
}

uint32_t wasiArgsSizesGet(wasm_exec_env_t, uint32_t *Count, uint32_t *Size) {
  *Count = static_cast<uint32_t>(ActiveWasiArguments.size());
  *Size = 0;
  for (const std::string &Argument : ActiveWasiArguments)
    *Size += static_cast<uint32_t>(Argument.size() + 1);
  return 0;
}

uint32_t wasiArgsGet(wasm_exec_env_t Environment, uint32_t *Offsets,
                     char *Buffer) {
  wasm_module_inst_t Instance = wasm_runtime_get_module_inst(Environment);
  char *Cursor = Buffer;
  for (size_t I = 0; I != ActiveWasiArguments.size(); ++I) {
    const std::string &Argument = ActiveWasiArguments[I];
    Offsets[I] = wasm_runtime_addr_native_to_app(Instance, Cursor);
    std::memcpy(Cursor, Argument.c_str(), Argument.size() + 1);
    Cursor += Argument.size() + 1;
  }
  return 0;
}

uint32_t wasiFdClose(wasm_exec_env_t, uint32_t) { return 0; }

uint32_t wasiFdWrite(wasm_exec_env_t, uint32_t, const void *, uint32_t,
                     uint32_t *NWritten) {
  *NWritten = 0;
  return 0;
}

uint32_t wasiFdSeek(wasm_exec_env_t, uint32_t, int64_t, uint32_t,
                    uint64_t *NewOffset) {
  *NewOffset = 0;
  return 0;
}

uint32_t wasiEnvironSizesGet(wasm_exec_env_t, uint32_t *Count,
                             uint32_t *Size) {
  *Count = 0;
  *Size = 0;
  return 0;
}

uint32_t wasiEnvironGet(wasm_exec_env_t, uint32_t *, char *) { return 0; }

void wasiProcExitRaw(wasm_exec_env_t Environment, uint64_t *Arguments) {
  native_raw_get_arg(uint32_t, Code, Arguments);
  wasiProcExit(Environment, Code);
}

void wasiArgsSizesGetRaw(wasm_exec_env_t Environment, uint64_t *Arguments) {
  native_raw_return_type(uint32_t, Arguments);
  native_raw_get_arg(uint32_t *, Count, Arguments);
  native_raw_get_arg(uint32_t *, Size, Arguments);
  native_raw_set_return(wasiArgsSizesGet(Environment, Count, Size));
}

void wasiArgsGetRaw(wasm_exec_env_t Environment, uint64_t *Arguments) {
  native_raw_return_type(uint32_t, Arguments);
  native_raw_get_arg(uint32_t *, Offsets, Arguments);
  native_raw_get_arg(char *, Buffer, Arguments);
  native_raw_set_return(wasiArgsGet(Environment, Offsets, Buffer));
}

void wasiFdCloseRaw(wasm_exec_env_t Environment, uint64_t *Arguments) {
  native_raw_return_type(uint32_t, Arguments);
  native_raw_get_arg(uint32_t, FD, Arguments);
  native_raw_set_return(wasiFdClose(Environment, FD));
}

void wasiFdWriteRaw(wasm_exec_env_t Environment, uint64_t *Arguments) {
  native_raw_return_type(uint32_t, Arguments);
  native_raw_get_arg(uint32_t, FD, Arguments);
  native_raw_get_arg(const void *, IOVecs, Arguments);
  native_raw_get_arg(uint32_t, Count, Arguments);
  native_raw_get_arg(uint32_t *, NWritten, Arguments);
  native_raw_set_return(
      wasiFdWrite(Environment, FD, IOVecs, Count, NWritten));
}

void wasiFdSeekRaw(wasm_exec_env_t Environment, uint64_t *Arguments) {
  native_raw_return_type(uint32_t, Arguments);
  native_raw_get_arg(uint32_t, FD, Arguments);
  native_raw_get_arg(int64_t, Offset, Arguments);
  native_raw_get_arg(uint32_t, Whence, Arguments);
  native_raw_get_arg(uint64_t *, NewOffset, Arguments);
  native_raw_set_return(
      wasiFdSeek(Environment, FD, Offset, Whence, NewOffset));
}

void wasiEnvironSizesGetRaw(wasm_exec_env_t Environment,
                            uint64_t *Arguments) {
  native_raw_return_type(uint32_t, Arguments);
  native_raw_get_arg(uint32_t *, Count, Arguments);
  native_raw_get_arg(uint32_t *, Size, Arguments);
  native_raw_set_return(wasiEnvironSizesGet(Environment, Count, Size));
}

void wasiEnvironGetRaw(wasm_exec_env_t Environment, uint64_t *Arguments) {
  native_raw_return_type(uint32_t, Arguments);
  native_raw_get_arg(uint32_t *, Offsets, Arguments);
  native_raw_get_arg(char *, Buffer, Arguments);
  native_raw_set_return(wasiEnvironGet(Environment, Offsets, Buffer));
}

NativeSymbol WasiSymbols[] = {
    {"proc_exit", reinterpret_cast<void *>(wasiProcExitRaw), "(i)", nullptr},
    {"args_sizes_get", reinterpret_cast<void *>(wasiArgsSizesGetRaw), "(**)i",
     nullptr},
    {"args_get", reinterpret_cast<void *>(wasiArgsGetRaw), "(**)i", nullptr},
    {"fd_close", reinterpret_cast<void *>(wasiFdCloseRaw), "(i)i", nullptr},
    {"fd_write", reinterpret_cast<void *>(wasiFdWriteRaw), "(i*i*)i", nullptr},
    {"fd_seek", reinterpret_cast<void *>(wasiFdSeekRaw), "(iIi*)i", nullptr},
    {"environ_sizes_get", reinterpret_cast<void *>(wasiEnvironSizesGetRaw),
     "(**)i", nullptr},
    {"environ_get", reinterpret_cast<void *>(wasiEnvironGetRaw), "(**)i",
     nullptr},
};

void logBytes(const char *Direction, const uint8_t *Data, size_t Size) {
  std::fprintf(stderr, "[RSP] %s %zu byte(s): ", Direction, Size);
  for (size_t I = 0; I != Size; ++I) {
    unsigned char Byte = Data[I];
    if (Byte >= 0x20 && Byte <= 0x7e)
      std::fputc(Byte, stderr);
    else
      std::fprintf(stderr, "\\x%02x", Byte);
  }
  std::fputc('\n', stderr);
}

struct RSPBridge {
  std::mutex Mutex;
  std::condition_variable Ready;
  std::deque<uint8_t> Bytes;
  WASMGDBServer *Server = nullptr;
  bool Connected = true;
  bool Interrupted = false;
};

bool receiveWamrBytes(const uint8 *Data, uint32 Size, void *Opaque) {
  if (TraceProtocol)
    logBytes("WAMR -> LLDB", Data, Size);
  auto &Bridge = *static_cast<RSPBridge *>(Opaque);
  {
    std::lock_guard<std::mutex> Lock(Bridge.Mutex);
    Bridge.Bytes.insert(Bridge.Bytes.end(), Data, Data + Size);
  }
  Bridge.Ready.notify_all();
  return true;
}

class WamrConnection final : public Connection {
public:
  explicit WamrConnection(RSPBridge &Bridge) : Bridge(Bridge) {}

  ConnectionStatus Connect(llvm::StringRef, Status *Error) override {
    std::lock_guard<std::mutex> Lock(Bridge.Mutex);
    Bridge.Connected = true;
    if (Error)
      Error->Clear();
    return eConnectionStatusSuccess;
  }

  ConnectionStatus Disconnect(Status *Error) override {
    {
      std::lock_guard<std::mutex> Lock(Bridge.Mutex);
      Bridge.Connected = false;
    }
    Bridge.Ready.notify_all();
    if (Error)
      Error->Clear();
    return eConnectionStatusSuccess;
  }

  bool IsConnected() const override {
    std::lock_guard<std::mutex> Lock(Bridge.Mutex);
    return Bridge.Connected;
  }

  size_t Read(void *Destination, size_t Length,
              const Timeout<std::micro> &Wait,
              ConnectionStatus &ConnectionState, Status *Error) override {
    std::unique_lock<std::mutex> Lock(Bridge.Mutex);
    auto HasResult = [&] {
      return !Bridge.Bytes.empty() || Bridge.Interrupted || !Bridge.Connected;
    };

    bool Woke = true;
    if (Wait)
      Woke = Bridge.Ready.wait_for(Lock, *Wait, HasResult);
    else
      Bridge.Ready.wait(Lock, HasResult);

    if (!Woke) {
      ConnectionState = eConnectionStatusTimedOut;
      return 0;
    }
    if (Bridge.Interrupted) {
      Bridge.Interrupted = false;
      ConnectionState = eConnectionStatusInterrupted;
      return 0;
    }
    if (!Bridge.Connected) {
      ConnectionState = eConnectionStatusLostConnection;
      return 0;
    }

    size_t Count = std::min(Length, Bridge.Bytes.size());
    auto *Output = static_cast<uint8_t *>(Destination);
    for (size_t I = 0; I != Count; ++I) {
      Output[I] = Bridge.Bytes.front();
      Bridge.Bytes.pop_front();
    }
    ConnectionState = eConnectionStatusSuccess;
    if (Error)
      Error->Clear();
    return Count;
  }

  size_t Write(const void *Source, size_t Length,
               ConnectionStatus &ConnectionState, Status *Error) override {
    if (TraceProtocol)
      logBytes("LLDB -> WAMR", static_cast<const uint8_t *>(Source), Length);
    if (!wasm_gdbserver_feed(Bridge.Server,
                             static_cast<const uint8 *>(Source), Length)) {
      ConnectionState = eConnectionStatusError;
      if (Error)
        *Error = Status::FromErrorString("WAMR rejected GDB-remote bytes");
      return 0;
    }
    ConnectionState = eConnectionStatusSuccess;
    if (Error)
      Error->Clear();
    return Length;
  }

  std::string GetURI() override { return "wamr://in-memory"; }

  bool InterruptRead() override {
    {
      std::lock_guard<std::mutex> Lock(Bridge.Mutex);
      Bridge.Interrupted = true;
    }
    Bridge.Ready.notify_all();
    return true;
  }

private:
  RSPBridge &Bridge;
};

struct GuestInvocation {
  wasm_exec_env_t Environment = nullptr;
  wasm_module_inst_t Instance = nullptr;
  wasm_function_inst_t Function = nullptr;
  WASMGDBServer *Server = nullptr;
  WASMDebugInstance *DebugInstance = nullptr;
  std::string ProgramPath;
  std::string Entry;
  std::vector<std::string> Arguments;
  int32_t Result = 0;
  bool Succeeded = false;
};

void *runGuest(void *Opaque) {
  auto &Invocation = *static_cast<GuestInvocation *>(Opaque);
  TRACE_LIFECYCLE("[WAMR/guest] worker entered\n");

  if (!wasm_runtime_init_thread_env())
    return nullptr;

  std::vector<std::string> ExecutionArguments = Invocation.Arguments;
  const bool UseDefaultEntry = Invocation.Entry.empty();
  const bool UseStart = Invocation.Entry == "_start" ||
                        (UseDefaultEntry && Invocation.Function);
  if (UseDefaultEntry || Invocation.Entry == "main" || UseStart)
    ExecutionArguments.insert(ExecutionArguments.begin(),
                              Invocation.ProgramPath);

  std::vector<char *> Argv;
  Argv.reserve(ExecutionArguments.size());
  for (std::string &Argument : ExecutionArguments)
    Argv.push_back(Argument.data());

  ActiveWasiArguments = ExecutionArguments;
  ActiveExitCode.store(0);
  ActiveProcExit.store(false);
  ActiveExitReported.store(false);
  if (UseStart) {
    TRACE_LIFECYCLE("[WAMR/guest] running _start\n");
    Invocation.Succeeded = wasm_runtime_call_wasm_a(
        Invocation.Environment, Invocation.Function, 0, nullptr, 0, nullptr);
  } else if (UseDefaultEntry || Invocation.Entry == "main") {
    TRACE_LIFECYCLE("[WAMR/guest] running main(argc=%zu)\n", Argv.size());
    Invocation.Succeeded = wasm_application_execute_main(
        Invocation.Instance, static_cast<int32_t>(Argv.size()), Argv.data());
    if (Invocation.Succeeded && !Argv.empty())
      std::memcpy(&Invocation.Result, Argv.data(), sizeof(Invocation.Result));
  } else {
    TRACE_LIFECYCLE("[WAMR/guest] running %s(argc=%zu)\n",
                    Invocation.Entry.c_str(), Argv.size());
    Invocation.Succeeded = wasm_application_execute_func(
        Invocation.Instance, Invocation.Entry.c_str(),
        static_cast<int32_t>(Argv.size()), Argv.data());
  }
  if (ActiveProcExit.load()) {
    Invocation.Result = ActiveExitCode.load();
    Invocation.Succeeded = true;
    wasm_runtime_set_exception(Invocation.Instance, nullptr);
  }
  TRACE_LIFECYCLE("[WAMR/guest] call returned success=%d\n",
                  Invocation.Succeeded);
  if (!Invocation.Succeeded)
    std::fprintf(stderr, "guest error: %s\n",
                 wasm_runtime_get_exception(Invocation.Instance));

  // A host-invoked Wasm function returning does not terminate a WAMR-managed
  // application thread, so the debug engine has no natural thread-exit hook.
  // Complete the embedded GDB-remote session explicitly for this prototype.
  TRACE_LIFECYCLE("[WAMR/guest] reporting process exit to LLDB\n");
  if (!ActiveExitReported.exchange(true))
    send_process_exit_status(Invocation.Server,
                             Invocation.Succeeded ? Invocation.Result : 1);
  wasm_runtime_destroy_thread_env();
  return nullptr;
}

uint8_t *readFile(const char *Path, uint32_t &Size) {
  FILE *File = std::fopen(Path, "rb");
  if (!File)
    return nullptr;
  std::fseek(File, 0, SEEK_END);
  long Length = std::ftell(File);
  std::rewind(File);
  if (Length <= 0 || static_cast<unsigned long>(Length) > UINT32_MAX) {
    std::fclose(File);
    return nullptr;
  }
  auto *Bytes = static_cast<uint8_t *>(std::malloc(Length));
  if (!Bytes || std::fread(Bytes, 1, Length, File) != size_t(Length)) {
    std::free(Bytes);
    std::fclose(File);
    return nullptr;
  }
  std::fclose(File);
  Size = Length;
  return Bytes;
}

struct DebuggerState {
  std::string GuestPath;
  std::string Entry;
  std::vector<std::string> Arguments;
  char ErrorBuffer[256] = {};
  uint32_t GuestSize = 0;
  uint8_t *GuestBytes = nullptr;
  wasm_module_t Module = nullptr;
  wasm_module_inst_t Instance = nullptr;
  wasm_exec_env_t Environment = nullptr;
  WASMDebugInstance *DebugInstance = nullptr;
  pthread_t GuestThread{};
  RSPBridge Bridge;
  WASMDebugControlThread Control{};
  GuestInvocation Invocation;
  DebuggerSP Debugger;
  ProcessSP Process;
  std::thread StopPump;
  std::mutex CommandMutex;
  std::string CommandOutput;
};

std::unique_ptr<DebuggerState> State;

bool initializeDebugger(DebuggerState &S) {
  TRACE_LIFECYCLE("[WAMR/init 01] wasm_runtime_init\n");
  if (!wasm_runtime_init())
    return false;
  TRACE_LIFECYCLE("[WAMR/init 02] register WASI natives\n");
  if (!wasm_runtime_register_natives_raw(
          "wasi_snapshot_preview1", WasiSymbols,
          sizeof(WasiSymbols) / sizeof(WasiSymbols[0])))
    return false;
  TRACE_LIFECYCLE("[WAMR/init 03] read guest\n");
  S.GuestBytes = readFile(S.GuestPath.c_str(), S.GuestSize);
  if (!S.GuestBytes)
    return false;
  TRACE_LIFECYCLE("[WAMR/init 04] load guest (%u bytes)\n", S.GuestSize);
  S.Module = wasm_runtime_load(S.GuestBytes, S.GuestSize, S.ErrorBuffer,
                               sizeof(S.ErrorBuffer));
  if (!S.Module)
    return false;
  TRACE_LIFECYCLE("[WAMR/init 05] instantiate guest\n");
  S.Instance = wasm_runtime_instantiate(S.Module, 64 * 1024, 1024 * 1024,
                                        S.ErrorBuffer,
                                        sizeof(S.ErrorBuffer));
  if (!S.Instance)
    return false;
  TRACE_LIFECYCLE("[WAMR/init 06] create exec env\n");
  if (!wasm_runtime_create_exec_env_singleton(S.Instance))
    return false;
  S.Environment = wasm_runtime_get_exec_env_singleton(S.Instance);
  if (!S.Environment)
    return false;
  TRACE_LIFECYCLE("[WAMR/init 07] initialize debug engine\n");
  if (!wasm_debug_engine_init(nullptr, 0))
    return false;

  TRACE_LIFECYCLE("[WAMR/init 08] create embedded debug instance\n");
  S.DebugInstance = wasm_debug_instance_create_embedded(
      wasm_exec_env_get_cluster(S.Environment));
  if (!S.DebugInstance)
    return false;
  TRACE_LIFECYCLE("[WAMR/init 09] create embedded GDB server\n");
  S.Bridge.Server =
      wasm_create_gdbserver_embedded(receiveWamrBytes, &S.Bridge);
  if (!S.Bridge.Server)
    return false;
  S.Control.debug_instance = S.DebugInstance;
  S.Control.server = S.Bridge.Server;
  S.Bridge.Server->thread = &S.Control;
  S.Bridge.Server->module_name = S.GuestPath.c_str();

  S.Invocation.Environment = S.Environment;
  S.Invocation.Instance = S.Instance;
  S.Invocation.ProgramPath = S.GuestPath;
  S.Invocation.Entry = S.Entry;
  S.Invocation.Arguments = S.Arguments;
  if (S.Invocation.Entry.empty() || S.Invocation.Entry == "_start")
    S.Invocation.Function = wasm_runtime_lookup_function(S.Instance, "_start");
  S.Invocation.Server = S.Bridge.Server;
  S.Invocation.DebugInstance = S.DebugInstance;
  TRACE_LIFECYCLE("[WAMR/init 10] lookup entry\n");
  if (S.Invocation.Entry == "_start" && !S.Invocation.Function)
    return false;
  TRACE_LIFECYCLE("[WAMR/init 11] create guest pthread\n");
  if (pthread_create(&S.GuestThread, nullptr, runGuest, &S.Invocation) != 0)
    return false;

  TRACE_LIFECYCLE("[WAMR/init 12] get LLDB target\n");
  TargetSP Target = S.Debugger->GetTargetList().GetSelectedTarget();
  if (!Target) {
    std::fprintf(stderr, "target error: no selected LLDB target\n");
    return false;
  }

  TRACE_LIFECYCLE("[WAMR/init 13] create LLDB process\n");
  S.Process =
      Target->CreateProcess(S.Debugger->GetListener(), "wasm", nullptr, true);
  auto *Remote = static_cast<ProcessGDBRemote *>(S.Process.get());
  Remote->GetGDBRemote().SetConnection(
      std::make_unique<WamrConnection>(S.Bridge));
  TRACE_LIFECYCLE("[WAMR/init 14] connect LLDB process\n");
  Status ConnectStatus = S.Process->ConnectRemote("");
  if (ConnectStatus.Fail()) {
    std::fprintf(stderr, "connect error: %s\n", ConnectStatus.AsCString());
    return false;
  }

  // A socket GDB server reports loaded modules as XML. The embedded adapter
  // already owns the exact guest path and WAMR load address, so load that
  // module directly instead of adding libxml2 solely to parse our own reply.
  TRACE_LIFECYCLE("[WAMR/init 15] load embedded module\n");
  DynamicLoader *Loader = S.Process->GetDynamicLoader();
  FileSpec GuestFile(S.GuestPath);
  FileSystem::Instance().Resolve(GuestFile);
  const lldb::addr_t LoadAddress =
      wasm_debug_instance_get_load_addr(S.DebugInstance);
  ModuleSP LoadedModule =
      Loader ? Loader->LoadModuleAtAddress(GuestFile, LLDB_INVALID_ADDRESS,
                                           LoadAddress, false)
             : nullptr;
  if (!LoadedModule) {
    std::fprintf(stderr, "module load error: failed to load %s at 0x%" PRIx64
                         "\n",
                 S.GuestPath.c_str(), LoadAddress);
    return false;
  }
  ModuleList LoadedModules;
  LoadedModules.Append(LoadedModule);
  Target->ModulesDidLoad(LoadedModules);

  TRACE_LIFECYCLE("[WAMR/init 16] start stop pump\n");
  S.StopPump = std::thread([&S] {
    uint32_t StopStatus = 0;
    while (wasm_debug_instance_wait_for_stop(S.DebugInstance, &StopStatus)) {
      if (ActiveProcExit.load()) {
        ActiveExitReported.store(true);
        send_process_exit_status(S.Bridge.Server, ActiveExitCode.load());
        wasm_debug_instance_continue(S.DebugInstance);
        break;
      }
      korp_tid Thread = wasm_debug_instance_get_tid(S.DebugInstance);
      send_thread_stop_status(S.Bridge.Server, StopStatus, Thread);
    }
  });
  S.StopPump.detach();
  TRACE_LIFECYCLE("[WAMR/init 17] ready\n");
  return true;
}

} // namespace

extern "C" EMSCRIPTEN_KEEPALIVE const char *
wasmbolt_lldb_command(const char *Command) {
  if (!State || !State->Debugger)
    return "error: debugger is not ready\n";

  std::lock_guard<std::mutex> Lock(State->CommandMutex);
  llvm::StringRef Input(Command ? Command : "");
  Input = Input.trim();

  bool IsRun = Input == "run" || Input == "r" ||
               Input.starts_with("process launch");
  if (IsRun && !State->Process) {
    if (!initializeDebugger(*State)) {
      State->CommandOutput =
          "error: failed to launch the WebAssembly process\n";
      return State->CommandOutput.c_str();
    }
    Input = "process continue";
  }

  CommandReturnObject Result(/*colors=*/false);
  std::string CommandLine = Input.str();
  State->Debugger->GetCommandInterpreter().HandleCommand(
      CommandLine.c_str(), eLazyBoolNo, Result);
  State->CommandOutput = Result.GetOutputString().str();
  State->CommandOutput += Result.GetErrorString();
  return State->CommandOutput.c_str();
}

int main() {
  State = std::make_unique<DebuggerState>();
  SBDebugger::Initialize();
  State->Debugger = Debugger::CreateInstance();
  State->Debugger->SetAsyncExecution(false);
  CommandReturnObject PlatformResult(/*colors=*/false);
  State->Debugger->GetCommandInterpreter().HandleCommand(
      "platform select wasm", eLazyBoolNo, PlatformResult);
  return 0;
}
