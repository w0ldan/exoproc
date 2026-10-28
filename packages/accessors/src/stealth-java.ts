import { Thread } from 'bun-winapi';
import { attachNJava } from 'bun-njava';
import { HostAccessor } from './middleware-accessor.js';
import { createAccessor, type AccessorOptions } from './accessors.js';

/**
 * Spawns an immortal, lightweight worker thread inside the target Java process
 * using pure standard Java runtime classes (without defining any custom classes),
 * and returns the new thread's OS `TID`.
 */
export async function spawnStealthWorkerThread(
  bootstrapHost: HostAccessor,
): Promise<{ osTid: number; javaThreadId?: bigint }> {
  const pid = bootstrapHost.processId;
  const beforeThreads = new Set(Thread.getThreads(pid).map((t) => t.tid));

  const njava = await attachNJava(bootstrapHost);
  const reflection = await njava.getReflection();
  const functions = await njava.getFunctions();

  // 1. Obtain Executors.defaultThreadFactory()
  const executorsClass = await reflection.getClass(
    'java.util.concurrent.Executors',
  );
  const dtfMethod = await executorsClass.getMethod('defaultThreadFactory');
  const threadFactory = await dtfMethod.call(0n);

  // 2. Create single-thread scheduled executor: Executors.newSingleThreadScheduledExecutor(threadFactory)
  const allExecMethods = await reflection.getAllReflectedMethods(
    executorsClass.classObj,
  );
  const newPoolMethod =
    allExecMethods.find(
      (m: any) =>
        m.name === 'newSingleThreadScheduledExecutor' &&
        m.paramTypes.length === 1,
    ) ??
    allExecMethods.find(
      (m: any) => m.name === 'newSingleThreadScheduledExecutor',
    );
  const pool =
    newPoolMethod?.paramTypes.length === 1
      ? await newPoolMethod.call(0n, threadFactory as bigint)
      : await newPoolMethod!.call(0n);

  // 3. Create a lightweight Runnable via java.lang.reflect.Proxy + EventHandler
  const cdlClass = await reflection.getClass(
    'java.util.concurrent.CountDownLatch',
  );
  const cdlCtor = await reflection.findConstructor(
    cdlClass.classObj,
    (p: readonly string[]) => p.length === 1 && p[0] === 'int',
  );
  const cdlInstance = await reflection.construct(cdlCtor!, [0]);

  const eventHandlerClass = await reflection.getClass(
    'java.beans.EventHandler',
  );
  const ehCtor = await reflection.findConstructor(
    eventHandlerClass.classObj,
    (p: readonly string[]) =>
      p.length === 4 &&
      p[0] === 'java.lang.Object' &&
      p[1] === 'java.lang.String' &&
      p[2] === 'java.lang.String' &&
      p[3] === 'java.lang.String',
  );
  const handler = await reflection.construct(ehCtor!, [
    cdlInstance,
    'countDown',
    0n,
    'run',
  ]);

  const proxyClass = await reflection.getClass('java.lang.reflect.Proxy');
  const newProxyInstanceMethod = await proxyClass.getMethod('newProxyInstance');
  const classLoaderClass = await reflection.getClass('java.lang.ClassLoader');
  const getSysLoaderMethod = await classLoaderClass.getMethod(
    'getSystemClassLoader',
  );
  const sysLoader = (await getSysLoaderMethod.call(0n)) as bigint;

  const classClass = await reflection.getClass('java.lang.Class');
  const runnableClass = await reflection.getClass('java.lang.Runnable');
  const interfacesArray = BigInt(
    await functions.NewObjectArray(
      1,
      classClass.classObj,
      runnableClass.classObj,
    ),
  );
  const runnable = await newProxyInstanceMethod.invokeRaw(0n, [
    sysLoader,
    interfacesArray,
    handler,
  ]);

  // 4. TimeUnit.MILLISECONDS
  const timeUnitClass = await reflection.getClass(
    'java.util.concurrent.TimeUnit',
  );
  const msField = await timeUnitClass.getField('MILLISECONDS');
  const msUnit = await msField.get();

  // 5. pool.scheduleWithFixedDelay(runnable, 0, 50, TimeUnit.MILLISECONDS)
  const poolClass = await reflection.getClass(
    'java.util.concurrent.ScheduledExecutorService',
  );
  const scheduleMethod = await poolClass.getMethod('scheduleWithFixedDelay');
  await scheduleMethod.invokeRaw(pool as bigint, [
    runnable,
    0n,
    50n,
    msUnit as bigint,
  ]);

  // 6. Detect newly spawned thread ID
  const spawnDeadline = Date.now() + 5000;
  let newTid: number | undefined;
  while (Date.now() < spawnDeadline && !newTid) {
    const afterThreads = Thread.getThreads(pid);
    const found = afterThreads.find((t) => !beforeThreads.has(t.tid));
    if (found) {
      newTid = found.tid;
      break;
    }
    await Bun.sleep(20);
  }

  if (!newTid) {
    throw new Error(
      'spawnStealthWorkerThread: spawned worker thread did not appear in target process thread list',
    );
  }

  return { osTid: newTid };
}

/**
 * Performs a stealth attachment to a target Java process by:
 * 1. Attaching a bootstrap accessor to the process with `njava: true`.
 * 2. Spawning a dedicated, immortal worker daemon thread in the target JVM without defining any new classes.
 * 3. Detecting the newly spawned worker thread's OS `TID`.
 * 4. Closing the bootstrap accessor.
 * 5. Returning an accessor attached directly and exclusively to the dedicated worker thread.
 */
export async function createStealthJavaAccessor(
  pid: number,
  options: AccessorOptions = {},
): Promise<HostAccessor> {
  const { njava: _njavaOpt, ...passThroughOptions } = options;

  // 1. Create bootstrap accessor with njava enabled
  const bootstrapHost = await createAccessor(pid, {
    ...passThroughOptions,
    njava: true,
  });

  try {
    // 2. Spawn dedicated worker thread in Java without class definition
    const { osTid: workerTid } = await spawnStealthWorkerThread(bootstrapHost);

    // 3. Deinitialize and release bootstrap host thread back to normal execution
    await bootstrapHost.deinit();

    // 4. Return accessor directly attached to the dedicated worker thread
    return await createAccessor(workerTid, {
      ...passThroughOptions,
      idType: 'thread',
      njava: true,
    });
  } catch (err) {
    await bootstrapHost.deinit().catch(() => {});
    throw err;
  }
}
