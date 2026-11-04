// refuzz's C# line coverage: `dotnet Instrument.dll <bin dir> <source root> <out dir>` rewrites every assembly in the bin
// dir whose debug symbols point into the source root so each sequence point calls RefuzzHits.Hit(id) in the harness assembly,
// and writes the rewritten assemblies, their PDBs and `map.tsv` (id, path, line) to the out dir. Instrumenting once, ahead of
// time, keeps each harness process as cheap as an uninstrumented one and lets any number run at once.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Mono.Cecil;
using Mono.Cecil.Cil;
using Mono.Cecil.Rocks;

public static class Instrument
{
    public static int Main(string[] args)
    {
        string bin = args[0], root = args[1], outDir = args[2];
        Directory.CreateDirectory(outDir);
        var resolver = new DefaultAssemblyResolver();
        resolver.AddSearchDirectory(bin);
        resolver.AddSearchDirectory(Path.GetDirectoryName(typeof(object).Assembly.Location)!);
        var map = new List<string>();
        int next = 0;
        foreach (var dll in Directory.GetFiles(bin, "*.dll").OrderBy(f => f, StringComparer.Ordinal))
        {
            if (Path.GetFileName(dll) == "RefuzzHarness.dll") continue;
            ModuleDefinition module;
            try { module = ModuleDefinition.ReadModule(dll, new ReaderParameters { ReadSymbols = true, AssemblyResolver = resolver, ReadingMode = ReadingMode.Immediate }); }
            catch { continue; }
            using (module)
            {
                var methods = module.GetTypes().SelectMany(t => t.Methods).Where(m => m.HasBody && m.DebugInformation.HasSequencePoints && m.DebugInformation.SequencePoints.Any(s => !s.IsHidden && s.Document.Url.StartsWith(root, StringComparison.Ordinal))).ToList();
                if (methods.Count == 0) continue;
                var harness = new AssemblyNameReference("RefuzzHarness", new Version(0, 0, 0, 0));
                module.AssemblyReferences.Add(harness);
                var hits = new TypeReference("", "RefuzzHits", module, harness);
                var hit = new MethodReference("Hit", module.TypeSystem.Void, hits) { HasThis = false };
                hit.Parameters.Add(new ParameterDefinition(module.TypeSystem.Int32));
                foreach (var method in methods)
                {
                    var body = method.Body;
                    body.SimplifyMacros();
                    var il = body.GetILProcessor();
                    var points = method.DebugInformation.SequencePoints.Where(s => !s.IsHidden && s.Document.Url.StartsWith(root, StringComparison.Ordinal)).GroupBy(s => s.Offset).ToDictionary(g => g.Key, g => g.First());
                    foreach (var ins in body.Instructions.ToList())
                    {
                        if (!points.TryGetValue(ins.Offset, out var sp)) continue;
                        // The instruction itself becomes the counter's first instruction and its copy follows, so branches, handlers and
                        // the sequence point that pointed at it still point at the start of the line.
                        var copy = Instruction.Create(OpCodes.Nop);
                        copy.OpCode = ins.OpCode;
                        copy.Operand = ins.Operand;
                        ins.OpCode = OpCodes.Ldc_I4;
                        ins.Operand = next;
                        var call = Instruction.Create(OpCodes.Call, hit);
                        il.InsertAfter(ins, call);
                        il.InsertAfter(call, copy);
                        map.Add($"{next}\t{sp.Document.Url.Substring(root.Length)}\t{sp.StartLine}");
                        next++;
                    }
                    body.OptimizeMacros();
                }
                module.Write(Path.Combine(outDir, Path.GetFileName(dll)), new WriterParameters { WriteSymbols = true });
                Console.WriteLine($"instrumented {Path.GetFileName(dll)}: {methods.Count} methods");
            }
        }
        File.WriteAllLines(Path.Combine(outDir, "map.tsv"), map);
        return 0;
    }
}
