#include "swift/AST/DiagnosticEngine.h"
#include "swift/Basic/SourceManager.h"
#include "swift/Basic/TaskQueue.h"
#include "swift/Driver/Compilation.h"
#include "swift/Driver/Driver.h"
#include "swift/Driver/ToolChain.h"
#include "swift/Frontend/PrintingDiagnosticConsumer.h"
#include "swift/Option/Options.h"
#include "clang/Basic/Diagnostic.h"
#include "clang/Basic/DiagnosticIDs.h"
#include "clang/Basic/DiagnosticOptions.h"
#include "clang/Driver/Compilation.h"
#include "clang/Driver/Driver.h"
#include "clang/Driver/Job.h"
#include "clang/Frontend/TextDiagnosticPrinter.h"
#include "llvm/Support/Allocator.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/StringSaver.h"
#include "llvm/Support/raw_ostream.h"

#include <queue>

// Executes the upstream driver's jobs in this module instead of spawning tools.
int runSwiftTool(llvm::ArrayRef<const char *> args);

namespace {
bool expand(llvm::SmallVectorImpl<const char *> &args,
            llvm::StringSaver &saver) {
  if (llvm::cl::ExpandResponseFiles(saver, llvm::cl::TokenizeGNUCommandLine, args))
    return true;
  llvm::errs() << "Could not read command response file.\n";
  return false;
}

class BrowserTaskQueue final : public swift::sys::TaskQueue {
  struct Task {
    std::string executable;
    llvm::SmallVector<const char *, 32> args;
    void *context;
  };
  std::queue<Task> tasks;
  swift::sys::ProcessId nextId = 1;

public:
  BrowserTaskQueue() : TaskQueue(1) {}
  void addTask(const char *executable, llvm::ArrayRef<const char *> args,
               llvm::ArrayRef<const char *> env, void *context,
               bool separateErrors) override {
    tasks.push({executable, {args.begin(), args.end()}, context});
  }
  bool hasRemainingTasks() override { return !tasks.empty(); }
  bool execute(TaskBeganCallback began, TaskFinishedCallback finished,
               TaskSignalledCallback signalled) override {
    while (!tasks.empty()) {
      auto task = std::move(tasks.front());
      tasks.pop();
      const auto id = nextId++;
      if (began) began(id, task.context);
      llvm::SmallVector<const char *, 32> args{task.executable.c_str()};
      args.append(task.args);
      const int code = runSwiftTool(args);
      if (finished && finished(id, code, {}, {},
                              swift::sys::TaskProcessInformation(id),
                              task.context) ==
                          swift::sys::TaskFinishedResponse::StopExecution)
        break;
    }
    return false;
  }
};
}

int runSwiftDriver(llvm::ArrayRef<const char *> args) {
  if (args.size() > 1 && llvm::StringRef(args[1]) == "-frontend")
    return runSwiftTool(args);
  llvm::BumpPtrAllocator allocator;
  llvm::StringSaver saver(allocator);
  // Installed toolchain defaults precede user options; the driver still parses
  // every argument, including -Xfrontend, -Xcc, -Xlinker and response files.
  llvm::SmallVector<const char *, 32> expanded{args.front(),
                                            "@/swift/etc/wasmbolt.cfg"};
  expanded.append(args.begin() + 1, args.end());
  if (!expand(expanded, saver)) return 1;
  swift::SourceManager sourceManager;
  swift::DiagnosticEngine diagnostics(sourceManager);
  swift::PrintingDiagnosticConsumer printer;
  diagnostics.addConsumer(printer);
  const std::string path = "/swift/bin/" + llvm::StringRef(args.front()).str();
  swift::driver::Driver driver(path, args.front(), expanded, diagnostics);
  auto parsed = driver.parseArgStrings(driver.getArgsWithoutProgramNameAndDriverMode(expanded));
  if (!parsed || diagnostics.hadAnyError()) return 1;
  auto toolchain = driver.buildToolChain(*parsed);
  if (!toolchain || diagnostics.hadAnyError()) return 1;
  auto compilation = driver.buildCompilation(*toolchain, std::move(parsed));
  if (diagnostics.hadAnyError()) return 1;
  if (!compilation) return 0; // --version and --help are immediate driver actions.
  // The driver uses a dummy executor for -###; a dry run must never emit files.
  auto queue = driver.buildTaskQueue(*compilation);
  if (!queue || diagnostics.hadAnyError()) return 1;
  if (!compilation->getArgs().hasArg(swift::options::OPT_driver_skip_execution,
                                   swift::options::OPT_driver_print_jobs))
    queue = std::make_unique<BrowserTaskQueue>();
  return compilation->performJobs(std::move(queue),
                                  /*AllowInPlaceExecution=*/false).exitCode;
}

int runClangLinkDriver(llvm::ArrayRef<const char *> args) {
  llvm::BumpPtrAllocator allocator;
  llvm::StringSaver saver(allocator);
  llvm::SmallVector<const char *, 32> expanded(args);
  if (!expand(expanded, saver)) return 1;
  clang::DiagnosticOptions options;
  clang::TextDiagnosticPrinter printer(llvm::errs(), options);
  clang::DiagnosticsEngine diagnostics(
      llvm::makeIntrusiveRefCnt<clang::DiagnosticIDs>(), options, &printer,
      /*ShouldOwnClient=*/false);
  clang::driver::Driver driver("/swift/bin/clang", "wasm32-unknown-emscripten",
                               diagnostics);
  std::unique_ptr<clang::driver::Compilation> compilation(
      driver.BuildCompilation(expanded));
  if (!compilation || diagnostics.hasErrorOccurred()) return 1;
  for (const auto &job : compilation->getJobs()) {
    llvm::SmallVector<const char *, 32> invocation{job.getExecutable()};
    invocation.append(job.getArguments());
    if (int code = runSwiftTool(invocation)) return code;
  }
  return 0;
}
