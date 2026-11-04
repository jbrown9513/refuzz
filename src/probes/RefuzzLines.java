import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.stream.Stream;
import org.jacoco.core.analysis.Analyzer;
import org.jacoco.core.analysis.CoverageBuilder;
import org.jacoco.core.analysis.ICounter;
import org.jacoco.core.analysis.ISourceFileCoverage;
import org.jacoco.core.data.ExecutionData;
import org.jacoco.core.internal.data.CRC64;
import org.jacoco.core.tools.ExecFileLoader;

/**
 * The source lines one input ran, for RefuzzDriver: JaCoCo's analysis of the probes in an exec dump against the class files
 * of the instrumented packages. Loaded in its own class loader with JaCoCo and ASM, so the project's own ASM never meets ours.
 * Only classes the dump has hits for are analyzed.
 */
public class RefuzzLines {
  private final Map<Long, byte[]> classes = new HashMap<>();

  public RefuzzLines(String[] roots, String[] packages) throws Exception {
    for (String root : roots) {
      if (root.endsWith(".jar") && new File(root).isFile()) {
        try (JarFile jar = new JarFile(root)) {
          for (JarEntry e : Collections.list(jar.entries())) {
            String n = e.getName();
            if (!n.endsWith(".class") || !inPackages(n, packages)) continue;
            try (InputStream in = jar.getInputStream(e)) { add(RefuzzCoverage.readAll(in)); }
          }
        }
        continue;
      }
      for (String pkg : packages) {
        Path dir = Paths.get(root, pkg);
        if (!Files.isDirectory(dir)) continue;
        try (Stream<Path> s = Files.walk(dir)) {
          for (Path p : (Iterable<Path>) s::iterator) if (p.toString().endsWith(".class")) add(Files.readAllBytes(p));
        }
      }
    }
  }

  private void add(byte[] b) { classes.putIfAbsent(CRC64.classId(b), b); }

  private static boolean inPackages(String entry, String[] packages) {
    for (String p : packages) if (p.isEmpty() || entry.startsWith(p + "/")) return true;
    return false;
  }

  /** `package/File.ext:line` for every line the dump ran. */
  public String[] lines(byte[] exec) throws Exception {
    ExecFileLoader loader = new ExecFileLoader();
    loader.load(new ByteArrayInputStream(exec));
    CoverageBuilder cov = new CoverageBuilder();
    Analyzer a = new Analyzer(loader.getExecutionDataStore(), cov);
    for (ExecutionData d : loader.getExecutionDataStore().getContents()) {
      byte[] b = classes.get(d.getId());
      if (b == null || !d.hasHits()) continue;
      try { a.analyzeClass(b, d.getName()); } catch (Exception e) { /* a class JaCoCo cannot read */ }
    }
    List<String> out = new ArrayList<>();
    for (ISourceFileCoverage sf : cov.getSourceFiles()) {
      String key = sf.getPackageName().isEmpty() ? sf.getName() : sf.getPackageName() + "/" + sf.getName();
      for (int l = sf.getFirstLine(); l > 0 && l <= sf.getLastLine(); l++) {
        int st = sf.getLine(l).getStatus();
        if (st == ICounter.FULLY_COVERED || st == ICounter.PARTLY_COVERED) out.add(key + ":" + l);
      }
    }
    return out.toArray(new String[0]);
  }
}
