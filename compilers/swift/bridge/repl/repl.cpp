#include "swift/Frontend/Frontend.h"
#include "swift/AST/ASTContext.h"
#include "swift/Frontend/PrintingDiagnosticConsumer.h"
#include "swift/Immediate/Interpreter.h"
#include "swift/Basic/InitializeSwiftModules.h"
#include "swift/Basic/LLVMInitialize.h"
#include "swift/SIL/SILBridging.h"
#include "llvm/Support/raw_ostream.h"
#include <cstdio>
#include <memory>
namespace {
swift::PrintingDiagnosticConsumer diagnostics;
std::unique_ptr<swift::CompilerInstance> compiler;
std::unique_ptr<swift::Interpreter> interpreter;
}
extern "C" int wb_swift_repl_initialize() {
  if (interpreter) return 0;
  INITIALIZE_LLVM();
  if (!swiftModulesInitialized()) initializeSwiftModules();
  compiler = std::make_unique<swift::CompilerInstance>();
  compiler->addDiagnosticConsumer(&diagnostics);
  swift::CompilerInvocation invocation;
  const char *arguments[] = {"-repl", "-target", "wasm32-unknown-emscripten",
      "-sdk", "/", "-resource-dir", "/swift/lib/swift", "-module-name", "WasmBoltREPL",
      "-num-threads", "0", "-Onone", "-disable-implicit-concurrency-module-import",
      "-disable-implicit-string-processing-module-import", "-Xcc", "-pthread",
      "-Xcc", "-isystem", "-Xcc", "/include/compat", "-Xcc", "-fPIC",
      "-Xcc", "-resource-dir=/swift/lib/swift/clang"};
  if (invocation.parseArgs(arguments, compiler->getDiags())) return 1;
  std::string error;
  if (compiler->setup(invocation, error, arguments)) {
    llvm::errs() << error << '\n';
    return 1;
  }
  interpreter = std::make_unique<swift::Interpreter>(*compiler, swift::ProcessCmdLine{}, false);
  llvm::outs().flush(); llvm::errs().flush(); std::fflush(nullptr);
  return interpreter->isReady() && !compiler->getASTContext().hadError() ? 0 : 1;
}
extern "C" int wb_swift_repl_execute(const char *source) {
  if (!interpreter) return 2;
  auto result = interpreter->parseAndExecute(source);
  llvm::outs().flush(); llvm::errs().flush(); std::fflush(nullptr);
  return static_cast<int>(result);
}
extern "C" int wb_swift_repl_is_complete(const char *source) {
  return interpreter && interpreter->isInputComplete(source).IsComplete;
}
