#define State WasmRuntimeState
#define main wasmbolt_terminal_main
#include "live-debugger.cpp"
#undef main
#undef State

#include "DAP.h"
#include "DAPLog.h"
#include "DAPSessionManager.h"
#include "EventHelper.h"
#include "Handler/RequestHandler.h"
#include "Handler/ResponseHandler.h"
#include "Transport.h"
#include "lldb/API/SBDebugger.h"
#include "lldb/API/SBEvent.h"
#include "lldb/API/SBListener.h"
#include "lldb/API/SBProcess.h"
#include "lldb/API/SBStream.h"
#include "lldb/Host/MainLoop.h"
#include "llvm/Support/Error.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/raw_ostream.h"

#include <emscripten/emscripten.h>

#include <atomic>
#include <chrono>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using namespace lldb_dap;

namespace {

constexpr bool TraceDAP = false;

class BrowserTransport final : public DAPTransport {
public:
  llvm::Error Send(const protocol::Event &Message) override {
    if (TraceDAP)
      llvm::errs() << "[DAP/event] " << llvm::StringRef(Message.event)
                   << '\n';
    if (llvm::StringRef(Message.event) == "stopped") {
      if (!PublishPolledStop.exchange(false, std::memory_order_acq_rel))
        return llvm::Error::success();
    }
    return Store(protocol::toJSON(Message));
  }

  llvm::Error Send(const protocol::Request &Message) override {
    return Store(protocol::toJSON(Message));
  }

  llvm::Error Send(const protocol::Response &Message) override {
    return Store(protocol::toJSON(Message));
  }

  llvm::Error RegisterMessageHandler(MessageHandler &NewHandler) override {
    Handler = &NewHandler;
    return llvm::Error::success();
  }

  void PublishNextStoppedEvent() {
    PublishPolledStop.store(true, std::memory_order_release);
  }

  void CancelStoppedEventPublication() {
    PublishPolledStop.store(false, std::memory_order_release);
  }

  std::size_t MessageCount() const {
    std::lock_guard<std::mutex> Lock(MessagesMutex);
    return Messages.size();
  }

  const char *PopMessage() {
    std::lock_guard<std::mutex> Lock(MessagesMutex);
    if (Messages.empty())
      return nullptr;
    LastMessage = std::move(Messages.front());
    Messages.pop_front();
    return LastMessage.c_str();
  }

protected:
  void Log(llvm::StringRef) override {}

private:
  llvm::Error Store(llvm::json::Value Message) {
    std::lock_guard<std::mutex> Lock(MessagesMutex);
    Messages.push_back(llvm::formatv("{0:2}", Message).str());
    return llvm::Error::success();
  }

  MessageHandler *Handler = nullptr;
  std::atomic<bool> PublishPolledStop{false};
  mutable std::mutex MessagesMutex;
  std::deque<std::string> Messages;
  std::string LastMessage;
};

struct BrowserDAPState {
  lldb_dap::Log::Mutex LogMutex;
  lldb_dap::Log DAPLog{llvm::nulls(), LogMutex};
  lldb_private::MainLoop Loop;
  BrowserTransport Transport;
  std::unique_ptr<DAP> Adapter;
  std::string LastError;
  std::string SessionJSON;
  bool AwaitingStop = false;
  bool PendingPause = false;
  bool ExitPublished = false;

  BrowserDAPState() {
    if (TraceDAP)
      llvm::errs() << "[DAP probe] constructing adapter\n";
    std::vector<protocol::String> PreInitCommands;
    Adapter = std::make_unique<DAP>(
        DAPLog, ReplMode::Auto, PreInitCommands,
        /*no_lldbinit=*/true, "wasmbolt", Transport, Loop);
    if (llvm::Error Error = Transport.RegisterMessageHandler(*Adapter))
      LastError = llvm::toString(std::move(Error));
    if (LastError.empty()) {
      if (llvm::Error Error = Adapter->ConfigureIO())
        LastError = llvm::toString(std::move(Error));
    }
    if (LastError.empty())
      DAPSessionManager::GetInstance().RegisterSession(&Loop, Adapter.get());
    if (TraceDAP)
      llvm::errs() << "[DAP probe] adapter ready\n";
  }

