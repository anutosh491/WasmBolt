#include "../compilers/clang/Clang.h"
#include "../linkers/wasm-ld/Linker.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/Config/llvm-config.h"
#include "llvm/MC/TargetRegistry.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/StringSaver.h"
#include "llvm/Support/TargetSelect.h"
#include "llvm/Support/raw_ostream.h"
#include <dlfcn.h>
#include <emscripten.h>
#include <cstdint>
#include <limits>
#include <string>
#include <unordered_map>
#include <vector>

namespace {
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

// Flags that can load arbitrary native code (compiler plugins) or otherwise
// escape the intended clang/lld invocation. These must never be accepted
// from an untrusted command string passed in from JavaScript.
bool hasDisallowedArg(const std::vector<std::string> &Args) {
  for (const std::string &Arg : Args) {
    const llvm::StringRef A(Arg);
    if (A == "-load" || A == "-plugin" || A == "-fplugin" || A == "-Xclang" ||
        A.starts_with("-fplugin=") || A.starts_with("-plugin="))
      return true;
  }
  return false;
}

std::unordered_map<std::string, void *> LoadedModules;

void *loadSymbol(const char *ModulePath, const char *Symbol) {
  if (ModulePath == nullptr || Symbol == nullptr)
    return nullptr;

  void *&Handle = LoadedModules[ModulePath];
  if (Handle == nullptr) {
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

  if (hasDisallowedArg(Args)) {
    llvm::errs() << "disallowed argument: plugin/code loading flags are not "
                     "permitted\n";
    return 126;
  }

  const llvm::StringRef Program = llvm::sys::path::filename(Args.front());
  if (Program == "clang" || Program == "clang++")
    return runClang(std::move(Args));
  if (Program == "wasm-ld" || Program == "ld.lld")
    return runLld(Args);
  llvm::errs() << "unsupported in-process tool: " << Program << '\n';
  return 127;
}

extern "C" EMSCRIPTEN_KEEPALIVE int wasmbolt_pointer_bits() {
  return sizeof(void *) * 8;
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
//   3: f64(), 4: f64(f64), 5: f64(f64, f64), 6: void(), 7: main
extern "C" EMSCRIPTEN_KEEPALIVE double
load_and_call_numeric(const char *ModulePath, const char *Symbol,
                      std::int32_t Signature, double A, double B) {
  void *Address = loadSymbol(ModulePath, Symbol);
  if (!Address)
    return std::numeric_limits<double>::quiet_NaN();

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
  case 7:
    return reinterpret_cast<int (*)(int, char **)>(Address)(0, nullptr);
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
