import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * What RefuzzDriver (src/adapters/jvm.ts) reports with: JSON strings, an exception's report, and source lines for
 * classes compiled from other languages (Kotlin, Scala, Groovy), read from their SMAP debug information. `done` is set when
 * the driver is finishing, so a System.exit the project calls before then is refused.
 */
public class RefuzzRunner {
  static volatile boolean done;


  /** The printed value; toString runs on the harness thread, so a toString that throws is the project's failure too. */
  static String error(Throwable e) {
    // A class initializer's failure is the project's, and the cause's stack runs through the harness that triggered it.
    if (e instanceof ExceptionInInitializerError && e.getCause() != null) e = e.getCause();
    String type = e instanceof SecurityException && String.valueOf(e.getMessage()).startsWith("System.exit(") ? "SystemExit" : e.getClass().getName();
    StringBuilder b = new StringBuilder("{\"status\":\"error\",\"type\":").append(str(type));
    String msg;
    try { msg = e.getMessage() == null ? "" : e.getMessage(); } catch (Throwable x) { msg = "<message threw " + x.getClass().getName() + ">"; }
    b.append(",\"message\":").append(str(msg.length() > 2000 ? msg.substring(0, 2000) : msg)).append(",\"stack\":[");
    StackTraceElement[] st = e.getStackTrace();
    for (int i = 0; i < st.length && i < 400; i++) {
      if (i > 0) b.append(',');
      b.append("{\"cls\":").append(str(st[i].getClassName())).append(",\"method\":").append(str(st[i].getMethodName()))
        .append(",\"file\":").append(str(st[i].getFileName())).append(",\"line\":").append(st[i].getLineNumber());
      String smap = i < 80 && !st[i].getClassName().matches("(java|javax|jdk|sun)\\..*") ? sourceDebug(st[i].getClassName()) : null;
      if (smap != null) {
        String[] body = lookup(smap, "Kotlin", st[i].getLineNumber()), call = lookup(smap, "KotlinDebug", st[i].getLineNumber());
        if (body != null) b.append(",\"inlined\":").append(str(body[0])).append(",\"inlinedLine\":").append(body[1]);
        if (call != null) b.append(",\"callLine\":").append(call[1]);
      }
      b.append('}');
    }
    return b.append("]}").toString();
  }

  static final Map<String, String> SMAPS = new HashMap<>();

  /**
   * A class's SourceDebugExtension (JSR-45 SMAP), which Kotlin writes when it inlines a function: the lines it gives inlined code
   * are past the end of the file, and the SMAP says where they came from and where they were called.
   */
  static String sourceDebug(String cls) {
    if (SMAPS.containsKey(cls)) return SMAPS.get(cls);
    String found = null;
    try (InputStream in = ClassLoader.getSystemResourceAsStream(cls.replace('.', '/') + ".class")) {
      if (in != null) found = readSourceDebug(new DataInputStream(new BufferedInputStream(in)));
    } catch (Throwable e) {
      // No SMAP: the frame keeps the line it has.
    }
    SMAPS.put(cls, found);
    return found;
  }

  static String readSourceDebug(DataInputStream d) throws IOException {
    d.readInt();
    d.readInt();
    int n = d.readUnsignedShort();
    String[] utf = new String[n];
    for (int i = 1; i < n; i++) {
      int tag = d.readUnsignedByte();
      if (tag == 1) utf[i] = d.readUTF();
      else if (tag == 5 || tag == 6) { d.readLong(); i++; }
      else if (tag == 7 || tag == 8 || tag == 16 || tag == 19 || tag == 20) d.readUnsignedShort();
      else if (tag == 15) { d.readUnsignedByte(); d.readUnsignedShort(); }
      else if (tag == 3 || tag == 4 || (tag >= 9 && tag <= 12) || tag == 17 || tag == 18) d.readInt();
      else return null;
    }
    d.readUnsignedShort(); d.readUnsignedShort(); d.readUnsignedShort();
    for (int i = d.readUnsignedShort(); i > 0; i--) d.readUnsignedShort();
    for (int k = 0; k < 2; k++) {
      for (int i = d.readUnsignedShort(); i > 0; i--) {
        d.readUnsignedShort(); d.readUnsignedShort(); d.readUnsignedShort();
        for (int a = d.readUnsignedShort(); a > 0; a--) { d.readUnsignedShort(); d.readFully(new byte[d.readInt()]); }
      }
    }
    for (int a = d.readUnsignedShort(); a > 0; a--) {
      String name = utf[d.readUnsignedShort()];
      byte[] b = new byte[d.readInt()];
      d.readFully(b);
      if ("SourceDebugExtension".equals(name)) return new String(b, StandardCharsets.UTF_8);
    }
    return null;
  }

  /** An output line through one stratum of an SMAP: {package/File.kt, input line}, or null when the stratum has no such line. */
  static String[] lookup(String smap, String stratum, int line) {
    String[] lines = smap.split("\n");
    Map<String, String> files = new HashMap<>();
    boolean in = false, fileSection = false, lineSection = false;
    String fileId = "1";
    for (int i = 0; i < lines.length; i++) {
      String l = lines[i].trim();
      if (l.startsWith("*S ")) { in = l.substring(3).trim().equals(stratum); fileSection = lineSection = false; continue; }
      if (!in) continue;
      if (l.equals("*F")) { fileSection = true; lineSection = false; continue; }
      if (l.equals("*L")) { lineSection = true; fileSection = false; continue; }
      if (l.startsWith("*")) { fileSection = lineSection = false; continue; }
      if (fileSection) {
        boolean withPath = l.startsWith("+ ");
        String[] p = (withPath ? l.substring(2) : l).trim().split("\\s+", 2);
        String name = p.length > 1 ? p[1] : p[0], key = name;
        if (withPath && i + 1 < lines.length) {
          String path = lines[++i].trim();
          key = path.contains("/") ? path.substring(0, path.lastIndexOf('/') + 1) + name : name;
        }
        files.put(p[0], key);
      } else if (lineSection) {
        // InputStart[#FileId][,Repeat]:OutputStart[,Increment]
        String[] io = l.split(":");
        if (io.length != 2) continue;
        String input = io[0];
        if (input.contains("#")) { fileId = input.substring(input.indexOf('#') + 1).split(",")[0]; }
        int inStart = Integer.parseInt(input.split("[#,]")[0]);
        int repeat = input.contains(",") ? Integer.parseInt(input.substring(input.lastIndexOf(',') + 1)) : 1;
        String[] out = io[1].split(",");
        int outStart = Integer.parseInt(out[0]), inc = out.length > 1 ? Integer.parseInt(out[1]) : 1;
        if (line >= outStart && line < outStart + repeat * Math.max(inc, 1)) {
          String key = files.get(fileId);
          return key == null ? null : new String[] {key, String.valueOf(inStart + (line - outStart) / Math.max(inc, 1))};
        }
      }
    }
    return null;
  }

  static String str(String s) {
    if (s == null) return "null";
    StringBuilder b = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c < 0x20 || (c >= 0xd800 && c <= 0xdfff)) b.append(String.format("\\u%04x", (int) c));
      else b.append(c);
    }
    return b.append('"').toString();
  }
}