  ~BrowserDAPState() {
    DAPSessionManager::GetInstance().UnregisterSession(&Loop);
  }
};

std::unique_ptr<BrowserDAPState> State;

int SetError(llvm::Error Error) {
  State->LastError = llvm::toString(std::move(Error));
  return 1;
}

bool ResumesProcess(llvm::StringRef Command) {
  return Command == "configurationDone" || Command == "continue" ||
         Command == "next" || Command == "pause" ||
         Command == "reverseContinue" || Command == "stepIn" ||
         Command == "stepOut";
}

} // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int wasmbolt_dap_initialize() {
  if (State)
    return 0;
  State = std::make_unique<BrowserDAPState>();
  return State->LastError.empty() ? 0 : 1;
}

EMSCRIPTEN_KEEPALIVE int
wasmbolt_dap_prepare_wamr_session(const char *ModulePath, const char *Entry,
                                  const char *ArgumentsJSON) {
  if (TraceDAP)
    llvm::errs() << "[DAP/prepare 01] enter\n";
  if (!State && wasmbolt_dap_initialize() != 0)
    return 1;
  if (WasmRuntimeState)
    return 0;
  if (!ModulePath || !*ModulePath) {
    State->LastError = "the WebAssembly module path is empty";
    return 1;
  }

  std::vector<std::string> Arguments;
  if (ArgumentsJSON && *ArgumentsJSON) {
    llvm::Expected<llvm::json::Value> Parsed =
        llvm::json::parse(ArgumentsJSON);
    if (!Parsed)
      return SetError(Parsed.takeError());
    llvm::json::Array *Array = Parsed->getAsArray();
    if (!Array) {
      State->LastError = "debug arguments must be a JSON array of strings";
      return 1;
    }
    for (llvm::json::Value &Value : *Array) {
      std::optional<llvm::StringRef> Argument = Value.getAsString();
      if (!Argument) {
        State->LastError = "debug arguments must be a JSON array of strings";
        return 1;
      }
      Arguments.push_back(Argument->str());
    }
  }

  if (TraceDAP)
    llvm::errs() << "[DAP/prepare 02] InitializeDebugger\n";
  if (llvm::Error Error = State->Adapter->InitializeDebugger())
    return SetError(std::move(Error));
  // Browser pthreads cannot reliably deliver LLDB's process events back to
  // this Worker. Stop the native event publisher before starting the process;
  // wasmbolt_dap_poll_runtime publishes the same DAP events from the Worker.
  State->Adapter->StopEventHandlers();

  // Keep execution asynchronous so this Worker can accept Pause while the
  // inferior is running, as native lldb-dap does.
  State->Adapter->debugger.SetAsync(true);

  if (TraceDAP)
    llvm::errs() << "[DAP/prepare 03] CreateTarget\n";
  lldb::SBError TargetError;
  lldb::SBTarget Target = State->Adapter->debugger.CreateTarget(
      ModulePath, /*target_triple=*/nullptr, "wasm",
      /*add_dependent_modules=*/true, TargetError);
  if (TargetError.Fail() || !Target.IsValid()) {
    State->LastError = TargetError.GetCString()
                           ? TargetError.GetCString()
                           : "failed to create the WebAssembly target";
    return 1;
  }
  if (TraceDAP)
    llvm::errs() << "[DAP/prepare 04] SetTarget\n";
  State->Adapter->SetTarget(Target);

  if (TraceDAP)
    llvm::errs() << "[DAP/prepare 05] allocate runtime state\n";
  WasmRuntimeState = std::make_unique<DebuggerState>();
  WasmRuntimeState->GuestPath = ModulePath;
  WasmRuntimeState->Entry = Entry ? Entry : "";
  WasmRuntimeState->Arguments = std::move(Arguments);
  if (TraceDAP)
    llvm::errs() << "[DAP/prepare 06] FindDebuggerWithID\n";
  WasmRuntimeState->Debugger =
      lldb_private::Debugger::FindDebuggerWithID(
          State->Adapter->debugger.GetID());
  if (!WasmRuntimeState->Debugger) {
    State->LastError = "failed to find the LLDB debugger";
    WasmRuntimeState.reset();
    return 1;
  }
  if (TraceDAP)
    llvm::errs() << "[DAP/prepare 07] initializeDebugger\n";
  if (!initializeDebugger(*WasmRuntimeState)) {
    State->LastError = "failed to connect LLDB to the embedded WAMR runtime";
    WasmRuntimeState.reset();
    return 1;
  }
  if (TraceDAP)
    llvm::errs() << "[DAP/prepare 08] ready\n";
  State->LastError.clear();
  return 0;
}

