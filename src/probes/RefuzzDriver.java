import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.EOFException;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Runs one Jazzer fuzz target in-process for many inputs, for refuzz (src/adapters/jvm.ts, protocol in
 * src/session.ts). Usage: java -javaagent:jacocoagent.jar=… -cp target:probe:project:jazzer RefuzzDriver <class>
 * <timeout ms> <lines dir> <jacoco jars dir> <roots> <packages>
 *
 * The class is the target exactly as Jazzer runs it: a static fuzzerTestOneInput taking the input's raw bytes, either as
 * byte[] or as a FuzzedDataProvider, which here is Jazzer's own (FuzzedDataProviderImpl over the bytes, as Jazzer's
 * reproducers build it), so a target splits its input the same way in-process and under Jazzer; and an optional static
 * fuzzerInitialize, with or without String[] arguments, called once before the first input. Each input is a u32 LE length
 * and the bytes on stdin. Coverage comes from the JaCoCo agent's runtime, dumped and reset after every input: a hit probe of
 * a class is a feature, and RefuzzLines turns the dump into the source lines the input ran, kept by the set of probes hit, so
 * a path already analyzed is not analyzed again. A call that does not return in time is left running on its own daemon
 * thread and reported as a timeout.
 */
public class RefuzzDriver {
  static final Set<Long> SEEN = new HashSet<>();
  /** Source lines per set of probes hit (its hash): the analysis is the slow part, and most inputs repeat a path. */
  static final Map<Long, String[]> PATHS = new HashMap<>();
  static final String PROVIDER = "com.code_intelligence.jazzer.api.FuzzedDataProvider";

  public static void main(String[] args) throws Exception {
    PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
    // What the target and the project print must not land in the report stream.
    System.setOut(System.err);
    long timeout = Long.parseLong(args[1]);
    Method fuzz = null;
    Method provider = null;
    Object agent = null;
    Method dump = null;
    Object mapper = null;
    Method mapLines = null;
    try {
      Class<?> target = Class.forName(args[0]);
      for (Method m : target.getMethods()) {
        if (!m.getName().equals("fuzzerTestOneInput") || !Modifier.isStatic(m.getModifiers()) || m.getParameterCount() != 1) continue;
        Class<?> p = m.getParameterTypes()[0];
        if (p == byte[].class) fuzz = m;
        else if (p.getName().equals(PROVIDER)) {
          fuzz = m;
          provider = Class.forName("com.code_intelligence.jazzer.driver.FuzzedDataProviderImpl").getMethod("withJavaData", byte[].class);
        }
      }
      if (fuzz == null) throw new NoSuchMethodException(args[0] + " has no public static fuzzerTestOneInput(byte[]) or fuzzerTestOneInput(FuzzedDataProvider)");
      Method init = null;
      for (Method m : target.getMethods()) {
        if (!m.getName().equals("fuzzerInitialize") || !Modifier.isStatic(m.getModifiers())) continue;
        if (m.getParameterCount() == 0 || (m.getParameterCount() == 1 && m.getParameterTypes()[0] == String[].class && init == null)) init = m;
      }
      if (init != null) init.invoke(null, init.getParameterCount() == 0 ? new Object[0] : new Object[] {new String[0]});
      try {
        agent = Class.forName("org.jacoco.agent.rt.RT").getMethod("getAgent").invoke(null);
        dump = Class.forName("org.jacoco.agent.rt.IAgent").getMethod("getExecutionData", boolean.class);
        dump.invoke(agent, true);
      } catch (Throwable e) {
        agent = null;
      }
      if (agent != null && args.length > 5) {
        List<URL> urls = new ArrayList<>();
        urls.add(new File(args[2]).toURI().toURL());
        File[] jars = new File(args[3]).listFiles((d, n) -> n.endsWith(".jar") && !n.contains("agent"));
        if (jars != null) for (File j : jars) urls.add(j.toURI().toURL());
        ClassLoader isolated = new URLClassLoader(urls.toArray(new URL[0]), ClassLoader.getSystemClassLoader().getParent());
        Class<?> c = isolated.loadClass("RefuzzLines");
        String[] roots = args[4].isEmpty() ? new String[0] : args[4].split(":");
        String[] packages = args[5].split(":", -1);
        mapper = c.getConstructor(String[].class, String[].class).newInstance(roots, packages);
        mapLines = c.getMethod("lines", byte[].class);
      }
    } catch (Throwable e) {
      Throwable cause = e instanceof InvocationTargetException && e.getCause() != null ? e.getCause() : e;
      StringBuilder trace = new StringBuilder();
      for (StackTraceElement f : cause.getStackTrace()) trace.append("\n  at ").append(f);
      out.println("{\"fatal\":" + RefuzzRunner.str(cause.getClass().getName() + ": " + cause.getMessage()) + ",\"trace\":" + RefuzzRunner.str(trace.length() > 2000 ? trace.substring(0, 2000) : trace.toString()) + "}");
      return;
    }
    try {
      System.setSecurityManager(new SecurityManager() {
        @Override public void checkExit(int status) { if (!RefuzzRunner.done) throw new SecurityException("System.exit(" + status + ")"); }
        @Override public void checkPermission(java.security.Permission p) {}
        @Override public void checkPermission(java.security.Permission p, Object context) {}
      });
    } catch (Throwable e) {
      // No security manager on this JDK: an exit ends the process, which the session reports as a crash.
    }
    // What fuzzerInitialize ran is not any input's.
    if (agent != null) dump.invoke(agent, true);
    out.println("{\"ready\":true}");

    DataInputStream in = new DataInputStream(System.in);
    int stuck = 0;
    while (true) {
      byte[] input;
      try {
        int n = Integer.reverseBytes(in.readInt());
        input = new byte[n];
        in.readFully(input);
      } catch (EOFException e) {
        break;
      }
      Throwable[] failure = new Throwable[1];
      final Method m = fuzz, wrap = provider;
      Thread t = new Thread(null, () -> {
        Object arg = null;
        try {
          arg = wrap == null ? input : wrap.invoke(null, (Object) input);
          m.invoke(null, arg);
        } catch (InvocationTargetException e) {
          failure[0] = e.getCause();
        } catch (Throwable e) {
          failure[0] = e;
        } finally {
          if (arg instanceof AutoCloseable && arg != input) {
            try { ((AutoCloseable) arg).close(); } catch (Exception e) { /* the provider's copy of the bytes, freed */ }
          }
        }
      }, "refuzz", 32L << 20);
      t.setDaemon(true);
      t.start();
      t.join(timeout);
      String json;
      if (t.isAlive()) {
        stuck++;
        json = "{\"status\":\"timeout\",\"origin\":\"library\",\"type\":\"Timeout\"";
      } else if (failure[0] != null) {
        String e = RefuzzRunner.error(failure[0]);
        json = e.substring(0, e.length() - 1);
      } else {
        json = "{\"status\":\"ok\"";
      }
      StringBuilder b = new StringBuilder(json).append(",\"features\":[");
      List<String> fresh = new ArrayList<>();
      if (agent != null) {
        byte[] exec = (byte[]) dump.invoke(agent, true);
        long[] path = {17};
        features(exec, b, path);
        if (mapper != null) {
          String[] ran = PATHS.get(path[0]);
          if (ran == null) {
            try {
              ran = (String[]) mapLines.invoke(mapper, (Object) exec);
            } catch (Throwable e) {
              // Lines are a report, not the fuzzing: a dump JaCoCo cannot analyze leaves them out.
              ran = new String[0];
            }
            if (PATHS.size() < 20000) PATHS.put(path[0], ran);
          }
          Collections.addAll(fresh, ran);
        }
      }
      b.append("],\"lines\":[");
      for (int k = 0; k < fresh.size(); k++) {
        String l = fresh.get(k);
        int at = l.lastIndexOf(':');
        b.append(k > 0 ? "," : "").append('[').append(RefuzzRunner.str(l.substring(0, at))).append(',').append(l.substring(at + 1)).append(']');
      }
      out.println(b.append("]}"));
      // Calls that never returned keep their threads busy: past a few, a fresh process is cheaper than sharing the CPU.
      if (stuck >= 4) { RefuzzRunner.done = true; Runtime.getRuntime().halt(0); }
    }
    RefuzzRunner.done = true;
    Runtime.getRuntime().halt(0);
  }

