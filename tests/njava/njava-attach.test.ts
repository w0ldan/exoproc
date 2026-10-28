import { expect, test, describe, afterEach } from 'bun:test';
import { type DummyProcess } from 'exoproc-dummy';
import { type HostAccessor, createAccessor } from 'exoproc-accessors';
import { getNJava, findNJava, getJavaClass, getReflection } from 'bun-njava';
import { spawnJavaDummyProcess } from './java-dummy-process.js';

describe('njava > NJavaAccessor', () => {
  let proc: DummyProcess | undefined;
  let host: HostAccessor | undefined;

  afterEach(async () => {
    if (host) {
      host.close();
      host = undefined;
    }
    if (proc) {
      await proc.stop();
      proc = undefined;
    }
  });

  test('auto-attaches NJavaAccessor on Java 8 process by default (njava: auto)', async () => {
    proc = spawnJavaDummyProcess();
    // Default options (njava: 'auto') detects jvm.dll via GetModuleHandleA and attaches
    host = await createAccessor(proc.pid);

    const njava = getNJava(host);
    expect(njava).toBeDefined();
    expect(host.backend).toBe(njava);

    const functions = await njava.getFunctions();
    const version = await functions.GetVersion();
    expect(version).toBe(0x00010008);
  }, 120000);

  test('reads and writes Idle.class static fields via getField / field.get / field.set', async () => {
    proc = spawnJavaDummyProcess();
    host = await createAccessor(proc.pid);

    // Direct access to reflection without getNJava:
    const idleClass = await getJavaClass(host, 'Idle');
    expect(idleClass.classObj).not.toBe(0n);

    // Get field handles and read their values with auto unboxing
    const intField = await idleClass.getField('intValue');
    expect(intField.name).toBe('intValue');
    expect(intField.type).toBe('int');
    expect(intField.isStatic).toBe(true);
    expect(await intField.get()).toBe(42);

    const boolField = await idleClass.getField('boolValue');
    expect(await boolField.get()).toBe(true);

    const doubleField = await idleClass.getField('doubleValue');
    expect(await doubleField.get()).toBeCloseTo(3.14, 10);

    const utf8Field = await idleClass.getField('utf8Value');
    expect(await utf8Field.get()).toBe('Hello from njava');

    const utf16Field = await idleClass.getField('utf16Value');
    expect(await utf16Field.get()).toBe('njava buradaydı 🐛');

    // Mutate field via field.set() with auto primitive boxing
    await intField.set(100);
    expect(await intField.get()).toBe(100);

    // Direct readField / writeField on class handle
    await idleClass.writeField('intValue', 42);
    expect(await idleClass.readField('intValue')).toBe(42);
  }, 120000);

  test('reflectively invokes Idle.add(int, int) via getMethod with invoke / call', async () => {
    proc = spawnJavaDummyProcess();
    host = await createAccessor(proc.pid);

    // Direct access to reflection via getReflection(host)
    const reflection = await getReflection(host);

    const idleClass = await reflection.getClass('Idle');
    const addMethod = await idleClass.getMethod('add');
    expect(addMethod.name).toBe('add');
    expect(addMethod.returnType).toBe('int');
    expect(addMethod.isStatic).toBe(true);
    expect(addMethod.paramTypes).toEqual(['int', 'int']);

    // Invoke via method.invoke([2, 40])
    expect(await addMethod.invoke([2, 40])).toBe(42);

    // Invoke via method.call(0n, 10, 32)
    expect(await addMethod.call(0n, 10, 32)).toBe(42);
  }, 120000);

  test('attaches via njava: stealth by spawning dedicated worker thread', async () => {
    proc = spawnJavaDummyProcess();
    host = await createAccessor(proc.pid, { njava: 'stealth' });

    // Host accessor should have njava attached on the newly spawned dedicated thread
    expect(getNJava(host)).toBeDefined();
    const idleClass = await getJavaClass(host, 'Idle');
    expect(idleClass.classObj).not.toBe(0n);

    // Read field and invoke method on the stealth-attached dedicated thread
    expect(await idleClass.readField('intValue')).toBe(42);
    const addMethod = await idleClass.getMethod('add');
    expect(await addMethod.call(0n, 15, 27)).toBe(42);
  }, 120000);

  test('does not attach NJavaAccessor when njava: false is specified', async () => {
    proc = spawnJavaDummyProcess();
    host = await createAccessor(proc.pid, { njava: false });

    // With njava: false, njava is not attached even if jvm.dll is loaded
    expect(findNJava(host)).toBeUndefined();
    expect(() => getNJava(host!)).toThrow(/no NJavaAccessor found/);
  }, 120000);
});
