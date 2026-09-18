#include "lld/Common/Driver.h"
#include "clang/Basic/TargetOptions.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/CompilerInvocation.h"
#include "clang/FrontendTool/Utils.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/ADT/ArrayRef.h"
#include "llvm/ADT/IntrusiveRefCntPtr.h"
#include "llvm/Config/llvm-config.h"
#include "llvm/MC/TargetRegistry.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/TargetSelect.h"
#include "llvm/Support/raw_ostream.h"

#include <dlfcn.h>
#include <emscripten.h>
#include <graphviz/cgraph.h>
#include <graphviz/gvc.h>
#include <graphviz/gvcext.h>

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

LLD_HAS_DRIVER(wasm)

extern "C" {
extern gvplugin_library_t gvplugin_dot_layout_LTX_library;
extern gvplugin_library_t gvplugin_core_LTX_library;
}

namespace {

// Tool and program output must be complete before JavaScript changes capture.
struct FlushStreams {
  ~FlushStreams() {
    llvm::outs().flush();
    llvm::errs().flush();
    std::fflush(nullptr);
  }
};

std::string CallError;
bool CanRunAgain = true;

class ExecuteCompilerToolAction final : public clang::tooling::ToolAction {
public:
  bool
  runInvocation(std::shared_ptr<clang::CompilerInvocation> Invocation,
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

std::vector<std::string> unpackArguments(const char *Packed, std::size_t Size) {
  std::vector<std::string> Result;
  if (!Packed || !Size || Packed[Size - 1] != '\0')
    return Result;

  const char *Start = Packed;
  for (std::size_t I = 0; I < Size; ++I) {
    if (Packed[I] != '\0')
      continue;
    Result.emplace_back(Start, Packed + I);
    Start = Packed + I + 1;
  }
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
  CanRunAgain = Result.canRunAgain;
  return Result.retCode;
}

std::unordered_map<std::string, void *> LoadedModules;

std::string renderDotToSvg(llvm::StringRef Dot) {
  lt_symlist_t Plugins[] = {
      {"gvplugin_dot_layout_LTX_library", &gvplugin_dot_layout_LTX_library},
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
    Handle = dlopen(ModulePath, RTLD_NOW | RTLD_GLOBAL);
    if (Handle == nullptr) {
      CallError = std::string("dlopen failed: ") + dlerror();
      llvm::errs() << CallError << '\n';
      return nullptr;
    }
  }

  dlerror();
  void *Address = dlsym(Handle, Symbol);
  if (const char *Error = dlerror()) {
    CallError = std::string("dlsym failed: ") + Error;
    llvm::errs() << CallError << '\n';
    return nullptr;
  }
  return Address;
}

} // namespace

extern "C" EMSCRIPTEN_KEEPALIVE int run_tool(const char *Packed,
                                             std::size_t Size) {
  FlushStreams Flush;
  std::vector<std::string> Args = unpackArguments(Packed, Size);
  if (Args.empty())
    return 2;

  const llvm::StringRef Program = llvm::sys::path::filename(Args.front());
  if (Program == "clang" || Program == "clang++")
    return runClang(std::move(Args));
  if (Program == "wasm-ld" || Program == "ld.lld")
    return runLld(Args);
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

extern "C" EMSCRIPTEN_KEEPALIVE int wasmbolt_can_run_again() {
  return CanRunAgain ? 1 : 0;
}

extern "C" EMSCRIPTEN_KEEPALIVE std::uintptr_t
resolve_symbol(const char *ModulePath, const char *Symbol) {
  FlushStreams Flush;
  CallError.clear();
  void *Address = loadSymbol(ModulePath, Symbol);
  return reinterpret_cast<std::uintptr_t>(Address);
}

// A successful floating-point call may itself return NaN.
extern "C" EMSCRIPTEN_KEEPALIVE const char *wasmbolt_call_error() {
  return CallError.c_str();
}

int main() {
  FlushStreams Flush;
  initializeTargets();
  llvm::outs() << "WasmBolt compiler runtime is ready (LLVM "
               << LLVM_VERSION_STRING << ").\n";
  return 0;
}
