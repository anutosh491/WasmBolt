#include "mlir/InitAllDialects.h"
#include "mlir/InitAllExtensions.h"
#include "mlir/InitAllPasses.h"
#include "mlir/Support/FileUtilities.h"
#include "mlir/Target/LLVMIR/Dialect/All.h"
#include "mlir/Tools/mlir-opt/MlirOptMain.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/ToolOutputFile.h"

#include <cstdlib>
#include <string>
#include <utility>

namespace {

struct DriverState {
  mlir::DialectRegistry registry;
  std::string helpHeader;

  DriverState() {
    mlir::registerAllPasses();
    mlir::registerAllDialects(registry);
    mlir::registerAllExtensions(registry);
    mlir::registerAllGPUToLLVMIRTranslations(registry);
    helpHeader = mlir::registerCLIOptions(
        "WasmBolt MLIR modular optimizer driver", registry);
  }
};

DriverState &getDriverState() {
  static DriverState state;
  return state;
}

struct ResetCommandLineOptions {
  ~ResetCommandLineOptions() { llvm::cl::ResetAllOptionOccurrences(); }
};

} // namespace

extern "C" int wasmbolt_mlir_opt_main(int argc, char **argv) {
  DriverState &state = getDriverState();
  llvm::cl::ResetAllOptionOccurrences();
  ResetCommandLineOptions resetOptions;

  auto [inputFilename, outputFilename] =
      mlir::parseCLIOptions(argc, argv, state.helpHeader);
  mlir::MlirOptMainConfig config =
      mlir::MlirOptMainConfig::createFromCLOptions();

  std::string errorMessage;
  auto input = mlir::openInputFile(inputFilename, &errorMessage);
  if (!input) {
    llvm::errs() << errorMessage << '\n';
    return EXIT_FAILURE;
  }
  auto output = mlir::openOutputFile(outputFilename, &errorMessage);
  if (!output) {
    llvm::errs() << errorMessage << '\n';
    return EXIT_FAILURE;
  }

  if (mlir::failed(
          mlir::MlirOptMain(output->os(), std::move(input), state.registry,
                            config)))
    return EXIT_FAILURE;
  output->keep();
  return EXIT_SUCCESS;
}
