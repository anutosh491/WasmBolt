#include "swift/FrontendTool/FrontendTool.h"
#include "swift/Basic/InitializeSwiftModules.h"
#include "lld/Common/Driver.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/Allocator.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/StringSaver.h"
#include "llvm/Support/raw_ostream.h"

#include <mutex>
#include <cstdio>
#include <string>
#include <vector>

LLD_HAS_DRIVER(wasm)
int runSwiftDriver(llvm::ArrayRef<const char *> args);
int runClangLinkDriver(llvm::ArrayRef<const char *> args);
extern int autolink_extract_main(llvm::ArrayRef<const char *> args,
                                const char *argv0, void *mainAddr);

namespace {
// Both frontends own process-wide LLVM state, including diagnostic handlers.
// Keep calls serial even when the module is built with pthreads for LLDB.
std::mutex toolMutex;
bool canRunAgain = true;
bool swiftInitialized = false;
}

int runSwiftTool(llvm::ArrayRef<const char *> arguments) {
  llvm::BumpPtrAllocator allocator;
  llvm::StringSaver saver(allocator);
  llvm::SmallVector<const char *, 32> args(arguments);
  if (!llvm::cl::ExpandResponseFiles(saver, llvm::cl::TokenizeGNUCommandLine, args)) {
    llvm::errs() << "Could not read tool response file.\n";
    return 1;
  }
  const auto tool = llvm::sys::path::filename(args.front());
  if (tool == "swift-frontend" ||
      ((tool == "swift" || tool == "swiftc") && args.size() > 1 &&
       llvm::StringRef(args[1]) == "-frontend")) {
    if (!swiftInitialized) {
      initializeSwiftModules();
      swiftInitialized = true;
    }
    return swift::performFrontend(llvm::ArrayRef<const char *>(args).drop_front(tool == "swift-frontend" ? 1 : 2),
        "/swift/bin/swift-frontend", reinterpret_cast<void *>(&runSwiftTool));
  }
  if (tool == "swift-autolink-extract")
    return autolink_extract_main(llvm::ArrayRef<const char *>(args).drop_front(), args.front(),
                                reinterpret_cast<void *>(&runSwiftTool));
  if (tool == "clang") return runClangLinkDriver(args);
  if (tool == "wasm-ld") {
    auto result = lld::lldMain(args, llvm::outs(), llvm::errs(),
                               {{lld::Wasm, &lld::wasm::link}});
    canRunAgain = result.canRunAgain;
    return result.retCode;
  }
  llvm::errs() << "Tool is not built into this browser toolchain: " << tool << '\n';
  return 64;
}

// The first array element selects swift, swiftc, swift-frontend or wasm-ld. Remaining elements
// are their real command-line arguments, with files in the module's filesystem.
extern "C" int wb_swift_run(const char *json) {
  std::lock_guard<std::mutex> lock(toolMutex);
  if (!canRunAgain) {
    llvm::errs() << "The linker crashed; reload the compiler before retrying.\n";
    return 70;
  }

  auto value = llvm::json::parse(json);
  if (!value) {
    llvm::logAllUnhandledErrors(value.takeError(), llvm::errs(),
                                "Invalid tool arguments: ");
    return 64;
  }
  auto *array = value->getAsArray();
  if (!array || array->empty()) {
    llvm::errs() << "Tool arguments must be a non-empty JSON string array.\n";
    return 64;
  }

  std::vector<std::string> strings;
  strings.reserve(array->size());
  for (const auto &item : *array) {
    auto argument = item.getAsString();
    if (!argument || argument->contains('\0')) {
      llvm::errs() << "Every tool argument must be a string without NUL bytes.\n";
      return 64;
    }
    strings.push_back(argument->str());
  }
  llvm::SmallVector<const char *, 32> args;
  for (const auto &argument : strings)
    args.push_back(argument.c_str());

  const int status = strings.front() == "swift" || strings.front() == "swiftc"
      ? runSwiftDriver(args) : runSwiftTool(args);
  llvm::outs().flush();
  llvm::errs().flush();
  std::fflush(stdout);
  std::fflush(stderr);
  return status;
}

extern "C" int wb_swift_can_run_again() {
  std::lock_guard<std::mutex> lock(toolMutex);
  return canRunAgain;
}
