import { ExoprocError } from 'exoproc-utils';

abstract class BaseError extends ExoprocError {
  constructor(
    message: string,
    options?: { data?: unknown; code?: string; cause?: Error },
  ) {
    super(message, options);
  }
}

export class NJavaError extends BaseError {}

/** No `jvm.dll` (or equivalent) module found in the target process. */
export class JvmModuleNotFoundError extends NJavaError {
  constructor(pid: number) {
    super(`No jvm.dll module found in process ${pid}`);
  }
}

/** `JNI_GetCreatedJavaVMs` returned a non-`JNI_OK` status, or found no VMs. */
export class JvmGetCreatedVmError extends NJavaError {
  constructor(public readonly jniStatus: number) {
    super(`JNI_GetCreatedJavaVMs failed with status ${jniStatus}`);
  }
}

/** `JavaVM::GetEnv` returned a non-`JNI_OK` status. */
export class JvmGetEnvError extends NJavaError {
  constructor(public readonly jniStatus: number) {
    super(`JavaVM::GetEnv failed with status ${jniStatus}`);
  }
}

/** A declared JNI function name not present in its resolved vtable. */
export class JniFunctionNotFoundError extends NJavaError {
  constructor(name: string, table: 'invoke' | 'native') {
    super(`No "${name}" entry in the resolved JNI ${table} interface`);
  }
}

/** A requested Java class could not be found reflectively. */
export class ClassNotFoundError extends NJavaError {
  constructor(public readonly className: string) {
    super(`Class not found: ${className}`);
  }
}

/** A requested method could not be found on the class reflectively. */
export class MethodNotFoundError extends NJavaError {
  constructor(
    public readonly methodName: string,
    public readonly className?: string,
  ) {
    super(
      className
        ? `Method "${methodName}" not found on class ${className}`
        : `Method "${methodName}" not found`,
    );
  }
}

/** A requested field could not be found on the class reflectively. */
export class FieldNotFoundError extends NJavaError {
  constructor(
    public readonly fieldName: string,
    public readonly className?: string,
  ) {
    super(
      className
        ? `Field "${fieldName}" not found on class ${className}`
        : `Field "${fieldName}" not found`,
    );
  }
}

/** A requested constructor matching the parameter predicate could not be found. */
export class ConstructorNotFoundError extends NJavaError {
  constructor(public readonly description: string) {
    super(`Constructor not found: ${description}`);
  }
}

/** A reflectively invoked method or constructor threw an exception. */
export class ReflectiveInvokeError extends NJavaError {
  constructor(public readonly aoString: string) {
    super(`Reflective invocation threw: ${aoString}`);
  }
}

/** An unsupported type was passed to the primitive boxing helper. */
export class BoxingUnsupportedError extends NJavaError {
  constructor(public readonly typeName: string) {
    super(`Boxing unsupported for type: ${typeName}`);
  }
}
