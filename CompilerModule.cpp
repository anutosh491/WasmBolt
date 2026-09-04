#include "clang/Basic/TargetOptions.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/CompilerInvocation.h"
#include "clang/FrontendTool/Utils.h"
#include "clang/Tooling/Tooling.h"
#include "lld/Common/Driver.h"
#include "llvm/ADT/ArrayRef.h"
#include "llvm/ADT/IntrusiveRefCntPtr.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/Config/llvm-config.h"
#include "llvm/IR/LegacyPassManager.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Verifier.h"
#include "llvm/IRReader/IRReader.h"
#include "llvm/MC/TargetRegistry.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Support/CodeGen.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/SourceMgr.h"
#include "llvm/Support/StringSaver.h"
#include "llvm/Support/TargetSelect.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Target/TargetMachine.h"
#include "llvm/Target/TargetOptions.h"
#include "llvm/TargetParser/Triple.h"

#include <dlfcn.h>
#include <emscripten.h>
#include <graphviz/cgraph.h>
#include <graphviz/gvc.h>
#include <graphviz/gvcext.h>

#include <cmath>
#include <cstdint>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

LLD_HAS_DRIVER(wasm)

extern "C" int wasmbolt_llc_main(int argc, char **argv);

extern "C" {
extern gvplugin_library_t gvplugin_dot_layout_LTX_library;
extern gvplugin_library_t gvplugin_core_LTX_library;
}

