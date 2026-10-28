import { CType, type CTypeOrString } from 'bun-xffi';

export interface JniSignature {
  readonly returns: CTypeOrString;
  readonly args: readonly CTypeOrString[];
}

function sig(returns: CTypeOrString, args: CTypeOrString[]): JniSignature {
  return { returns, args };
}

/**
 * `JNIInvokeInterface_` signatures, transcribed from `simplejni.h` (the C
 * reference at `~/Work/NThreadJava`) -- same flat, real-C-ABI-matching
 * `CType.X` style as any other signature dict in this codebase (e.g.
 * `packages/xffi/src/win/kernel32.ts`). **None of these declare the
 * `JavaVM*` "this" argument** -- it's always `args[0]` on the real C side,
 * but every one of these gets resolved into a bound function that injects it
 * dynamically (`NJavaAccessor`'s `bindFunction`) or has it supplied
 * explicitly by the one caller that needs the raw form (`onInit`'s own
 * bootstrap) -- either way, declaring it here would be redundant and wrong
 * for the bound form, so it's left off everywhere, not just where it's
 * "implicit".
 *
 * All 5 are JNI 1.1 baseline -- unchanged since the original spec.
 */
export const JNI_INVOKE_SIGNATURES = {
  DestroyJavaVM: sig(CType.INT, []),
  AttachCurrentThread: sig(CType.INT, [CType.LPVOID, CType.LPVOID]),
  DetachCurrentThread: sig(CType.INT, []),
  GetEnv: sig(CType.INT, [CType.LPVOID, CType.INT]),
  AttachCurrentThreadAsDaemon: sig(CType.INT, [CType.LPVOID, CType.LPVOID]),
} as const;

/**
 * `JNINativeInterface_` signatures, same shape and same "no `JNIEnv*`
 * argument declared anywhere" rule as {@link JNI_INVOKE_SIGNATURES} above.
 *
 * Only the **fixed-arity** entries are declared at all -- the plain
 * `Call*Method`/`New*`/`Call*MethodV` (`va_list`) forms have no signature
 * that's meaningfully representable through a static FFI declaration (real
 * C varargs / a platform `va_list` aren't just "some more pointer-sized
 * args"), so they're skipped entirely: neither the "bound, env-dropped" form
 * nor the "raw, env-explicit" form makes sense for them. The `*A` forms
 * (`const jvalue *args`, a plain array pointer) *are* fixed-arity and fully
 * declared. Every slot -- typed here or not -- still has its address
 * resolvable via `JNI_NATIVE_INTERFACE_FIELDS` in `jni-vtables.ts`, since
 * that list exists purely to get struct offsets right, independent of
 * whether a signature is declared for it.
 *
 * Grouped by which JNI spec revision introduced each entry -- Java 8 speaks
 * JNI 1.6, so every group here is present in it, but only the "1.1 baseline"
 * group is guaranteed on *any* JNI-compliant JVM (relevant once njava grows
 * multi-version support beyond Java 8: the 1.1 group needs no version
 * branching, the later groups do).
 */
