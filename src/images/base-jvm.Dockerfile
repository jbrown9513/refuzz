# OSS-Fuzz's base-builder-jvm rebuilt for this machine: JDK 17 as $JAVA_HOME (JDK 21 at $JAVA_21_HOME), Jazzer 0.30.0 from
# Maven Central as OSS-Fuzz names it (jazzer_driver, jazzer_agent_deploy.jar, $JAZZER_API_PATH), clang, and OSS-Fuzz's paths
# ($SRC, $OUT, $WORK) and build variables. Maven 3.9 (mvn, $MVN) and Gradle 8.10 (gradle) are installed; a project with a
# wrapper uses its own. As OSS-Fuzz's JVM projects do, build.sh builds the project and copies its jars and every jar it
# needs at run time (its runtime dependencies, the Kotlin, Scala or Groovy standard library) into $OUT, flat: fuzz targets
# compile and run against $OUT/*.jar. It builds no fuzz targets. A spec FROM gcr.io/oss-fuzz-base/base-builder-jvm builds on
# it unchanged. Not in OSS-Fuzz's image: the Kotlin and Scala compilers and JaCoCo, which refuzz uses for targets
# written in those languages and for line coverage.
FROM eclipse-temurin:21-jdk-jammy AS jdk21
FROM eclipse-temurin:17-jdk-jammy
RUN apt-get update && apt-get install -y --no-install-recommends \
      clang llvm make cmake pkg-config git curl wget ca-certificates zip unzip jq python3 build-essential \
 && rm -rf /var/lib/apt/lists/*
COPY --from=jdk21 /opt/java/openjdk /usr/lib/jvm/java-21
ENV JAVA_HOME=/opt/java/openjdk JAVA_21_HOME=/usr/lib/jvm/java-21 JVM_LD_LIBRARY_PATH=/opt/java/openjdk/lib/server \
    MAVEN_HOME=/usr/local/maven MVN=/usr/local/maven/bin/mvn GRADLE_HOME=/usr/local/gradle \
    PATH=/opt/java/openjdk/bin:/usr/local/maven/bin:/usr/local/gradle/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    JAZZER_API_PATH=/usr/local/lib/jazzer_api_deploy.jar JAZZER_JUNIT_PATH=/usr/local/bin/jazzer_junit.jar
RUN curl -sSfL https://archive.apache.org/dist/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.tar.gz | tar -xz -C /usr/local \
 && mv /usr/local/apache-maven-3.9.9 /usr/local/maven \
 && curl -sSfLo /tmp/gradle.zip https://services.gradle.org/distributions/gradle-8.10.2-bin.zip \
 && unzip -q /tmp/gradle.zip -d /usr/local && mv /usr/local/gradle-8.10.2 /usr/local/gradle && rm /tmp/gradle.zip
COPY jvm/fetch_jars jvm/jazzer_driver /usr/local/bin/
# Jazzer, its bootstrap jar (on the boot class path when Jazzer runs; on the class path for the in-process driver), JaCoCo,
# and the compilers for Kotlin, Scala 2.12, 2.13 and 3 targets.
RUN chmod +x /usr/local/bin/fetch_jars /usr/local/bin/jazzer_driver \
 && fetch_jars /opt/refuzz/jazzer/lib com.code-intelligence:jazzer:0.30.0 \
 && mkdir -p /opt/refuzz/jazzer/bootstrap && cd /opt/refuzz/jazzer/bootstrap \
 && unzip -q -j /opt/refuzz/jazzer/lib/jazzer-0.30.0.jar com/code_intelligence/jazzer/runtime/jazzer_bootstrap.jar \
 && cp /opt/refuzz/jazzer/lib/jazzer-0.30.0.jar /usr/local/bin/jazzer_agent_deploy.jar \
 && cp /opt/refuzz/jazzer/lib/jazzer-api-0.30.0.jar $JAZZER_API_PATH \
 && fetch_jars /tmp/junit com.code-intelligence:jazzer-junit:0.30.0 && cp /tmp/junit/jazzer-junit-0.30.0.jar $JAZZER_JUNIT_PATH && rm -rf /tmp/junit \
 && fetch_jars /opt/refuzz/jacoco org.jacoco:org.jacoco.core:0.8.12 org.jacoco:org.jacoco.agent:0.8.12:runtime \
 && fetch_jars /opt/refuzz/kotlinc org.jetbrains.kotlin:kotlin-compiler-embeddable:2.1.21 \
 && fetch_jars /opt/refuzz/scalac-2.12 org.scala-lang:scala-compiler:2.12.20 \
 && fetch_jars /opt/refuzz/scalac-2.13 org.scala-lang:scala-compiler:2.13.16 \
 && fetch_jars /opt/refuzz/scalac-3 org.scala-lang:scala3-compiler_3:3.7.1 \
 && printf '#!/bin/sh\nexec java -Xmx2g -cp "/opt/refuzz/kotlinc/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler "$@"\n' > /usr/local/bin/kotlinc \
 && printf '#!/bin/sh\nexec java -Xmx2g -Xss8m -cp "/opt/refuzz/scalac-2.12/*" scala.tools.nsc.Main "$@"\n' > /usr/local/bin/scalac-2.12 \
 && printf '#!/bin/sh\nexec java -Xmx2g -Xss8m -cp "/opt/refuzz/scalac-2.13/*" scala.tools.nsc.Main "$@"\n' > /usr/local/bin/scalac-2.13 \
 && printf '#!/bin/sh\nexec java -Xmx2g -Xss8m -cp "/opt/refuzz/scalac-3/*" dotty.tools.dotc.Main "$@"\n' > /usr/local/bin/scalac-3 \
 && chmod +x /usr/local/bin/kotlinc /usr/local/bin/scalac-* \
 && rm -rf /root/.m2
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=jvm ARCHITECTURE=aarch64
RUN mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