  /**
   * Appends the probes an exec dump hit that this process has not seen, as quoted ids, and says whether there were any. The
   * dump is JaCoCo's exec format: blocks of a header (0x01), session info (0x10) and per class (0x11) its id, name and
   * probes as a varint count and packed bits.
   */
  static boolean features(byte[] exec, StringBuilder b, long[] path) throws IOException {
    DataInputStream d = new DataInputStream(new ByteArrayInputStream(exec));
    boolean any = false;
    for (int block = d.read(); block != -1; block = d.read()) {
      if (block == 0x01) { d.readChar(); d.readChar(); }
      else if (block == 0x10) { d.readUTF(); d.readLong(); d.readLong(); }
      else if (block == 0x11) {
        long id = d.readLong();
        d.readUTF();
        int n = varint(d);
        for (int k = 0; k < n; k += 8) {
          int bits = d.readUnsignedByte();
          for (int j = 0; j < 8 && bits != 0; j++, bits >>>= 1) {
            if ((bits & 1) == 0) continue;
            long f = (id ^ ((k + j) * 0x9E3779B97F4A7C15L)) & 0xFFFFFFFFFFFFFL;
            path[0] = path[0] * 1000003L + f;
            if (SEEN.add(f)) { b.append(any ? ",\"" : "\"").append(f).append('"'); any = true; }
          }
        }
      } else break;
    }
    return any;
  }

  static int varint(InputStream in) throws IOException {
    int v = 0;
    for (int shift = 0; shift < 35; shift += 7) {
      int c = in.read();
      if (c < 0) throw new EOFException();
      v |= (c & 0x7f) << shift;
      if ((c & 0x80) == 0) break;
    }
    return v;
  }
}