export const JNI_NATIVE_SIGNATURES = {
  // ---- JNI 1.1 baseline --------------------------------------------------
  GetVersion: sig(CType.INT, []),
  DefineClass: sig(CType.LPVOID, [
    CType.LPCVOID,
    CType.LPVOID,
    CType.LPCVOID,
    CType.INT,
  ]),
  FindClass: sig(CType.LPVOID, [CType.LPCVOID]),
  GetSuperclass: sig(CType.LPVOID, [CType.LPVOID]),
  IsAssignableFrom: sig(CType.uchar, [CType.LPVOID, CType.LPVOID]),
  Throw: sig(CType.INT, [CType.LPVOID]),
  ThrowNew: sig(CType.INT, [CType.LPVOID, CType.LPCVOID]),
  ExceptionOccurred: sig(CType.LPVOID, []),
  ExceptionDescribe: sig(CType.void, []),
  ExceptionClear: sig(CType.void, []),
  FatalError: sig(CType.void, [CType.LPCVOID]),
  NewGlobalRef: sig(CType.LPVOID, [CType.LPVOID]),
  DeleteGlobalRef: sig(CType.void, [CType.LPVOID]),
  DeleteLocalRef: sig(CType.void, [CType.LPVOID]),
  IsSameObject: sig(CType.uchar, [CType.LPVOID, CType.LPVOID]),
  AllocObject: sig(CType.LPVOID, [CType.LPVOID]),
  NewObjectA: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID, CType.LPCVOID]),
  GetObjectClass: sig(CType.LPVOID, [CType.LPVOID]),
  IsInstanceOf: sig(CType.uchar, [CType.LPVOID, CType.LPVOID]),
  GetMethodID: sig(CType.LPVOID, [CType.LPVOID, CType.LPCVOID, CType.LPCVOID]),

  CallObjectMethodA: sig(CType.LPVOID, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallBooleanMethodA: sig(CType.uchar, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallByteMethodA: sig(CType.int8_t, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallCharMethodA: sig(CType.ushort, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallShortMethodA: sig(CType.SHORT, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallIntMethodA: sig(CType.INT, [CType.LPVOID, CType.LPVOID, CType.LPCVOID]),
  CallLongMethodA: sig(CType.LONGLONG, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallFloatMethodA: sig(CType.float, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallDoubleMethodA: sig(CType.double, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallVoidMethodA: sig(CType.void, [CType.LPVOID, CType.LPVOID, CType.LPCVOID]),

  CallNonvirtualObjectMethodA: sig(CType.LPVOID, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallNonvirtualBooleanMethodA: sig(CType.uchar, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallNonvirtualByteMethodA: sig(CType.int8_t, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallNonvirtualCharMethodA: sig(CType.ushort, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallNonvirtualShortMethodA: sig(CType.SHORT, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallNonvirtualIntMethodA: sig(CType.INT, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallNonvirtualLongMethodA: sig(CType.LONGLONG, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallNonvirtualFloatMethodA: sig(CType.float, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallNonvirtualDoubleMethodA: sig(CType.double, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallNonvirtualVoidMethodA: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),

  GetFieldID: sig(CType.LPVOID, [CType.LPVOID, CType.LPCVOID, CType.LPCVOID]),
  GetObjectField: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  GetBooleanField: sig(CType.uchar, [CType.LPVOID, CType.LPVOID]),
  GetByteField: sig(CType.int8_t, [CType.LPVOID, CType.LPVOID]),
  GetCharField: sig(CType.ushort, [CType.LPVOID, CType.LPVOID]),
  GetShortField: sig(CType.SHORT, [CType.LPVOID, CType.LPVOID]),
  GetIntField: sig(CType.INT, [CType.LPVOID, CType.LPVOID]),
  GetLongField: sig(CType.LONGLONG, [CType.LPVOID, CType.LPVOID]),
  GetFloatField: sig(CType.float, [CType.LPVOID, CType.LPVOID]),
  GetDoubleField: sig(CType.double, [CType.LPVOID, CType.LPVOID]),

  SetObjectField: sig(CType.void, [CType.LPVOID, CType.LPVOID, CType.LPVOID]),
  SetBooleanField: sig(CType.void, [CType.LPVOID, CType.LPVOID, CType.uchar]),
  SetByteField: sig(CType.void, [CType.LPVOID, CType.LPVOID, CType.int8_t]),
  SetCharField: sig(CType.void, [CType.LPVOID, CType.LPVOID, CType.ushort]),
  SetShortField: sig(CType.void, [CType.LPVOID, CType.LPVOID, CType.SHORT]),
  SetIntField: sig(CType.void, [CType.LPVOID, CType.LPVOID, CType.INT]),
  SetLongField: sig(CType.void, [CType.LPVOID, CType.LPVOID, CType.LONGLONG]),
  SetFloatField: sig(CType.void, [CType.LPVOID, CType.LPVOID, CType.float]),
  SetDoubleField: sig(CType.void, [CType.LPVOID, CType.LPVOID, CType.double]),

  GetStaticMethodID: sig(CType.LPVOID, [
    CType.LPVOID,
    CType.LPCVOID,
    CType.LPCVOID,
  ]),

  CallStaticObjectMethodA: sig(CType.LPVOID, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallStaticBooleanMethodA: sig(CType.uchar, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallStaticByteMethodA: sig(CType.int8_t, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallStaticCharMethodA: sig(CType.ushort, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallStaticShortMethodA: sig(CType.SHORT, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallStaticIntMethodA: sig(CType.INT, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallStaticLongMethodA: sig(CType.LONGLONG, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallStaticFloatMethodA: sig(CType.float, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallStaticDoubleMethodA: sig(CType.double, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),
  CallStaticVoidMethodA: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPCVOID,
  ]),

  GetStaticFieldID: sig(CType.LPVOID, [
    CType.LPVOID,
    CType.LPCVOID,
    CType.LPCVOID,
  ]),
  GetStaticObjectField: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  GetStaticBooleanField: sig(CType.uchar, [CType.LPVOID, CType.LPVOID]),
  GetStaticByteField: sig(CType.int8_t, [CType.LPVOID, CType.LPVOID]),
  GetStaticCharField: sig(CType.ushort, [CType.LPVOID, CType.LPVOID]),
  GetStaticShortField: sig(CType.SHORT, [CType.LPVOID, CType.LPVOID]),
  GetStaticIntField: sig(CType.INT, [CType.LPVOID, CType.LPVOID]),
  GetStaticLongField: sig(CType.LONGLONG, [CType.LPVOID, CType.LPVOID]),
  GetStaticFloatField: sig(CType.float, [CType.LPVOID, CType.LPVOID]),
  GetStaticDoubleField: sig(CType.double, [CType.LPVOID, CType.LPVOID]),

  SetStaticObjectField: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LPVOID,
  ]),
  SetStaticBooleanField: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.uchar,
  ]),
  SetStaticByteField: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.int8_t,
  ]),
  SetStaticCharField: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.ushort,
  ]),
  SetStaticShortField: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.SHORT,
  ]),
  SetStaticIntField: sig(CType.void, [CType.LPVOID, CType.LPVOID, CType.INT]),
  SetStaticLongField: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.LONGLONG,
  ]),
  SetStaticFloatField: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.float,
  ]),
  SetStaticDoubleField: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.double,
  ]),

  NewString: sig(CType.LPVOID, [CType.LPCVOID, CType.INT]),
  GetStringLength: sig(CType.INT, [CType.LPVOID]),
  GetStringChars: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  ReleaseStringChars: sig(CType.void, [CType.LPVOID, CType.LPCVOID]),

  NewStringUTF: sig(CType.LPVOID, [CType.LPCVOID]),
  GetStringUTFLength: sig(CType.INT, [CType.LPVOID]),
  GetStringUTFChars: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  ReleaseStringUTFChars: sig(CType.void, [CType.LPVOID, CType.LPCVOID]),

  GetArrayLength: sig(CType.INT, [CType.LPVOID]),

  NewObjectArray: sig(CType.LPVOID, [CType.INT, CType.LPVOID, CType.LPVOID]),
  GetObjectArrayElement: sig(CType.LPVOID, [CType.LPVOID, CType.INT]),
  SetObjectArrayElement: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.LPVOID,
  ]),

  NewBooleanArray: sig(CType.LPVOID, [CType.INT]),
  NewByteArray: sig(CType.LPVOID, [CType.INT]),
  NewCharArray: sig(CType.LPVOID, [CType.INT]),
  NewShortArray: sig(CType.LPVOID, [CType.INT]),
  NewIntArray: sig(CType.LPVOID, [CType.INT]),
  NewLongArray: sig(CType.LPVOID, [CType.INT]),
  NewFloatArray: sig(CType.LPVOID, [CType.INT]),
  NewDoubleArray: sig(CType.LPVOID, [CType.INT]),

  GetBooleanArrayElements: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  GetByteArrayElements: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  GetCharArrayElements: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  GetShortArrayElements: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  GetIntArrayElements: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  GetLongArrayElements: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  GetFloatArrayElements: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  GetDoubleArrayElements: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),

  ReleaseBooleanArrayElements: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.INT,
  ]),
  ReleaseByteArrayElements: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.INT,
  ]),
  ReleaseCharArrayElements: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.INT,
  ]),
  ReleaseShortArrayElements: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.INT,
  ]),
  ReleaseIntArrayElements: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.INT,
  ]),
  ReleaseLongArrayElements: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.INT,
  ]),
  ReleaseFloatArrayElements: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.INT,
  ]),
  ReleaseDoubleArrayElements: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.INT,
  ]),

  GetBooleanArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPVOID,
  ]),
  GetByteArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPVOID,
  ]),
  GetCharArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPVOID,
  ]),
  GetShortArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPVOID,
  ]),
  GetIntArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPVOID,
  ]),
  GetLongArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPVOID,
  ]),
  GetFloatArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPVOID,
  ]),
  GetDoubleArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPVOID,
  ]),

  SetBooleanArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPCVOID,
  ]),
  SetByteArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPCVOID,
  ]),
  SetCharArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPCVOID,
  ]),
  SetShortArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPCVOID,
  ]),
  SetIntArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPCVOID,
  ]),
  SetLongArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPCVOID,
  ]),
  SetFloatArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPCVOID,
  ]),
  SetDoubleArrayRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPCVOID,
  ]),

  RegisterNatives: sig(CType.INT, [CType.LPVOID, CType.LPCVOID, CType.INT]),
  UnregisterNatives: sig(CType.INT, [CType.LPVOID]),

  MonitorEnter: sig(CType.INT, [CType.LPVOID]),
  MonitorExit: sig(CType.INT, [CType.LPVOID]),

  GetJavaVM: sig(CType.INT, [CType.LPVOID]),

  // ---- JNI 1.2 additions (JDK 1.2) --------------------------------------
  PushLocalFrame: sig(CType.INT, [CType.INT]),
  PopLocalFrame: sig(CType.LPVOID, [CType.LPVOID]),
  NewLocalRef: sig(CType.LPVOID, [CType.LPVOID]),
  EnsureLocalCapacity: sig(CType.INT, [CType.INT]),

  FromReflectedMethod: sig(CType.LPVOID, [CType.LPVOID]),
  FromReflectedField: sig(CType.LPVOID, [CType.LPVOID]),
  ToReflectedMethod: sig(CType.LPVOID, [
    CType.LPVOID,
    CType.LPVOID,
    CType.uchar,
  ]),
  ToReflectedField: sig(CType.LPVOID, [
    CType.LPVOID,
    CType.LPVOID,
    CType.uchar,
  ]),

  GetStringRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPVOID,
  ]),
  GetStringUTFRegion: sig(CType.void, [
    CType.LPVOID,
    CType.INT,
    CType.INT,
    CType.LPVOID,
  ]),

  GetPrimitiveArrayCritical: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  ReleasePrimitiveArrayCritical: sig(CType.void, [
    CType.LPVOID,
    CType.LPVOID,
    CType.INT,
  ]),

  GetStringCritical: sig(CType.LPVOID, [CType.LPVOID, CType.LPVOID]),
  ReleaseStringCritical: sig(CType.void, [CType.LPVOID, CType.LPCVOID]),

  NewWeakGlobalRef: sig(CType.LPVOID, [CType.LPVOID]),
  DeleteWeakGlobalRef: sig(CType.void, [CType.LPVOID]),

  ExceptionCheck: sig(CType.uchar, []),

  // ---- JNI 1.4 additions (JDK 1.4) --------------------------------------
  NewDirectByteBuffer: sig(CType.LPVOID, [CType.LPVOID, CType.LONGLONG]),
  GetDirectBufferAddress: sig(CType.LPVOID, [CType.LPVOID]),
  GetDirectBufferCapacity: sig(CType.LONGLONG, [CType.LPVOID]),

  // ---- JNI 1.6 additions (JDK 1.6 -- confirmed by `simplejni.h`'s own
  //      "/* New JNI 1.6 Features */" comment right above this entry) ------
  GetObjectRefType: sig(CType.INT, [CType.LPVOID]),
} as const;

/**
 * Plain JNI DLL exports -- not a vtable slot at all, so these have no
 * implicit "this" (`JNIEnv*`/`JavaVM*`) to drop or add back; third category
 * alongside {@link JNI_NATIVE_SIGNATURES} (`JNIEnv*`-first) and
 * {@link JNI_INVOKE_SIGNATURES} (`JavaVM*`-first). Currently just the one
 * entry `NJavaAccessor` actually calls (`resolveJniGetCreatedJavaVMsOffset`
 * + a direct `createCFunction` call in `onInit`), declared here for the same
 * reason everything else is: one canonical, real-ABI-matching source.
 */
export const JNI_PLAIN_SIGNATURES = {
  JNI_GetCreatedJavaVMs: sig(CType.INT, [
    CType.LPVOID,
    CType.INT,
    CType.LPVOID,
  ]),
} as const;
