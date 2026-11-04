// refuzz's C# fuzz driver, the way libFuzzer runs a SharpFuzz target: `dotnet RefuzzHarness.dll <class> <timeout ms>
// <map.tsv> <target source>` loads the target's static class, whose `public static void Fuzz(ReadOnlySpan<byte> data)` (or
// `Fuzz(Stream stream)`) is what SharpFuzz's Fuzzer.LibFuzzer.Run would call, and calls it in this process with the raw bytes
// of every input on stdin (u32 LE length, then the bytes). For each input it writes one JSON line: what happened, whose code
// failed, the project's frames, and the coverage edges and project lines this process had not run before. Built with
// csharp_common.cs; REFUZZ_ROOT is the project's folder, which its debug symbols name.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;

public delegate void RefuzzSpanFuzz(ReadOnlySpan<byte> data);

/// <summary>A failed Debug.Assert or Trace.Assert: thrown where it failed, instead of the runtime's FailFast.</summary>
public class DebugAssertException : Exception
{
    public DebugAssertException(string message) : base(message) { }
}

public class RefuzzAssertListener : TraceListener
{
    public override void Fail(string message, string detail) => throw new DebugAssertException(string.IsNullOrEmpty(detail) ? message ?? "" : $"{message}: {detail}");
    public override void Write(string message) { }
    public override void WriteLine(string message) { }
}

public static class RefuzzMain
{
    static readonly Regex At = new Regex(@"^\s*at (.+?)(?: in (.+):line (\d+))?\s*$");

    /// <summary>
    /// Whose failure an exception is, by the innermost frame with a file that is not this driver's: the project's (under
    /// REFUZZ_ROOT), the target's own assertion (an assert, or an exception its own line throws), or the target being wrong
    /// (a null dereference in its code, a framework call it made with a bad argument, anything else).
    /// </summary>
    static void Classify(Dictionary<string, object> r, Exception e, string target, string[] source)
    {
        while ((e is TargetInvocationException || e is TypeInitializationException || e is AggregateException { InnerExceptions.Count: 1 }) && e.InnerException != null) e = e.InnerException;
        RefuzzReport.Describe(r, e);
        foreach (var line in (e.StackTrace ?? "").Split('\n'))
        {
            var m = At.Match(line);
            if (!m.Success || !m.Groups[2].Success) continue;
            var file = m.Groups[2].Value;
            if (file.EndsWith("/Refuzz.cs", StringComparison.Ordinal) || file.EndsWith("/Common.cs", StringComparison.Ordinal)) continue;
            if (file.StartsWith(RefuzzReport.Root, StringComparison.Ordinal))
            {
                r["origin"] = "library";
                r["message"] = e.Message.Length > 600 ? e.Message.Substring(0, 600) : e.Message;
                return;
            }
            r["frames"] = new List<Dictionary<string, object>>();
            var at = int.Parse(m.Groups[3].Value);
            var text = Path.GetFileName(file) == target && at >= 1 && at <= source.Length ? source[at - 1] : null;
            if (text != null && (e is DebugAssertException || Regex.IsMatch(text, @"\bthrow\b|\b(Debug|Trace)\.Assert\b")))
            {
                r["origin"] = "assertion";
                r["type"] = "assertion";
                r["message"] = e.Message.Length > 600 ? e.Message.Substring(0, 600) : e.Message;
                return;
            }
            r["origin"] = "setup";
            r["message"] = $"{(text != null ? "target" : Path.GetFileName(file))} line {at}: {e.Message}";
            return;
        }
        r["origin"] = "setup";
    }