EMSCRIPTEN_KEEPALIVE unsigned long long wasmbolt_dap_debugger_id() {
  if (!State || !State->Adapter)
    return 0;
  return State->Adapter->debugger.GetID();
}

EMSCRIPTEN_KEEPALIVE unsigned long long wasmbolt_dap_target_id() {
  if (!State || !State->Adapter || !State->Adapter->target.IsValid())
    return 0;
  return State->Adapter->target.GetGloballyUniqueID();
}

EMSCRIPTEN_KEEPALIVE const char *wasmbolt_dap_session_json() {
  if (!State || !State->Adapter || !State->Adapter->target.IsValid())
    return nullptr;
  State->SessionJSON =
      llvm::formatv("{{\"debuggerId\":{0},\"targetId\":{1}}",
                    State->Adapter->debugger.GetID(),
                    State->Adapter->target.GetGloballyUniqueID())
          .str();
  return State->SessionJSON.c_str();
}

EMSCRIPTEN_KEEPALIVE int wasmbolt_lldb_initialize() {
  lldb::SBError Error = lldb::SBDebugger::InitializeWithErrorHandling();
  if (Error.Success())
    return 0;

  lldb::SBStream Description;
  Error.GetDescription(Description);
  llvm::errs() << "LLDB initialization failed: " << Description.GetData()
               << '\n';
  return 1;
}

EMSCRIPTEN_KEEPALIVE int wasmbolt_dap_send_json(const char *JSON) {
  if (TraceDAP)
    llvm::errs() << "[DAP probe] received JSON\n";
  if (!State && wasmbolt_dap_initialize() != 0)
    return 1;
  if (!JSON) {
    State->LastError = "DAP request is null";
    return 1;
  }

  llvm::Expected<llvm::json::Value> Parsed = llvm::json::parse(JSON);
  if (!Parsed)
    return SetError(Parsed.takeError());

  llvm::json::Object *Object = Parsed->getAsObject();
  std::optional<int64_t> Sequence =
      Object ? Object->getInteger("seq") : std::nullopt;
  std::optional<llvm::StringRef> Command =
      Object ? Object->getString("command") : std::nullopt;
  if (TraceDAP && Command)
    llvm::errs() << "[DAP/request] seq=" << Sequence.value_or(-1)
                 << " command=" << *Command << " enter\n";

  protocol::Message Message;
  llvm::json::Path::Root Root;
  if (!protocol::fromJSON(*Parsed, Message, Root))
    return SetError(Root.getError());

  if (TraceDAP)
    llvm::errs() << "[DAP probe] dispatching message\n";
  lldb::SBProcess Process = State->Adapter->target.GetProcess();
  const bool WaitForStop = Command && ResumesProcess(*Command);
  if (!State->Adapter->HandleObject(Message)) {
    State->LastError = "lldb-dap did not handle the message";
    return 1;
  }
  // The upstream attach handler initializes the shared debugger again and
  // starts a new event thread. Browser stop events remain poll-owned.
  if (Command && *Command == "attach")
    State->Adapter->StopEventHandlers();
  if (WaitForStop && Process.IsValid()) {
    State->AwaitingStop = true;
    State->PendingPause = *Command == "pause";
    if (TraceDAP)
      llvm::errs() << "[DAP/resume] command=" << *Command << '\n';
  }
  if (TraceDAP && Command)
    llvm::errs() << "[DAP/request] seq=" << Sequence.value_or(-1)
                 << " command=" << *Command << " exit\n";
  if (TraceDAP)
    llvm::errs() << "[DAP probe] dispatch complete\n";
  State->LastError.clear();
  return 0;
}