namespace {

class ExecuteCompilerToolAction final : public clang::tooling::ToolAction {
public:
  bool runInvocation(
      std::shared_ptr<clang::CompilerInvocation> Invocation,
      clang::FileManager *Files,
      std::shared_ptr<clang::PCHContainerOperations> PCHContainerOps,
      clang::DiagnosticConsumer *DiagConsumer) override {
    clang::CompilerInstance Compiler(std::move(Invocation),
                                     std::move(PCHContainerOps));
    Compiler.setVirtualFileSystem(Files->getVirtualFileSystemPtr());
    Compiler.setFileManager(Files);
    Compiler.createDiagnostics(DiagConsumer, /*ShouldOwnClient=*/false);
    Compiler.createSourceManager();

    const bool Success = clang::ExecuteCompilerInvocation(&Compiler);
    Compiler.clearOutputFiles(/*EraseFiles=*/!Success);
    return Success;
  }
};

void initializeTargets() {
  static const bool Initialized = [] {
    llvm::InitializeAllTargetInfos();
    llvm::InitializeAllTargets();
    llvm::InitializeAllTargetMCs();
    llvm::InitializeAllAsmPrinters();
    llvm::InitializeAllAsmParsers();
    return true;
  }();
  (void)Initialized;
}

std::vector<std::string> tokenize(llvm::StringRef Command) {
  llvm::BumpPtrAllocator Allocator;
  llvm::StringSaver Saver(Allocator);
  llvm::SmallVector<const char *, 32> Tokens;
  llvm::cl::TokenizeGNUCommandLine(Command, Saver, Tokens);

  std::vector<std::string> Result;
  Result.reserve(Tokens.size());
  for (const char *Token : Tokens)
    Result.emplace_back(Token);
  return Result;
}

int runClang(std::vector<std::string> Args) {
  initializeTargets();
  clang::FileSystemOptions FileSystemOpts;
  auto Files = llvm::makeIntrusiveRefCnt<clang::FileManager>(FileSystemOpts);
  ExecuteCompilerToolAction Action;
  clang::tooling::ToolInvocation Invocation(
      std::move(Args), &Action, Files.get(),
      std::make_shared<clang::PCHContainerOperations>());
  return Invocation.run() ? 0 : 1;
}

int runLld(const std::vector<std::string> &Args) {
  std::vector<const char *> Argv;
  Argv.reserve(Args.size());
  for (const std::string &Arg : Args)
    Argv.push_back(Arg.c_str());

  const lld::DriverDef WasmDriver = {lld::Flavor::Wasm, &lld::wasm::link};
  const lld::Result Result = lld::lldMain(
      llvm::ArrayRef<const char *>(Argv), llvm::outs(), llvm::errs(),
      llvm::ArrayRef<lld::DriverDef>(&WasmDriver, 1));
  return Result.retCode == 0 && Result.canRunAgain ? 0 : 1;
}

int runOpt(const std::vector<std::string> &Args) {
  std::string Input;
  std::string Output = "-";
  std::string Pipeline = "default<O2>";
  std::string TargetTriple;
  std::string CPU = "generic";
  std::string Features;
  bool DisableOutput = false;

  for (std::size_t I = 1; I < Args.size(); ++I) {
    llvm::StringRef Arg = Args[I];
    auto NextValue = [&](llvm::StringRef Option, std::string &Value) {
      if (Arg == Option && I + 1 < Args.size()) {
        Value = Args[++I];
        return true;
      }
      llvm::StringRef WithEquals = Arg;
      if (WithEquals.consume_front(Option) && WithEquals.consume_front("=")) {
        Value = WithEquals.str();
        return true;
      }
      return false;
    };

    if (Arg == "-o" && I + 1 < Args.size()) {
      Output = Args[++I];
    } else if (Arg == "-disable-output") {
      DisableOutput = true;
    } else if (Arg == "-S") {
      continue;
    } else if (Arg.consume_front("-passes=")) {
      Pipeline = Arg.str();
    } else if (Arg.consume_front("--passes=")) {
      Pipeline = Arg.str();
    } else if (NextValue("-mtriple", TargetTriple) ||
               NextValue("--mtriple", TargetTriple) ||
               NextValue("-mcpu", CPU) || NextValue("--mcpu", CPU) ||
               NextValue("-mattr", Features) ||
               NextValue("--mattr", Features)) {
      continue;
    } else if (!Arg.starts_with("-")) {
      Input = Arg.str();
    } else {
      llvm::errs() << "opt: unsupported in-process option '" << Arg << "'\n";
      return 2;
    }
  }

  if (Input.empty()) {
    llvm::errs() << "opt: no input LLVM IR file\n";
    return 2;
  }

  llvm::LLVMContext Context;
  llvm::SMDiagnostic Diagnostic;
  std::unique_ptr<llvm::Module> Module =
      llvm::parseIRFile(Input, Diagnostic, Context);
  if (!Module) {
    Diagnostic.print("opt", llvm::errs());
    return 1;
  }

  std::unique_ptr<llvm::TargetMachine> TM;
  if (!TargetTriple.empty()) {
    llvm::Triple Triple(llvm::Triple::normalize(TargetTriple));
    std::string Error;
    const llvm::Target *Target =
        llvm::TargetRegistry::lookupTarget(Triple, Error);
    if (!Target) {
      llvm::errs() << "opt: " << Error << '\n';
      return 1;
    }
    llvm::TargetOptions Options;
    TM.reset(Target->createTargetMachine(Triple, CPU, Features, Options,
                                         std::nullopt));
    if (!TM) {
      llvm::errs() << "opt: could not create target machine for '"
                   << TargetTriple << "'\n";
      return 1;
    }
    Module->setTargetTriple(Triple);
    Module->setDataLayout(TM->createDataLayout());
  }

  llvm::LoopAnalysisManager LAM;
  llvm::FunctionAnalysisManager FAM;
  llvm::CGSCCAnalysisManager CGAM;
  llvm::ModuleAnalysisManager MAM;
  llvm::PassBuilder PB(TM.get());
  PB.registerModuleAnalyses(MAM);
  PB.registerCGSCCAnalyses(CGAM);
  PB.registerFunctionAnalyses(FAM);
  PB.registerLoopAnalyses(LAM);
  PB.crossRegisterProxies(LAM, FAM, CGAM, MAM);

  llvm::ModulePassManager MPM;
  if (llvm::Error Error = PB.parsePassPipeline(MPM, Pipeline)) {
    llvm::errs() << "opt: " << llvm::toString(std::move(Error)) << '\n';
    return 1;
  }
  MPM.run(*Module, MAM);

  if (llvm::verifyModule(*Module, &llvm::errs()))
    return 1;
  if (DisableOutput)
    return 0;
  if (Output == "-") {
    Module->print(llvm::outs(), nullptr);
    return 0;
  }

  std::error_code EC;
  llvm::raw_fd_ostream OS(Output, EC, llvm::sys::fs::OF_Text);
  if (EC) {
    llvm::errs() << "opt: cannot open " << Output << ": " << EC.message()
                 << '\n';
    return 1;
  }
  Module->print(OS, nullptr);
  return 0;
}

int runLlc(const std::vector<std::string> &Args) {
  std::vector<char *> Argv;
  Argv.reserve(Args.size());
  for (const std::string &Arg : Args)
    Argv.push_back(const_cast<char *>(Arg.c_str()));

  // llc's command-line options are process globals. Reset their values around
  // every invocation so the browser can run independent llc commands without
  // leaking flags from an earlier command.
  llvm::cl::ResetAllOptionOccurrences();
  struct ResetLlcOptions {
    ~ResetLlcOptions() { llvm::cl::ResetAllOptionOccurrences(); }
  } Reset;
  return wasmbolt_llc_main(static_cast<int>(Argv.size()), Argv.data());
}

std::unordered_map<std::string, void *> LoadedModules;

std::string renderDotToSvg(llvm::StringRef Dot) {
  lt_symlist_t Plugins[] = {
      {"gvplugin_dot_layout_LTX_library",
       &gvplugin_dot_layout_LTX_library},
      {"gvplugin_core_LTX_library", &gvplugin_core_LTX_library},
      {nullptr, nullptr},
  };
  GVC_t *Context = gvContextPlugins(Plugins, 0);
  if (!Context) {
    llvm::errs() << "graphviz: could not create rendering context\n";
    return {};
  }

  std::vector<char> Buffer(Dot.begin(), Dot.end());
  Buffer.push_back('\0');
  Agraph_t *Graph = agmemread(Buffer.data());
  if (!Graph) {
    llvm::errs() << "graphviz: could not parse LLVM's DOT output\n";
    gvFreeContext(Context);
    return {};
  }

  char *Rendered = nullptr;
  std::size_t Length = 0;
  std::string Svg;
  const bool HasLayout = gvLayout(Context, Graph, "dot") == 0;
  if (HasLayout &&
      gvRenderData(Context, Graph, "svg", &Rendered, &Length) == 0) {
    Svg.assign(Rendered, Length);
    gvFreeRenderData(Rendered);
  } else {
    llvm::errs() << "graphviz: CFG layout or SVG rendering failed\n";
  }
  if (HasLayout)
    gvFreeLayout(Context, Graph);
  agclose(Graph);
  gvFreeContext(Context);
  return Svg;
}

int runDot(const std::vector<std::string> &Args) {
  std::string Input;
  std::string Output = "-";
  for (std::size_t I = 1; I < Args.size(); ++I) {
    llvm::StringRef Arg = Args[I];
    if (Arg == "-o" && I + 1 < Args.size())
      Output = Args[++I];
    else if (Arg == "-Tsvg")
      continue;
    else if (!Arg.starts_with("-"))
      Input = Arg.str();
  }
  if (Input.empty()) {
    llvm::errs() << "dot: no input DOT file\n";
    return 2;
  }

  auto Buffer = llvm::MemoryBuffer::getFile(Input);
  if (!Buffer) {
    llvm::errs() << "dot: cannot open " << Input << ": "
                 << Buffer.getError().message() << '\n';
    return 1;
  }
  const std::string Svg = renderDotToSvg((*Buffer)->getBuffer());
  if (Svg.empty())
    return 1;
  if (Output == "-") {
    llvm::outs() << Svg;
    return 0;
  }

  std::error_code EC;
  llvm::raw_fd_ostream OS(Output, EC, llvm::sys::fs::OF_Text);
  if (EC) {
    llvm::errs() << "dot: cannot open " << Output << ": " << EC.message()
                 << '\n';
    return 1;
  }
  OS << Svg;
  return 0;
}

void *loadSymbol(const char *ModulePath, const char *Symbol) {
  if (ModulePath == nullptr || Symbol == nullptr)
    return nullptr;

  void *&Handle = LoadedModules[ModulePath];
  if (Handle == nullptr) {
    llvm::outs() << "loading " << ModulePath << " with dlopen\n";
    llvm::outs().flush();
    Handle = dlopen(ModulePath, RTLD_NOW | RTLD_GLOBAL);
    if (Handle == nullptr) {
      llvm::errs() << "dlopen failed: " << dlerror() << '\n';
      return nullptr;
    }
  }

  dlerror();
  void *Address = dlsym(Handle, Symbol);
  if (const char *Error = dlerror()) {
    llvm::errs() << "dlsym failed: " << Error << '\n';
    return nullptr;
  }
  return Address;
}

} // namespace

