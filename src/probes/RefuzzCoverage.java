import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.stream.Stream;
import org.jacoco.core.analysis.Analyzer;
import org.jacoco.core.analysis.CoverageBuilder;
import org.jacoco.core.analysis.ICounter;
import org.jacoco.core.analysis.ISourceFileCoverage;
import org.jacoco.core.tools.ExecFileLoader;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.Opcodes;

/**
 * Line coverage of the target files for a batch of JaCoCo exec files, for refuzz (src/adapters/jvm.ts). Usage:
 * java -cp jacoco-core:asm:. RefuzzCoverage <keys> <execs> <out> <class dir or jar>...
 * `keys` lists the target source files as package/File.ext, one per line; `execs` lists exec files. For each exec, `out` gets
 * a line `exec<TAB>key:line,line;key:line…` with the lines that ran. Only classes compiled from a target file are analyzed,
 * found once by their SourceFile attribute, so a large project costs no more than a small one per harness.
 */
public class RefuzzCoverage {
  public static void main(String[] args) throws Exception {
    Set<String> keys = new HashSet<>(Files.readAllLines(Paths.get(args[0])));
    Set<String> packages = new HashSet<>();
    for (String k : keys) packages.add(k.contains("/") ? k.substring(0, k.lastIndexOf('/')) : "");
    List<byte[]> classes = new ArrayList<>();
    for (int i = 3; i < args.length; i++) {
      if (args[i].endsWith(".jar") && new File(args[i]).isFile()) {
        try (JarFile jar = new JarFile(args[i])) {
          for (JarEntry e : Collections.list(jar.entries())) {
            String n = e.getName();
            if (!n.endsWith(".class") || !packages.contains(n.contains("/") ? n.substring(0, n.lastIndexOf('/')) : "")) continue;
            byte[] b;
            try (InputStream in = jar.getInputStream(e)) { b = readAll(in); }
            String src = sourceFile(b), pkg = n.contains("/") ? n.substring(0, n.lastIndexOf('/')) : "";
            if (src != null && keys.contains(pkg.isEmpty() ? src : pkg + "/" + src)) classes.add(b);
          }
        }
        continue;
      }
      for (String pkg : packages) {
        Path dir = Paths.get(args[i], pkg);
        if (!Files.isDirectory(dir)) continue;
        try (Stream<Path> s = Files.list(dir)) {
          for (Path p : (Iterable<Path>) s::iterator) {
            if (!p.toString().endsWith(".class")) continue;
            byte[] b = Files.readAllBytes(p);
            String src = sourceFile(b);
            if (src != null && keys.contains(pkg.isEmpty() ? src : pkg + "/" + src)) classes.add(b);
          }
        }
      }
    }
    StringBuilder out = new StringBuilder();
    for (String exec : Files.readAllLines(Paths.get(args[1]))) {
      if (exec.isEmpty()) continue;
      out.append(exec).append('\t');
      if (!new File(exec).isFile()) { out.append('\n'); continue; }
      ExecFileLoader loader = new ExecFileLoader();
      try { loader.load(new File(exec)); } catch (IOException e) { out.append('\n'); continue; }
      CoverageBuilder cov = new CoverageBuilder();
      Analyzer a = new Analyzer(loader.getExecutionDataStore(), cov);
      for (byte[] b : classes) {
        try { a.analyzeClass(b, "target"); } catch (Exception e) { /* a class JaCoCo cannot read */ }
      }
      for (ISourceFileCoverage sf : cov.getSourceFiles()) {
        String key = sf.getPackageName().isEmpty() ? sf.getName() : sf.getPackageName() + "/" + sf.getName();
        StringBuilder lines = new StringBuilder();
        for (int l = sf.getFirstLine(); l > 0 && l <= sf.getLastLine(); l++) {
          int st = sf.getLine(l).getStatus();
          if (st == ICounter.FULLY_COVERED || st == ICounter.PARTLY_COVERED) lines.append(lines.length() > 0 ? "," : "").append(l);
        }
        if (lines.length() > 0) out.append(key).append(':').append(lines).append(';');
      }
      out.append('\n');
    }
    Files.write(Paths.get(args[2]), out.toString().getBytes(StandardCharsets.UTF_8));
  }

  static byte[] readAll(InputStream in) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buf = new byte[8192];
    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
    return out.toByteArray();
  }

  static String sourceFile(byte[] b) {
    String[] found = new String[1];
    try {
      new ClassReader(b).accept(new ClassVisitor(Opcodes.ASM9) {
        @Override public void visitSource(String source, String debug) { found[0] = source; }
      }, ClassReader.SKIP_CODE | ClassReader.SKIP_FRAMES);
    } catch (Exception e) {
      return null;
    }
    return found[0];
  }
}
