target triple = "wasm32-unknown-emscripten"

declare void @llvm.dbg.value(metadata, metadata, metadata)

define i32 @ir_add(i32 %left, i32 %right) !dbg !5 {
entry:
  call void @llvm.dbg.value(metadata i32 %left, metadata !9, metadata !DIExpression()), !dbg !12
  call void @llvm.dbg.value(metadata i32 %right, metadata !10, metadata !DIExpression()), !dbg !12
  %sum = add nsw i32 %left, %right, !dbg !12
  call void @llvm.dbg.value(metadata i32 %sum, metadata !19, metadata !DIExpression()), !dbg !13
  ret i32 %sum, !dbg !13
}

define i32 @main() !dbg !14 {
entry:
  %result = call i32 @ir_add(i32 19, i32 23), !dbg !17
  call void @llvm.dbg.value(metadata i32 %result, metadata !20, metadata !DIExpression()), !dbg !18
  ret i32 %result, !dbg !18
}

@__main_void = hidden alias i32 (), ptr @main

!llvm.dbg.cu = !{!0}
!llvm.module.flags = !{!2, !3}
!llvm.ident = !{!4}

!0 = distinct !DICompileUnit(language: DW_LANG_C_plus_plus_14, file: !1, producer: "WasmBolt LLVM IR demo", isOptimized: false, runtimeVersion: 0, emissionKind: FullDebug)
!1 = !DIFile(filename: "debug.ll", directory: "/workspace")
!2 = !{i32 7, !"Dwarf Version", i32 5}
!3 = !{i32 2, !"Debug Info Version", i32 3}
!4 = !{!"WasmBolt LLVM IR demo"}
!5 = distinct !DISubprogram(name: "ir_add", linkageName: "ir_add", scope: !1, file: !1, line: 5, type: !6, scopeLine: 5, spFlags: DISPFlagDefinition, unit: !0, retainedNodes: !11)
!6 = !DISubroutineType(types: !7)
!7 = !{!8, !8, !8}
!8 = !DIBasicType(name: "int", size: 32, encoding: DW_ATE_signed)
!9 = !DILocalVariable(name: "left", arg: 1, scope: !5, file: !1, line: 5, type: !8)
!10 = !DILocalVariable(name: "right", arg: 2, scope: !5, file: !1, line: 5, type: !8)
!11 = !{!9, !10, !19}
!12 = !DILocation(line: 9, column: 10, scope: !5)
!13 = !DILocation(line: 11, column: 3, scope: !5)
!14 = distinct !DISubprogram(name: "main", linkageName: "main", scope: !1, file: !1, line: 14, type: !15, scopeLine: 14, spFlags: DISPFlagDefinition, unit: !0)
!15 = !DISubroutineType(types: !16)
!16 = !{!8}
!17 = !DILocation(line: 16, column: 13, scope: !14)
!18 = !DILocation(line: 18, column: 3, scope: !14)
!19 = !DILocalVariable(name: "sum", scope: !5, file: !1, line: 9, type: !8)
!20 = !DILocalVariable(name: "result", scope: !14, file: !1, line: 16, type: !8)
