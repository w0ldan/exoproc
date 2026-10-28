export interface JavaMethodSchema {
  params?: string[];
  returnType?: string;
  isStatic?: boolean;
  obf?: string;
  matched?: boolean;
}

export interface JavaFieldSchema {
  type: string;
  obf?: string;
  matched?: boolean;
}

export interface JavaStubClassSchema {
  canonical?: string;
  canonicalClassName?: string;
  superclass?: string;
  interfaces?: string[];
  fields?: Record<string, string | JavaFieldSchema>;
  methods?: Record<string, string | JavaMethodSchema>;
  obf?: string;
  matched?: boolean;
}

export interface JavaDatabaseSchema {
  classes?: Record<string, JavaStubClassSchema>;
  [key: string]: any;
}

export interface JavaStubProjectOptions {
  /**
   * Root directory of the stub project workspace.
   * If omitted, a temporary directory is created: `<tmpdir>/exoproc-java-workspace-<id>`.
   */
  workspaceDir?: string;

  /**
   * Java binary path or command to invoke ECJ and Java tools.
   */
  javaPath?: string;

  /**
   * Target Java major version (defaults to 8).
   */
  javaVersion?: number;

  /**
   * Additional classpath entries required to compile stubs.
   */
  classPath?: string | string[];

  /**
   * Target bytecode version for ECJ (e.g. "-1.8").
   */
  targetVersion?: string;

  /**
   * Source language version for ECJ (e.g. "-1.8").
   */
  sourceVersion?: string;
}
