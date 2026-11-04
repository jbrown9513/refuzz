// What refuzz's C# driver is built with: the coverage the instrumented project assemblies record (they call RefuzzHits.Hit
// by assembly and type name, so the driver builds as an assembly named RefuzzHarness), and how a failure and a value are
// reported.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

/// <summary>Called at every sequence point of the project's code by the instrumented assemblies (src/images/csharp/Instrument.cs).</summary>
public static class RefuzzHits
{
    /// <summary>Every line id this process has run.</summary>
    public static readonly bool[] Seen = new bool[1 << 22];
    /// <summary>Line ids run for the first time since the last Drain: the new lines an input reached.</summary>
    public static readonly List<int> Fresh = new List<int>();
    /// <summary>Every line id the current input ran, once each (Stamp holds the input that last ran each id).</summary>
    public static readonly List<int> Ran = new List<int>();
    static readonly int[] Stamp = new int[1 << 22];
    public static int Input = 1;
    /// <summary>Edges between consecutive lines, hashed into a map the way AFL keeps them, and the slots set since the last reset.</summary>
    public static readonly byte[] Edges = new byte[1 << 16];
    public static readonly List<int> Touched = new List<int>();
    static int prev;

    public static void Hit(int id)
    {
        if ((uint)id >= (uint)Seen.Length) return;
        if (!Seen[id]) { Seen[id] = true; Fresh.Add(id); }
        if (Stamp[id] != Input) { Stamp[id] = Input; Ran.Add(id); }
        var e = ((prev << 1) ^ id) & (Edges.Length - 1);
        prev = id;
        if (Edges[e] == 0) { Edges[e] = 1; Touched.Add(e); }
    }

    /// <summary>The edges run since the last reset, cleared for the next input.</summary>
    public static List<int> TakeEdges()
    {
        var out_ = new List<int>(Touched);
        foreach (var e in Touched) Edges[e] = 0;
        Touched.Clear();
        prev = 0;
        return out_;
    }
}

public static class RefuzzReport
{
    /// <summary>
    /// The project's folder, from REFUZZ_ROOT: frames under it are the project's, everything else is the target or a dependency.
    /// </summary>
    public static readonly string Root = (Environment.GetEnvironmentVariable("REFUZZ_ROOT") ?? "").TrimEnd('/') + "/";

    static readonly Regex At = new Regex(@"^\s*at (.+?)(?: in (.+):line (\d+))?\s*$");

    /// <summary>
    /// The exception's type, message and the project's frames, innermost last. The stack text, not StackTrace(e), because only
    /// the text keeps the frames from before an await or a rethrow. The innermost frame with a file says whose code failed.
    /// </summary>
    public static void Describe(Dictionary<string, object> report, Exception e)
    {
        while ((e is TargetInvocationException || e is TypeInitializationException || e is AggregateException { InnerExceptions.Count: 1 }) && e.InnerException != null) e = e.InnerException;
        report["status"] = "error";
        report["type"] = e.GetType().FullName;
        report["message"] = e.Message.Length > 600 ? e.Message.Substring(0, 600) : e.Message;
        string origin = null;
        var frames = new List<Dictionary<string, object>>();
        foreach (var line in (e.StackTrace ?? "").Split('\n'))
        {
            var m = At.Match(line);
            if (!m.Success || !m.Groups[2].Success) continue;
            var file = m.Groups[2].Value;
            var mine = file.StartsWith(Root, StringComparison.Ordinal);
            if (origin == null && !mine) report["message"] = $"harness line {m.Groups[3].Value}: {report["message"]}";
            origin ??= mine ? "library" : "setup";
            if (mine) frames.Add(new Dictionary<string, object> { ["path"] = file.Substring(Root.Length), ["line"] = int.Parse(m.Groups[3].Value), ["name"] = Regex.Replace(m.Groups[1].Value, @"\(.*$", "") });
        }
        frames.Reverse();
        report["origin"] = origin ?? "setup";
        report["frames"] = frames.Count > 16 ? frames.GetRange(frames.Count - 16, 16) : frames;
    }

    /// <summary>A value as text that is the same every run: collections item by item, objects without their own ToString by their properties.</summary>
    public static string Format(object o, int depth)
    {
        switch (o)
        {
            case null: return "null";
            case string s: return JsonSerializer.Serialize(s);
            case char c: return JsonSerializer.Serialize(c.ToString());
            case bool b: return b ? "true" : "false";
            case Type t: return t.FullName ?? t.Name;
        }
        if (depth > 3) return o.GetType().Name;
        if (o is IDictionary d)
        {
            var items = new List<string>();
            foreach (DictionaryEntry kv in d) { if (items.Count >= 50) { items.Add("…"); break; } items.Add($"{Format(kv.Key, depth + 1)}: {Format(kv.Value, depth + 1)}"); }
            return "{" + string.Join(", ", items) + "}";
        }
        if (o is IEnumerable e && !(o is IFormattable))
        {
            var items = new List<string>();
            foreach (var x in e) { if (items.Count >= 50) { items.Add("…"); break; } items.Add(Format(x, depth + 1)); }
            return "[" + string.Join(", ", items) + "]";
        }
        if (o is IFormattable f) return f.ToString(null, CultureInfo.InvariantCulture);
        var type = o.GetType();
        var text = o.ToString();
        if (text != type.ToString()) return text ?? "null";
        var props = type.GetProperties(BindingFlags.Public | BindingFlags.Instance).Where(p => p.GetIndexParameters().Length == 0).Take(16)
            .Select(p => { try { return $"{p.Name}={Format(p.GetValue(o), depth + 1)}"; } catch (Exception x) { return $"{p.Name}=<{(x.InnerException ?? x).GetType().Name}>"; } });
        return $"{type.Name}{{{string.Join(", ", props)}}}";
    }
}