    public static int Main(string[] args)
    {
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;
        var reports = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
        // What the target and the project print must not land in the report stream.
        Console.SetOut(Console.Error);
        Trace.Listeners.Clear();
        Trace.Listeners.Add(new RefuzzAssertListener());
        var timeout = int.Parse(args[1]);
        var paths = new List<string>();
        var where = new List<(int path, int line)>();
        var index = new Dictionary<string, int>();
        foreach (var l in File.ReadLines(args[2]))
        {
            var f = l.Split('\t');
            if (f.Length < 3) continue;
            if (!index.TryGetValue(f[1], out var p)) { p = paths.Count; index[f[1]] = p; paths.Add(f[1]); }
            where.Add((p, int.Parse(f[2])));
        }
        var target = Path.GetFileName(args[3]);
        var source = File.ReadAllLines(args[3]);
        Action<byte[]> fuzz;
        try
        {
            var type = typeof(RefuzzMain).Assembly.GetType(args[0]) ?? throw new TypeLoadException($"no class {args[0]} in the target");
            var flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
            var span = type.GetMethod("Fuzz", flags, null, new[] { typeof(ReadOnlySpan<byte>) }, null);
            var stream = type.GetMethod("Fuzz", flags, null, new[] { typeof(Stream) }, null);
            if (span != null)
            {
                var call = span.CreateDelegate<RefuzzSpanFuzz>();
                fuzz = b => call(b);
            }
            else if (stream != null)
            {
                var call = stream.CreateDelegate<Action<Stream>>();
                fuzz = b => { using var s = new MemoryStream(b, false); call(s); };
            }
            else throw new MissingMethodException($"{args[0]} has no `public static void Fuzz(ReadOnlySpan<byte> data)` or `Fuzz(Stream stream)`");
        }
        catch (Exception e)
        {
            reports.WriteLine(JsonSerializer.Serialize(new Dictionary<string, object> { ["fatal"] = $"{e.GetType().Name}: {e.Message}" }));
            return 0;
        }
        reports.WriteLine("{\"ready\":true}");

        // The target runs on its own thread with a large stack, so the main thread can stop waiting for one that hangs.
        byte[] input = null;
        Dictionary<string, object> report = null;
        var go = new SemaphoreSlim(0);
        var done = new SemaphoreSlim(0);
        var worker = new Thread(() =>
        {
            Thread.CurrentThread.CurrentCulture = Thread.CurrentThread.CurrentUICulture = CultureInfo.InvariantCulture;
            while (true)
            {
                go.Wait();
                var r = new Dictionary<string, object> { ["status"] = "ok" };
                try
                {
                    fuzz(input);
                }
                catch (Exception e)
                {
                    Classify(r, e, target, source);
                }
                report = r;
                done.Release();
            }
        }, 256 << 20) { IsBackground = true };
        worker.Start();

        var stdin = Console.OpenStandardInput();
        var seen = new HashSet<int>();
        var head = new byte[4];
        while (ReadAll(stdin, head))
        {
            var body = new byte[BitConverter.ToUInt32(head, 0)];
            if (!ReadAll(stdin, body)) break;
            input = body;
            RefuzzHits.TakeEdges();
            RefuzzHits.Ran.Clear();
            RefuzzHits.Input++;
            go.Release();
            if (!done.Wait(timeout))
            {
                // A thread cannot be stopped: no answer, so the session reports the timeout and ends this process, which ends
                // itself too in case the session's kill does not reach it inside the container.
                Thread.Sleep(timeout + 6000);
                Environment.Exit(0);
            }
            var r = report;
            var features = new List<string>();
            foreach (var e in RefuzzHits.TakeEdges()) if (seen.Add(e)) features.Add(e.ToString(CultureInfo.InvariantCulture));
            r["features"] = features;
            var lines = new List<object[]>();
            foreach (var id in RefuzzHits.Ran) if (id < where.Count) lines.Add(new object[] { paths[where[id].path], where[id].line });
            RefuzzHits.Fresh.Clear();
            r["lines"] = lines;
            reports.WriteLine(JsonSerializer.Serialize(r));
        }
        return 0;
    }

    static bool ReadAll(Stream s, byte[] buf)
    {
        for (int at = 0; at < buf.Length;)
        {
            var n = s.Read(buf, at, buf.Length - at);
            if (n <= 0) return false;
            at += n;
        }
        return true;
    }
}
