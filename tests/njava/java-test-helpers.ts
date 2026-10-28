import { existsSync } from 'node:fs';

/**
 * Test helper that discovers the Java executable path depending on the host platform
 * (Windows/Wine vs Linux).
 *
 * - On Windows/Wine: Prioritizes Prism Launcher's Java runtimes (jre-legacy for Java 8,
 *   gamma/beta for Java 17, delta for Java 21) with fallback to Eclipse Adoptium / PATH.
 * - On Linux: Discovers OpenJDK installations at /usr/lib/jvm/java-{version}-openjdk.
 */
export function getTestJavaPath(majorVersion: number = 8): string {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    // Windows / Wine test environment:
    // 1. Check Prism Launcher Java runtimes first
    const appData =
      process.env.APPDATA ||
      (process.env.USERPROFILE
        ? `${process.env.USERPROFILE}\\AppData\\Roaming`
        : 'C:\\users\\serkan\\AppData\\Roaming');
    const prismJavaDir = `${appData}\\PrismLauncher\\java`;

    if (majorVersion === 8) {
      const prismJava8 = `${prismJavaDir}\\jre-legacy\\bin\\java.exe`;
      if (existsSync(prismJava8)) return prismJava8;
    } else if (majorVersion === 17) {
      const prismJava17 = `${prismJavaDir}\\java-runtime-gamma\\bin\\java.exe`;
      if (existsSync(prismJava17)) return prismJava17;
      const prismJavaBeta = `${prismJavaDir}\\java-runtime-beta\\bin\\java.exe`;
      if (existsSync(prismJavaBeta)) return prismJavaBeta;
    } else if (majorVersion === 21) {
      const prismJava21 = `${prismJavaDir}\\java-runtime-delta\\bin\\java.exe`;
      if (existsSync(prismJava21)) return prismJava21;
    }

    // 2. Fallbacks (Adoptium / PATH)
    if (majorVersion === 8) {
      const adoptium8 =
        'C:\\Program Files\\Eclipse Adoptium\\jdk-8.0.482.8-hotspot\\bin\\java.exe';
      if (existsSync(adoptium8)) return adoptium8;
    } else if (majorVersion === 17) {
      const adoptium17 =
        'C:\\Program Files\\Eclipse Adoptium\\jdk-17-hotspot\\bin\\java.exe';
      if (existsSync(adoptium17)) return adoptium17;
    }
    return 'java.exe';
  } else {
    // Linux test environment:
    const openJdkPath = `/usr/lib/jvm/java-${majorVersion}-openjdk/bin/java`;
    if (existsSync(openJdkPath)) return openJdkPath;

    const altPath = `/usr/lib/jvm/java-${majorVersion}/bin/java`;
    if (existsSync(altPath)) return altPath;

    return 'java';
  }
}
