import { compileStruct, type AddressLike, type ComputedStruct } from 'bun-xffi';

/**
 * `JNIInvokeInterface_` field order, transcribed verbatim from
 * `simplejni.h` (the C reference at `~/Work/NThreadJava`, lines ~597-613).
 * Order is the ABI -- every entry is one pointer-sized vtable slot -- so this
 * is copied 1:1 rather than re-derived.
 */
export const JNI_INVOKE_INTERFACE_FIELDS = [
  'reserved0',
  'reserved1',
  'reserved2',
  'DestroyJavaVM',
  'AttachCurrentThread',
  'DetachCurrentThread',
  'GetEnv',
  'AttachCurrentThreadAsDaemon',
] as const;

/**
 * `JNINativeInterface_` field order, transcribed verbatim from `simplejni.h`
 * (lines ~83-597). Only `GetVersion` is used this round (see
 * `jni-functions.ts`) -- the rest of the table exists so resolving further
 * JNI functions later is just adding a `jniFn(...)` declaration, not new
 * offset work.
 */
export const JNI_NATIVE_INTERFACE_FIELDS = [
  'reserved0',
  'reserved1',
  'reserved2',
  'reserved3',
  'GetVersion',
  'DefineClass',
  'FindClass',
  'FromReflectedMethod',
  'FromReflectedField',
  'ToReflectedMethod',
  'GetSuperclass',
  'IsAssignableFrom',
  'ToReflectedField',
  'Throw',
  'ThrowNew',
  'ExceptionOccurred',
  'ExceptionDescribe',
  'ExceptionClear',
  'FatalError',
  'PushLocalFrame',
  'PopLocalFrame',
  'NewGlobalRef',
  'DeleteGlobalRef',
  'DeleteLocalRef',
  'IsSameObject',
  'NewLocalRef',
  'EnsureLocalCapacity',
  'AllocObject',
  'NewObject',
  'NewObjectV',
  'NewObjectA',
  'GetObjectClass',
  'IsInstanceOf',
  'GetMethodID',
  'CallObjectMethod',
  'CallObjectMethodV',
  'CallObjectMethodA',
  'CallBooleanMethod',
  'CallBooleanMethodV',
  'CallBooleanMethodA',
  'CallByteMethod',
  'CallByteMethodV',
  'CallByteMethodA',
  'CallCharMethod',
  'CallCharMethodV',
  'CallCharMethodA',
  'CallShortMethod',
  'CallShortMethodV',
  'CallShortMethodA',
  'CallIntMethod',
  'CallIntMethodV',
  'CallIntMethodA',
  'CallLongMethod',
  'CallLongMethodV',
  'CallLongMethodA',
  'CallFloatMethod',
  'CallFloatMethodV',
  'CallFloatMethodA',
  'CallDoubleMethod',
  'CallDoubleMethodV',
  'CallDoubleMethodA',
  'CallVoidMethod',
  'CallVoidMethodV',
  'CallVoidMethodA',
  'CallNonvirtualObjectMethod',
  'CallNonvirtualObjectMethodV',
  'CallNonvirtualObjectMethodA',
  'CallNonvirtualBooleanMethod',
  'CallNonvirtualBooleanMethodV',
  'CallNonvirtualBooleanMethodA',
  'CallNonvirtualByteMethod',
  'CallNonvirtualByteMethodV',
  'CallNonvirtualByteMethodA',
  'CallNonvirtualCharMethod',
  'CallNonvirtualCharMethodV',
  'CallNonvirtualCharMethodA',
  'CallNonvirtualShortMethod',
  'CallNonvirtualShortMethodV',
  'CallNonvirtualShortMethodA',
  'CallNonvirtualIntMethod',
  'CallNonvirtualIntMethodV',
  'CallNonvirtualIntMethodA',
  'CallNonvirtualLongMethod',
  'CallNonvirtualLongMethodV',
  'CallNonvirtualLongMethodA',
  'CallNonvirtualFloatMethod',
  'CallNonvirtualFloatMethodV',
  'CallNonvirtualFloatMethodA',
  'CallNonvirtualDoubleMethod',
  'CallNonvirtualDoubleMethodV',
  'CallNonvirtualDoubleMethodA',
  'CallNonvirtualVoidMethod',
  'CallNonvirtualVoidMethodV',
  'CallNonvirtualVoidMethodA',
  'GetFieldID',
  'GetObjectField',
  'GetBooleanField',
  'GetByteField',
  'GetCharField',
  'GetShortField',
  'GetIntField',
  'GetLongField',
  'GetFloatField',
  'GetDoubleField',
  'SetObjectField',
  'SetBooleanField',
  'SetByteField',
  'SetCharField',
  'SetShortField',
  'SetIntField',
  'SetLongField',
  'SetFloatField',
  'SetDoubleField',
  'GetStaticMethodID',
  'CallStaticObjectMethod',
  'CallStaticObjectMethodV',
  'CallStaticObjectMethodA',
  'CallStaticBooleanMethod',
  'CallStaticBooleanMethodV',
  'CallStaticBooleanMethodA',
  'CallStaticByteMethod',
  'CallStaticByteMethodV',
  'CallStaticByteMethodA',
  'CallStaticCharMethod',
  'CallStaticCharMethodV',
  'CallStaticCharMethodA',
  'CallStaticShortMethod',
  'CallStaticShortMethodV',
  'CallStaticShortMethodA',
  'CallStaticIntMethod',
  'CallStaticIntMethodV',
  'CallStaticIntMethodA',
  'CallStaticLongMethod',
  'CallStaticLongMethodV',
  'CallStaticLongMethodA',
  'CallStaticFloatMethod',
  'CallStaticFloatMethodV',
  'CallStaticFloatMethodA',
  'CallStaticDoubleMethod',
  'CallStaticDoubleMethodV',
  'CallStaticDoubleMethodA',
  'CallStaticVoidMethod',
  'CallStaticVoidMethodV',
  'CallStaticVoidMethodA',
  'GetStaticFieldID',
  'GetStaticObjectField',
  'GetStaticBooleanField',
  'GetStaticByteField',
  'GetStaticCharField',
  'GetStaticShortField',
  'GetStaticIntField',
  'GetStaticLongField',
  'GetStaticFloatField',
  'GetStaticDoubleField',
  'SetStaticObjectField',
  'SetStaticBooleanField',
  'SetStaticByteField',
  'SetStaticCharField',
  'SetStaticShortField',
  'SetStaticIntField',
  'SetStaticLongField',
  'SetStaticFloatField',
  'SetStaticDoubleField',
  'NewString',
  'GetStringLength',
  'GetStringChars',
  'ReleaseStringChars',
  'NewStringUTF',
  'GetStringUTFLength',
  'GetStringUTFChars',
  'ReleaseStringUTFChars',
  'GetArrayLength',
  'NewObjectArray',
  'GetObjectArrayElement',
  'SetObjectArrayElement',
  'NewBooleanArray',
  'NewByteArray',
  'NewCharArray',
  'NewShortArray',
  'NewIntArray',
  'NewLongArray',
  'NewFloatArray',
  'NewDoubleArray',
  'GetBooleanArrayElements',
  'GetByteArrayElements',
  'GetCharArrayElements',
  'GetShortArrayElements',
  'GetIntArrayElements',
  'GetLongArrayElements',
  'GetFloatArrayElements',
  'GetDoubleArrayElements',
  'ReleaseBooleanArrayElements',
  'ReleaseByteArrayElements',
  'ReleaseCharArrayElements',
  'ReleaseShortArrayElements',
  'ReleaseIntArrayElements',
  'ReleaseLongArrayElements',
  'ReleaseFloatArrayElements',
  'ReleaseDoubleArrayElements',
  'GetBooleanArrayRegion',
  'GetByteArrayRegion',
  'GetCharArrayRegion',
  'GetShortArrayRegion',
  'GetIntArrayRegion',
  'GetLongArrayRegion',
  'GetFloatArrayRegion',
  'GetDoubleArrayRegion',
  'SetBooleanArrayRegion',
  'SetByteArrayRegion',
  'SetCharArrayRegion',
  'SetShortArrayRegion',
  'SetIntArrayRegion',
  'SetLongArrayRegion',
  'SetFloatArrayRegion',
  'SetDoubleArrayRegion',
  'RegisterNatives',
  'UnregisterNatives',
  'MonitorEnter',
  'MonitorExit',
  'GetJavaVM',
  'GetStringRegion',
  'GetStringUTFRegion',
  'GetPrimitiveArrayCritical',
  'ReleasePrimitiveArrayCritical',
  'GetStringCritical',
  'ReleaseStringCritical',
  'NewWeakGlobalRef',
  'DeleteWeakGlobalRef',
  'ExceptionCheck',
  'NewDirectByteBuffer',
  'GetDirectBufferAddress',
  'GetDirectBufferCapacity',
  'GetObjectRefType',
] as const;