extern "C" EMSCRIPTEN_KEEPALIVE int run_command(const char *Command) {
  if (Command == nullptr)
    return 2;

  std::vector<std::string> Args = tokenize(Command);
  if (Args.empty())
    return 2;

  llvm::outs() << "$ " << Command << '\n';
  llvm::outs().flush();

  const llvm::StringRef Program = llvm::sys::path::filename(Args.front());
  if (Program == "clang" || Program == "clang++")
    return runClang(std::move(Args));
  if (Program == "wasm-ld" || Program == "ld.lld")
    return runLld(Args);
  if (Program == "opt")
    return runOpt(Args);
  if (Program == "llc")
    return runLlc(Args);
  if (Program == "dot")
    return runDot(Args);

  llvm::errs() << "unsupported in-process tool: " << Program << '\n';
  return 127;
}

extern "C" EMSCRIPTEN_KEEPALIVE const char *wasmbolt_version() {
  static const std::string Version = std::string("LLVM ") + LLVM_VERSION_STRING;
  return Version.c_str();
}

extern "C" EMSCRIPTEN_KEEPALIVE const char *available_targets() {
  initializeTargets();
  static const std::string Targets = [] {
    std::string Result;
    for (const llvm::Target &Target : llvm::TargetRegistry::targets()) {
      if (!Result.empty())
        Result += ',';
      Result += Target.getName();
    }
    return Result;
  }();
  return Targets.c_str();
}

