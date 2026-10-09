#include "Linker.h"
#include "lld/Common/Driver.h"
#include "llvm/Support/raw_ostream.h"

LLD_HAS_DRIVER(wasm)

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