export function vtableLayout(fields: readonly string[]): ComputedStruct {
  const schema: Record<string, 'ptr'> = {};
  for (const field of fields) schema[field] = 'ptr';
  return compileStruct(schema);
}

/** Pre-compiled struct layout for `JNIInvokeInterface_` (JavaVM vtable). */
export const JNIInvokeInterfaceLayout = vtableLayout(
  JNI_INVOKE_INTERFACE_FIELDS,
);

/** Pre-compiled struct layout for `JNINativeInterface_` (JNIEnv vtable). */
export const JNINativeInterfaceLayout = vtableLayout(
  JNI_NATIVE_INTERFACE_FIELDS,
);

function parseVtableBuffer(
  buf: Buffer,
  fields: readonly string[],
  layout: ReturnType<typeof vtableLayout>,
): Map<string, bigint> {
  const table = new Map<string, bigint>();
  for (const field of fields) {
    const offset = layout.fields[field]!.offset;
    table.set(field, buf.readBigUInt64LE(offset));
  }
  return table;
}

/**
 * Reads a JNI vtable (an array of function pointers, one per `fields`
 * entry, in declared order) at `vtableBase` into a name -> real address map.
 */
export async function readVtable(
  read: (address: AddressLike, size: number) => Promise<Buffer>,
  vtableBase: AddressLike,
  fields: readonly string[],
): Promise<Map<string, bigint>> {
  const layout =
    fields === JNI_NATIVE_INTERFACE_FIELDS
      ? JNINativeInterfaceLayout
      : fields === JNI_INVOKE_INTERFACE_FIELDS
        ? JNIInvokeInterfaceLayout
        : vtableLayout(fields);
  const buf = await read(vtableBase, layout.totalSize);
  return parseVtableBuffer(buf, fields, layout);
}

/** Synchronous twin of {@link readVtable}. */
export function readVtableSync(
  read: (address: AddressLike, size: number) => Buffer,
  vtableBase: AddressLike,
  fields: readonly string[],
): Map<string, bigint> {
  const layout =
    fields === JNI_NATIVE_INTERFACE_FIELDS
      ? JNINativeInterfaceLayout
      : fields === JNI_INVOKE_INTERFACE_FIELDS
        ? JNIInvokeInterfaceLayout
        : vtableLayout(fields);
  const buf = read(vtableBase, layout.totalSize);
  return parseVtableBuffer(buf, fields, layout);
}
