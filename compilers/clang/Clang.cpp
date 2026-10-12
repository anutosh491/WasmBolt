#include "Clang.h"
#include "clang/AST/ASTConsumer.h"
#include "clang/AST/ASTContext.h"
#include "clang/Basic/SourceManager.h"
#include "clang/Frontend/FrontendActions.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/CompilerInvocation.h"
#include "clang/FrontendTool/Utils.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/ADT/IntrusiveRefCntPtr.h"
#include "llvm/Support/raw_ostream.h"
#include <memory>

namespace {
class SourceASTConsumer final : public clang::ASTConsumer {
public:
  void HandleTranslationUnit(clang::ASTContext &Context) override {
    auto &Sources = Context.getSourceManager();
    for (const auto *Declaration : Context.getTranslationUnitDecl()->decls())
      if (Sources.isWrittenInMainFile(
              Sources.getExpansionLoc(Declaration->getLocation())))
        Declaration->dump(llvm::outs());
  }
};

class SourceASTAction final : public clang::ASTFrontendAction {
  std::unique_ptr<clang::ASTConsumer>
  CreateASTConsumer(clang::CompilerInstance &, llvm::StringRef) override {
    return std::make_unique<SourceASTConsumer>();
  }
};

class ExecuteCompilerToolAction final : public clang::tooling::ToolAction {
  bool SourceAST;

public:
  explicit ExecuteCompilerToolAction(bool SourceAST) : SourceAST(SourceAST) {}
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

    SourceASTAction SourceAction;
    const bool Success = SourceAST ? Compiler.ExecuteAction(SourceAction)
                                   : clang::ExecuteCompilerInvocation(&Compiler);
    Compiler.clearOutputFiles(/*EraseFiles=*/!Success);
    return Success;
  }
};

} // namespace

int runClang(std::vector<std::string> Args, bool SourceAST) {
  clang::FileSystemOptions FileSystemOpts;
  auto Files = llvm::makeIntrusiveRefCnt<clang::FileManager>(FileSystemOpts);
  ExecuteCompilerToolAction Action(SourceAST);
  clang::tooling::ToolInvocation Invocation(
      std::move(Args), &Action, Files.get(),
      std::make_shared<clang::PCHContainerOperations>());
  return Invocation.run() ? 0 : 1;
}
