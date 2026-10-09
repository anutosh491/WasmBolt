#include "Clang.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/CompilerInvocation.h"
#include "clang/FrontendTool/Utils.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/ADT/IntrusiveRefCntPtr.h"
#include <memory>

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

} // namespace

int runClang(std::vector<std::string> Args) {
  clang::FileSystemOptions FileSystemOpts;
  auto Files = llvm::makeIntrusiveRefCnt<clang::FileManager>(FileSystemOpts);
  ExecuteCompilerToolAction Action;
  clang::tooling::ToolInvocation Invocation(
      std::move(Args), &Action, Files.get(),
      std::make_shared<clang::PCHContainerOperations>());
  return Invocation.run() ? 0 : 1;
}