EMSCRIPTEN_KEEPALIVE int wasmbolt_dap_poll_runtime() {
  if (!State || !State->Adapter || !WasmRuntimeState ||
      !WasmRuntimeState->Process)
    return 0;

  lldb::SBListener Listener = State->Adapter->debugger.GetListener();
  lldb::SBEvent Event;
  while (Listener.GetNextEvent(Event)) {
    if (!lldb::SBProcess::EventIsProcessEvent(Event))
      continue;

    lldb::SBProcess Process = lldb::SBProcess::GetProcessFromEvent(Event);
    const uint32_t Mask = Event.GetType();
    if ((Mask & lldb::SBProcess::eBroadcastBitSTDOUT) ||
        (Mask & lldb::SBProcess::eBroadcastBitSTDERR)) {
      SendStdOutStdErr(*State->Adapter, Process);
      continue;
    }
    if (!(Mask & lldb::SBProcess::eBroadcastBitStateChanged))
      continue;

    const lldb::StateType ProcessState =
        lldb::SBProcess::GetStateFromEvent(Event);
    if (TraceDAP)
      llvm::errs() << "[DAP/poll] process-state="
                   << static_cast<unsigned>(ProcessState) << '\n';
    if (ProcessState == lldb::eStateRunning ||
        ProcessState == lldb::eStateStepping) {
      State->Adapter->WillContinue();
      SendContinuedEvent(*State->Adapter);
      continue;
    }
    if (ProcessState == lldb::eStateExited) {
      if (!State->ExitPublished) {
        lldb::SBStream Status;
        Process.GetStatus(Status);
        State->Adapter->SendOutput(OutputType::Console, Status.GetData());
        State->Adapter->RunExitCommands();
        SendProcessExitedEvent(*State->Adapter, Process);
        State->Adapter->SendTerminatedEvent();
        State->ExitPublished = true;
      }
      continue;
    }
    if (!lldb::SBDebugger::StateIsStoppedState(ProcessState) ||
        lldb::SBProcess::GetRestartedFromEvent(Event) ||
        !State->AwaitingStop)
      continue;

    SendStdOutStdErr(*State->Adapter, Process);
    State->Transport.PublishNextStoppedEvent();
    if (State->PendingPause) {
      lldb::SBThread Thread = Process.GetSelectedThread();
      if (!Thread.IsValid()) {
        State->Transport.CancelStoppedEventPublication();
        State->LastError = "the paused process has no selected thread";
        return 1;
      }
      protocol::StoppedEventBody Body;
      Body.reason = protocol::eStoppedReasonPause;
      Body.threadId = Thread.GetThreadID();
      Body.allThreadsStopped = true;
      State->Adapter->focus_tid = Thread.GetThreadID();
      State->Adapter->Send(protocol::Event{"stopped", std::move(Body)});
      State->PendingPause = false;
    } else if (llvm::Error Error =
                   SendThreadStoppedEvent(*State->Adapter)) {
      State->Transport.CancelStoppedEventPublication();
      return SetError(std::move(Error));
    }
    State->AwaitingStop = false;
  }
  return 0;
}

EMSCRIPTEN_KEEPALIVE int wasmbolt_dap_message_count() {
  return State ? static_cast<int>(State->Transport.MessageCount()) : 0;
}

EMSCRIPTEN_KEEPALIVE const char *wasmbolt_dap_pop_message() {
  return State ? State->Transport.PopMessage() : nullptr;
}

EMSCRIPTEN_KEEPALIVE const char *wasmbolt_dap_last_error() {
  return State ? State->LastError.c_str() : "lldb-dap is not initialized";
}

} // extern "C"

int main() { return wasmbolt_dap_initialize(); }
