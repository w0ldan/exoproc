import { expect, test, describe, afterEach } from 'bun:test';
import { type DummyProcess } from 'exoproc-dummy';
import { type HostAccessor, createAccessor } from 'exoproc-accessors';
import { getJava, getJavaSync } from 'bun-njava';
import { spawnJavaDummyProcess } from './java-dummy-process.js';

describe('njava > Java Dynamic Proxy & Nashorn Bridge', () => {
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

  test('Sync Java proxy: static fields, methods, constructors, instance members and class introspection', async () => {
    proc = spawnJavaDummyProcess();
    host = await createAccessor(proc.pid);

    // Synchronous Java Context without await
    const Java = getJavaSync(host);
    expect(Java).toBeDefined();

    // 1. Resolve Class
    const Idle = Java.type('Idle');
    expect(Idle).toBeDefined();
    expect(Idle.name).toBe('Idle');
    expect(Idle.class.name).toBe('Idle');

    // 2. Static Fields Read & Write (Sync)
    expect(Idle.intValue).toBe(42);
    expect(Idle.boolValue).toBe(true);
    expect(Idle.utf8Value).toBe('Hello from njava');
    expect(Idle.utf16Value).toBe('njava buradaydı 🐛');

    Idle.intValue = 123;
    expect(Idle.intValue).toBe(123);
    Idle.intValue = 42; // Reset

    // 3. Static Methods (Sync)
    expect(Idle.add(15, 27)).toBe(42);

    // 4. Constructor / Instantiation (Sync)
    const player = new Idle('Steve', 500);
    expect(player).toBeDefined();
    expect(player.$ptr).not.toBe(0n);
    expect(player.name).toBe('Steve');
    expect(player.score).toBe(500);

    // 5. Instance Field Mutation (Sync)
    player.score = 777;
    expect(player.score).toBe(777);

    // 6. Instance Method Call (Sync)
    const greeting = player.greet('Greetings');
    expect(greeting).toBe('Greetings, Steve!');

    const newScore = player.increaseScore(23);
    expect(newScore).toBe(800);
    expect(player.score).toBe(800);

    // 7. Object Class Introspection (Sync)
    const playerCls = player.getClass();
    expect(playerCls.name).toBe('Idle');
    expect(player.class.name).toBe('Idle');

    // 8. Superclass Navigation
    const superCls = Idle.superclass;
    expect(superCls).toBeDefined();
    expect(superCls.name).toBe('java.lang.Object');

    // 9. Standard Java Standard Library Classes (StringBuilder)
    const StringBuilder = Java.type('java.lang.StringBuilder');
    const sb = new StringBuilder();
    sb.append('Nashorn ');
    sb.append('Bridge ');
    sb.append('Works!');
    expect(sb.toString()).toBe('Nashorn Bridge Works!');

    // 10. Java.type, Constructor overloads on ArrayList, Java.from, Java.to
    const ArrayList = Java.type('java.util.ArrayList');
    const list = new ArrayList();
    list.add('Alpha');
    list.add('Beta');
    list.add('Gamma');
    expect(list.size()).toBe(3);
    expect(list.get(1)).toBe('Beta');

    // Java.from: converts Java collection to JavaScript native Array
    const jsArr = Java.from(list);
    expect(Array.isArray(jsArr)).toBe(true);
    expect(jsArr).toEqual(['Alpha', 'Beta', 'Gamma']);

    // Java.to: converts JavaScript Array to Java ArrayList
    const javaList = Java.to(['Item1', 'Item2'], 'java.util.ArrayList');
    expect(javaList.size()).toBe(2);
    expect(javaList.get(0)).toBe('Item1');
    expect(javaList.get(1)).toBe('Item2');

    // String constructor matching
    const StringCls = Java.type('java.lang.String');
    const strObj = new StringCls('Custom String');
    expect(strObj.toString()).toBe('Custom String');

    // 11. Class object reflection & superclass chaining: ArrayList.class.getSuperclass()
    const superRawClass = ArrayList.class.getSuperclassSync();
    expect(superRawClass).toBeDefined();
    expect(superRawClass!.getName()).toBe('java.util.AbstractList');
    expect(superRawClass!.getSimpleName()).toBe('AbstractList');

    // Java.type from Class.getName() or directly from Class object
    const SuperType = Java.type(superRawClass!.getName());
    expect(SuperType.name).toBe('java.util.AbstractList');

    const SuperTypeDirect = Java.type(superRawClass!);
    expect(SuperTypeDirect.name).toBe('java.util.AbstractList');

    // Convenient shortcut: ArrayList.getSuperclass() directly returns JavaClassProxy
    const superProxy = ArrayList.getSuperclass();
    expect(superProxy.name).toBe('java.util.AbstractList');

    // 12. .class.toString() vs ClassProxy.toString()
    expect(ArrayList.class.toString()).toBe('class java.util.ArrayList');
    expect(ArrayList.toString()).toBe('[JavaClass java.util.ArrayList]');
  }, 120000);

  test('Async Java proxy: await static & instance access seamlessly', async () => {
    proc = spawnJavaDummyProcess();
    host = await createAccessor(proc.pid);

    // Async Java Context
    const Java = await getJava(host);
    expect(Java).toBeDefined();

    const Idle = await Java.typeAsync('Idle');
    expect(Idle.name).toBe('Idle');

    // Read static field asynchronously
    expect(await Idle.intValue).toBe(42);

    // Call static method asynchronously
    expect(await Idle.add(100, 200)).toBe(300);

    // Instantiate object asynchronously
    const player = await new Idle('Alex', 1000);
    expect(await player.name).toBe('Alex');
    expect(await player.score).toBe(1000);

    // Call instance method
    expect(await player.greet('Hello')).toBe('Hello, Alex!');
    expect(await player.increaseScore(250)).toBe(1250);
  }, 120000);

  test('Stealth thread mode supports full Java proxy operations', async () => {
    proc = spawnJavaDummyProcess();
    host = await createAccessor(proc.pid, { njava: 'stealth' });

    const Java = getJavaSync(host);
    const Idle = Java.type('Idle');

    expect(Idle.intValue).toBe(42);
    expect(Idle.add(20, 22)).toBe(42);

    const player = new Idle('StealthPlayer', 9999);
    expect(player.name).toBe('StealthPlayer');
    expect(player.greet('Hey')).toBe('Hey, StealthPlayer!');
  }, 120000);
});