// Signature codes:
//   0: i32(), 1: i32(i32), 2: i32(i32, i32)
//   3: f64(), 4: f64(f64), 5: f64(f64, f64), 6: void()
extern "C" EMSCRIPTEN_KEEPALIVE double
load_and_call_numeric(const char *ModulePath, const char *Symbol,
                      std::int32_t Signature, double A, double B) {
  void *Address = loadSymbol(ModulePath, Symbol);
  if (!Address)
    return std::numeric_limits<double>::quiet_NaN();

  llvm::outs() << "executing " << Symbol << '\n';
  llvm::outs().flush();
  switch (Signature) {
  case 0:
    return reinterpret_cast<std::int32_t (*)()>(Address)();
  case 1:
    return reinterpret_cast<std::int32_t (*)(std::int32_t)>(Address)(
        static_cast<std::int32_t>(A));
  case 2:
    return reinterpret_cast<std::int32_t (*)(std::int32_t, std::int32_t)>(
        Address)(static_cast<std::int32_t>(A), static_cast<std::int32_t>(B));
  case 3:
    return reinterpret_cast<double (*)()>(Address)();
  case 4:
    return reinterpret_cast<double (*)(double)>(Address)(A);
  case 5:
    return reinterpret_cast<double (*)(double, double)>(Address)(A, B);
  case 6:
    reinterpret_cast<void (*)()>(Address)();
    return 0.0;
  default:
    llvm::errs() << "unsupported call signature code: " << Signature << '\n';
    return std::numeric_limits<double>::quiet_NaN();
  }
}

int main() {
  initializeTargets();
  llvm::outs() << "WasmBolt compiler runtime is ready (LLVM "
               << LLVM_VERSION_STRING << ").\n";
  return 0;
}
