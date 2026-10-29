import { JavaClassBuilder } from 'exoproc-jjit';

/**
 * Generates a unique build identifier for a specific agent compilation.
 */
export function generateBuildId(): string {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const timeStr = Math.floor(Date.now() / 1000).toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `b_${dateStr}_${timeStr}_${rand}`;
}

export interface BuildExoprocOptions {
  buildId?: string;
  pipePath?: string;
}

/**
 * Builds the consolidated Exoproc Java agent class using the fluent JavaClassBuilder DSL.
 * Connects outward as a Named Pipe client (`\\.\pipe\exoproc_*`) with zero open TCP ports
 * and zero inner classes so single-class in-memory `defineClass` injection works directly.
 */
export function buildExoprocClass(
  options: BuildExoprocOptions = {},
): JavaClassBuilder {
  const buildId = options.buildId ?? generateBuildId();
  const pipePath = options.pipePath ?? '\\\\.\\pipe\\exoproc';
  const cls = new JavaClassBuilder('Exoproc');

  cls
    .package('org.exoproc.njava.agent.utils')
    .public()
    .extends('ClassLoader')
    .implements(
      'java.lang.Runnable',
      'java.util.concurrent.Callable<Object>',
      'java.util.concurrent.ThreadFactory',
    )
    .import('java.io.*')
    .import('java.lang.instrument.Instrumentation')
    .import('java.lang.management.ManagementFactory')
    .import('java.lang.reflect.*')
    .import('java.nio.charset.StandardCharsets')
    .import('java.util.*')
    .import('java.util.concurrent.*')
    .import('java.util.concurrent.atomic.AtomicLong')

    // =========================================================================
    // Fields
    // =========================================================================

    .field('BUILD_ID', 'String')
    .public()
    .static()
    .final()
    .initialValue(JSON.stringify(buildId))

    .field('DEFAULT_PIPE', 'String')
    .public()
    .static()
    .final()
    .initialValue(JSON.stringify(pipePath))

    .field('instance', 'Exoproc')
    .private()
    .static()
    .volatile()
    .initialValue('null')

    .field('connected', 'boolean')
    .private()
    .static()
    .volatile()
    .initialValue('false')

    .field('targetLoader', 'ClassLoader')
    .private()
    .static()
    .volatile()
    .initialValue('null')

    .field('instrumentation', 'Instrumentation')
    .private()
    .static()
    .volatile()
    .initialValue('null')

    .field('activePipe', 'String')
    .private()
    .static()
    .volatile()
    .initialValue('DEFAULT_PIPE')

    .field('activeClientId', 'String')
    .private()
    .static()
    .volatile()
    .initialValue('null')

    .field('definedClasses', 'ConcurrentHashMap<String, Class<?>>')
    .private()
    .static()
    .final()
    .initialValue('new ConcurrentHashMap<String, Class<?>>()')

    .field('shuttingDown', 'boolean')
    .private()
    .static()
    .volatile()
    .initialValue('false')

    .field('s2cInput', 'InputStream')
    .private()
    .static()
    .volatile()
    .initialValue('null')

    .field('c2sOutput', 'OutputStream')
    .private()
    .static()
    .volatile()
    .initialValue('null')

    .field('s2cResource', 'Object')
    .private()
    .static()
    .volatile()
    .initialValue('null')

    .field('c2sResource', 'Object')
    .private()
    .static()
    .volatile()
    .initialValue('null')

    .field('txLock', 'Object')
    .private()
    .static()
    .final()
    .initialValue('new Object()')

    .field('rpcExecutor', 'ExecutorService')
    .private()
    .static()
    .volatile()
    .initialValue('null')

    // Reflection & Object Registries
    .field('nextId', 'AtomicLong')
    .private()
    .final()
    .initialValue('new AtomicLong(1)')

    .field('nextHandle', 'AtomicLong')
    .private()
    .final()
    .initialValue('new AtomicLong(1)')

    .field('classRegistry', 'ConcurrentHashMap<Long, Class<?>>')
    .private()
    .final()
    .initialValue('new ConcurrentHashMap<Long, Class<?>>()')

    .field('classNameToId', 'ConcurrentHashMap<String, Long>')
    .private()
    .final()
    .initialValue('new ConcurrentHashMap<String, Long>()')

    .field('methodRegistry', 'ConcurrentHashMap<Long, Method>')
    .private()
    .final()
    .initialValue('new ConcurrentHashMap<Long, Method>()')

    .field('fieldRegistry', 'ConcurrentHashMap<Long, Field>')
    .private()
    .final()
    .initialValue('new ConcurrentHashMap<Long, Field>()')

    .field('ctorRegistry', 'ConcurrentHashMap<Long, Constructor<?>>')
    .private()
    .final()
    .initialValue('new ConcurrentHashMap<Long, Constructor<?>>()')

    .field('objectRegistry', 'ConcurrentHashMap<Long, Object>')
    .private()
    .final()
    .initialValue('new ConcurrentHashMap<Long, Object>()')

    // SAM Callback Pending Latches
    .field('nextInvocationId', 'AtomicLong')
    .private()
    .static()
    .final()
    .initialValue('new AtomicLong(1)')

    .field('pendingInvocations', 'ConcurrentHashMap<Long, Map<String, Object>>')
    .private()
    .static()
    .final()
    .initialValue('new ConcurrentHashMap<Long, Map<String, Object>>()')

    .field('defaultTimeoutSeconds', 'long')
    .private()
    .static()
    .volatile()
    .initialValue('30')

    // Multi-purpose task fields (zero inner classes)
    .field('rpcReqId', 'int')
    .private()
    .initialValue('0')

    .field('rpcPayload', 'byte[]')
    .private()
    .initialValue('null')

    .field('execMethod', 'Method')
    .private()
    .initialValue('null')

    .field('execTarget', 'Object')
    .private()
    .initialValue('null')

    .field('execArgs', 'Object[]')
    .private()
    .initialValue('null')

    .field('execLatch', 'CountDownLatch')
    .private()
    .initialValue('null')

    .field('execBox', 'Object[]')
    .private()
    .initialValue('null')

    .field('execErr', 'Throwable[]')
    .private()
    .initialValue('null')

    // =========================================================================
    // Constructors
    // =========================================================================

    .constructorDef(
      [],
      'super(targetLoader != null ? targetLoader : Exoproc.class.getClassLoader());',
    )

    .constructorDef(
      [
        { name: 'reqId', type: 'int' },
        { name: 'payload', type: 'byte[]' },
      ],
      `super(null);
this.rpcReqId = reqId;
this.rpcPayload = payload;`,
    )

    .constructorDef(
      [
        { name: 'm', type: 'Method' },
        { name: 'target', type: 'Object' },
        { name: 'args', type: 'Object[]' },
        { name: 'latch', type: 'CountDownLatch' },
        { name: 'box', type: 'Object[]' },
        { name: 'err', type: 'Throwable[]' },
      ],
      `super(null);
this.execMethod = m;
this.execTarget = target;
this.execArgs = args;
this.execLatch = latch;
this.execBox = box;
this.execErr = err;`,
    )

    // =========================================================================
    // Entrypoints: JVM Startup, Dynamic Attach, URLClassLoader, In-Memory
    // =========================================================================

    .method('premain', 'void')
    .public()
    .static()
    .params([
      { name: 'agentArgs', type: 'String' },
      { name: 'inst', type: 'Instrumentation' },
    ])
    .body('init(agentArgs, null, inst, null);')

    .method('agentmain', 'void')
    .public()
    .static()
    .params([
      { name: 'agentArgs', type: 'String' },
      { name: 'inst', type: 'Instrumentation' },
    ])
    .body('init(agentArgs, null, inst, null);')

    .method('start', 'void')
    .public()
    .static()
    .body('start(null);')

    .method('start', 'void')
    .public()
    .static()
    .params([{ name: 'pipePath', type: 'String' }])
    .body(
      'init(null, Thread.currentThread().getContextClassLoader(), null, pipePath);',
    )

    .method('start', 'void')
    .public()
    .static()
    .params([
      { name: 'pipePath', type: 'String' },
      { name: 'classLoader', type: 'ClassLoader' },
    ])
    .body('init(null, classLoader, null, pipePath);')

    .method('init', 'void')
    .public()
    .static()
    .synchronized()
    .params([
      { name: 'agentArgs', type: 'String' },
      { name: 'classLoader', type: 'ClassLoader' },
      { name: 'inst', type: 'Instrumentation' },
      { name: 'explicitPipe', type: 'String' },
    ])
    .body(
      `if (connected && !shuttingDown) {
    return;
}

String resolvedPipe = (explicitPipe != null && !explicitPipe.trim().isEmpty()) ? explicitPipe.trim() : null;

if (resolvedPipe == null && agentArgs != null && !agentArgs.trim().isEmpty()) {
    String trimmedArgs = agentArgs.trim();
    if (!trimmedArgs.contains("=")) {
        resolvedPipe = trimmedArgs;
    } else {
        for (String part : trimmedArgs.split("[,;]")) {
            int eq = part.indexOf('=');
            if (eq > 0) {
                String k = part.substring(0, eq).trim();
                String v = part.substring(eq + 1).trim();
                if ("pipe".equalsIgnoreCase(k) && !v.isEmpty()) {
                    resolvedPipe = v;
                }
            }
        }
    }
}

if (resolvedPipe == null) {
    String sysPipe = System.getProperty("exoproc.pipe");
    if (sysPipe == null || sysPipe.trim().isEmpty()) {
        sysPipe = System.getenv("EXOPROC_PIPE");
    }
    if (sysPipe != null && !sysPipe.trim().isEmpty()) {
        resolvedPipe = sysPipe.trim();
    }
}

if (resolvedPipe == null) {
    resolvedPipe = DEFAULT_PIPE;
}

shuttingDown = false;
activePipe = resolvedPipe;
activeClientId = "java_" + getPid() + "_" + BUILD_ID + "_" + (System.nanoTime() & 0xfffffL);
targetLoader = classLoader != null ? classLoader : Thread.currentThread().getContextClassLoader();
if (inst != null) instrumentation = inst;
instance = new Exoproc();
rpcExecutor = Executors.newCachedThreadPool(instance);

Thread readerThread = new Thread(instance, "Exoproc-PipeReader");
readerThread.setDaemon(true);
readerThread.start();`,
    )

    .method('newThread', 'Thread')
    .public()
    .annotation('@Override')
    .params([{ name: 'r', type: 'Runnable' }])
    .body(
      `Thread t = new Thread(r, "Exoproc-Worker");
t.setDaemon(true);
return t;`,
    )

    .method('isRunning', 'boolean')
    .public()
    .static()
    .body('return connected && !shuttingDown;')

    .method('getPipePath', 'String')
    .public()
    .static()
    .body('return activePipe;')

    .method('getInstance', 'Exoproc')
    .public()
    .static()
    .body('return instance;')

    .method('getBuildId', 'String')
    .public()
    .static()
    .body('return BUILD_ID;')

    // =========================================================================
    // Runnable & Callable Implementation (Executor task, RPC worker, Pipe reader)
    // =========================================================================

    .method('run', 'void')
    .public()
    .annotation('@Override')
    .body(
      `if (execLatch != null) {
    try {
        if (execMethod != null) {
            execBox[0] = execMethod.invoke(execTarget, execArgs);
        }
    } catch (InvocationTargetException ite) {
        execErr[0] = ite.getCause() != null ? ite.getCause() : ite;
    } catch (Throwable t) {
        execErr[0] = t;
    } finally {
        execLatch.countDown();
    }
    return;
}

if (rpcPayload != null) {
    Exoproc targetInst = instance != null ? instance : this;
    targetInst.processRpcFrame(rpcReqId, rpcPayload);
    return;
}

try {
    Object[] s2c = openChannel(activePipe, 10000L);
    InputStream in1 = (InputStream) s2c[0];
    OutputStream out1 = (OutputStream) s2c[1];
    s2cResource = s2c[2];
    handshakeChannel(in1, out1, "s2c", 1);

    Object[] c2s = openChannel(activePipe, 10000L);
    InputStream in2 = (InputStream) c2s[0];
    OutputStream out2 = (OutputStream) c2s[1];
    c2sResource = c2s[2];
    handshakeChannel(in2, out2, "c2s", 2);

    s2cInput = in1;
    c2sOutput = out2;
    connected = true;

    byte[] hdr = new byte[9];
    while (!shuttingDown) {
        if (!readFully(in1, hdr, 9)) {
            break;
        }
        int len = (hdr[0] & 0xff) | ((hdr[1] & 0xff) << 8) | ((hdr[2] & 0xff) << 16) | ((hdr[3] & 0xff) << 24);
        int type = hdr[4] & 0xff;
        int reqId = (hdr[5] & 0xff) | ((hdr[6] & 0xff) << 8) | ((hdr[7] & 0xff) << 16) | ((hdr[8] & 0xff) << 24);
        byte[] body = len > 0 ? new byte[len] : new byte[0];
        if (len > 0 && !readFully(in1, body, len)) {
            break;
        }

        if (type == 0xfe) {
            sendFrame(0xff, reqId, body);
        } else if (type == 0x21) {
            handleCallbackResponseFrame(body);
        } else if (type == 0x10) {
            ExecutorService pool = rpcExecutor;
            if (pool != null && !pool.isShutdown()) {
                pool.submit((Runnable) new Exoproc(reqId, body));
            } else {
                processRpcFrame(reqId, body);
            }
        }
    }
} catch (Throwable t) {
    if (!shuttingDown) {
        System.err.println("[Exoproc] Pipe agent stopped: " + t.getMessage());
    }
} finally {
    connected = false;
    closeResource(s2cResource);
    closeResource(c2sResource);
    s2cResource = null;
    c2sResource = null;
    s2cInput = null;
    c2sOutput = null;
}`,
    )

    .method('call', 'Object')
    .public()
    .annotation('@Override')
    .throws('Exception')
    .body(
      `run();
if (execErr != null && execErr[0] != null) {
    throw (execErr[0] instanceof Exception) ? (Exception) execErr[0] : new RuntimeException(execErr[0]);
}
return execBox != null ? execBox[0] : null;`,
    )

    // =========================================================================
    // Central RPC Frame Dispatcher
    // =========================================================================

    .method('processRpcFrame', 'void')
    .public()
    .params([
      { name: 'reqId', type: 'int' },
      { name: 'payloadBytes', type: 'byte[]' },
    ])
    .body(
      `Map<String, Object> res;
boolean triggerShutdown = false;
try {
    String jsonText = new String(payloadBytes, StandardCharsets.UTF_8).trim();
    Object parsed = parseJson(jsonText);
    @SuppressWarnings("unchecked")
    Map<String, Object> req = (parsed instanceof Map) ? (Map<String, Object>) parsed : new LinkedHashMap<String, Object>();
    String action = req.get("action") != null ? String.valueOf(req.get("action")) : "";

    if (action.startsWith("/")) {
        action = action.substring(1);
    }

    if ("status".equals(action)) {
        res = new LinkedHashMap<String, Object>();
        res.put("success", true);
        res.put("alive", true);
        res.put("buildId", BUILD_ID);
        res.put("pipePath", activePipe);
        res.put("pid", getPid());
        res.put("targetName", getTargetName());
        res.put("uptime", ManagementFactory.getRuntimeMXBean().getUptime());
    } else if ("buildId".equals(action) || "build".equals(action)) {
        res = new LinkedHashMap<String, Object>();
        res.put("success", true);
        res.put("buildId", BUILD_ID);
    } else if ("classes".equals(action)) {
        res = listLoadedClasses();
    } else if ("eval".equals(action)) {
        res = evaluateSnippet(req);
    } else if ("reflection/class".equals(action)) {
        String className = req.get("name") != null ? String.valueOf(req.get("name")) : null;
        if (className == null) {
            res = new LinkedHashMap<String, Object>();
            res.put("success", false);
            res.put("error", "Missing 'name' parameter");
        } else {
            res = inspectClass(className);
        }
    } else if ("reflection/invoke".equals(action)) {
        res = invokeMethod(req);
    } else if ("reflection/field/get".equals(action)) {
        res = getField(req);
    } else if ("reflection/field/set".equals(action)) {
        res = setField(req);
    } else if ("reflection/construct".equals(action)) {
        res = constructInstance(req);
    } else if ("reflection/object/class".equals(action)) {
        long handle = req.get("handle") != null ? ((Number) req.get("handle")).longValue() : 0L;
        res = getObjectClass(handle);
    } else if ("reflection/object/string".equals(action)) {
        long handle = req.get("handle") != null ? ((Number) req.get("handle")).longValue() : 0L;
        res = getObjectString(handle);
    } else if ("reflection/release".equals(action)) {
        List<?> handles = (req.get("handles") instanceof List) ? (List<?>) req.get("handles") : Collections.emptyList();
        res = releaseHandles(handles);
    } else if ("reflection/defineClass".equals(action)) {
        res = handleDefineClass(req);
    } else if ("shutdown".equals(action)) {
        res = new LinkedHashMap<String, Object>();
        res.put("success", true);
        triggerShutdown = true;
    } else {
        res = new LinkedHashMap<String, Object>();
        res.put("success", false);
        res.put("error", "Unknown RPC action: " + action);
    }
} catch (Throwable t) {
    res = new LinkedHashMap<String, Object>();
    res.put("success", false);
    res.put("error", t.getMessage() != null ? t.getMessage() : t.toString());
}

try {
    byte[] outBytes = stringifyJson(res).getBytes(StandardCharsets.UTF_8);
    sendFrame(0x11, reqId, outBytes);
} catch (IOException ignored) {}

if (triggerShutdown) {
    shutdown();
}`,
    )

    .method('listLoadedClasses', 'Map<String, Object>')
    .public()
    .body(
      `Map<String, Object> res = new LinkedHashMap<String, Object>();
List<String> names = new ArrayList<String>();
if (instrumentation != null) {
    for (Class<?> c : instrumentation.getAllLoadedClasses()) {
        if (c != null && c.getName() != null) names.add(c.getName());
    }
} else {
    names.addAll(classNameToId.keySet());
}
res.put("success", true);
res.put("classes", names);
return res;`,
    )

    .method('evaluateSnippet', 'Map<String, Object>')
    .public()
    .params([{ name: 'req', type: 'Map<String, Object>' }])
    .body(
      `Map<String, Object> res = new LinkedHashMap<String, Object>();
String code = req.get("code") != null ? String.valueOf(req.get("code")) : "";
res.put("logs", Collections.emptyList());
try {
    Class<?> semCls = Class.forName("javax.script.ScriptEngineManager");
    Object manager = semCls.getDeclaredConstructor().newInstance();
    Method getByName = semCls.getMethod("getEngineByName", String.class);
    Object engine = getByName.invoke(manager, "nashorn");
    if (engine == null) engine = getByName.invoke(manager, "JavaScript");
    if (engine == null) engine = getByName.invoke(manager, "js");
    if (engine != null) {
        Class<?> seCls = Class.forName("javax.script.ScriptEngine");
        if (req.get("globals") instanceof Map) {
            Method putMethod = seCls.getMethod("put", String.class, Object.class);
            Map<?, ?> globals = (Map<?, ?>) req.get("globals");
            for (Map.Entry<?, ?> entry : globals.entrySet()) {
                putMethod.invoke(engine, String.valueOf(entry.getKey()), entry.getValue());
            }
        }
        Method evalMethod = seCls.getMethod("eval", String.class);
        Object val = evalMethod.invoke(engine, code);
        res.put("success", true);
        res.put("result", val != null ? String.valueOf(val) : null);
        return res;
    }
} catch (InvocationTargetException ite) {
    Throwable cause = ite.getCause() != null ? ite.getCause() : ite;
    res.put("success", false);
    res.put("error", cause.getMessage() != null ? cause.getMessage() : cause.toString());
    return res;
} catch (Throwable ignored) {}

try {
    Class<?> jshellCls = Class.forName("jdk.jshell.JShell");
    Object shell = jshellCls.getMethod("create").invoke(null);
    try {
        List<?> events = (List<?>) jshellCls.getMethod("eval", String.class).invoke(shell, code);
        String lastVal = null;
        if (events != null && !events.isEmpty()) {
            Object evt = events.get(events.size() - 1);
            Object valObj = evt.getClass().getMethod("value").invoke(evt);
            if (valObj != null) {
                lastVal = String.valueOf(valObj);
                if (lastVal.length() >= 2 && lastVal.startsWith("\\"") && lastVal.endsWith("\\"")) {
                    lastVal = lastVal.substring(1, lastVal.length() - 1);
                }
            }
        }
        res.put("success", true);
        res.put("result", lastVal);
        return res;
    } finally {
        try { jshellCls.getMethod("close").invoke(shell); } catch (Throwable ignored) {}
    }
} catch (Throwable t) {
    res.put("success", false);
    res.put("error", "No script evaluation engine available: " + (t.getMessage() != null ? t.getMessage() : t.toString()));
    return res;
}`,
    )

    // =========================================================================
    // Reflection Inspection & Remote Invocation
    // =========================================================================

    .method('defineOwnedClass', 'Class<?>')
    .public()
    .synchronized()
    .params([
      { name: 'name', type: 'String' },
      { name: 'bytes', type: 'byte[]' },
    ])
    .body(
      `if (name != null) {
    Class<?> existing = definedClasses.get(name);
    if (existing != null) return existing;
}
Class<?> cls = super.defineClass(name, bytes, 0, bytes.length);
definedClasses.put(cls.getName(), cls);
if (name != null) definedClasses.put(name, cls);
return cls;`,
    )

    .method('defineClassBytes', 'Class<?>')
    .public()
    .static()
    .params([
      { name: 'name', type: 'String' },
      { name: 'bytes', type: 'byte[]' },
    ])
    .body(
      `Exoproc loader = instance != null ? instance : new Exoproc();
return loader.defineOwnedClass(name, bytes);`,
    )

    .method('defineClass', 'Class<?>')
    .public()
    .static()
    .params([
      { name: 'name', type: 'String' },
      { name: 'byteList', type: 'List<?>' },
    ])
    .body(
      `byte[] bytes = new byte[byteList != null ? byteList.size() : 0];
if (byteList != null) {
    for (int i = 0; i < byteList.size(); i++) {
        Object item = byteList.get(i);
        bytes[i] = item instanceof Number ? ((Number) item).byteValue() : 0;
    }
}
return defineClassBytes(name, bytes);`,
    )

    .method('handleDefineClass', 'Map<String, Object>')
    .public()
    .params([{ name: 'req', type: 'Map<String, Object>' }])
    .body(
      `Map<String, Object> res = new LinkedHashMap<String, Object>();
try {
    String name = req.get("name") != null ? String.valueOf(req.get("name")) : null;
    String b64 = req.get("bytecode") != null ? String.valueOf(req.get("bytecode")) : null;
    if (b64 == null || b64.isEmpty()) {
        res.put("success", false);
        res.put("error", "Missing 'bytecode' base64 parameter");
        return res;
    }
    byte[] bytes = Base64.getDecoder().decode(b64);
    Class<?> cls = defineClassBytes(name, bytes);
    long classId = getOrCreateClassId(cls);
    res.put("success", true);
    res.put("classId", classId);
    res.put("name", cls.getName());
    return res;
} catch (Throwable t) {
    res.put("success", false);
    res.put("error", t.getMessage() != null ? t.getMessage() : t.toString());
    return res;
}`,
    )

    .method('findTargetClass', 'Class<?>')
    .public()
    .throws('ClassNotFoundException')
    .params([{ name: 'name', type: 'String' }])
    .body(
      `if (name == null || name.isEmpty()) throw new ClassNotFoundException("Empty class name");
if ("int".equals(name)) return int.class;
if ("long".equals(name)) return long.class;
if ("boolean".equals(name)) return boolean.class;
if ("byte".equals(name)) return byte.class;
if ("short".equals(name)) return short.class;
if ("char".equals(name)) return char.class;
if ("float".equals(name)) return float.class;
if ("double".equals(name)) return double.class;
if ("void".equals(name)) return void.class;
if ("Exoproc".equals(name) || "org.exoproc.njava.agent.utils.Exoproc".equals(name) || "org.exoproc.njava.agent.NJavaAgent".equals(name)) {
    return Exoproc.class;
}
Class<?> dyn = definedClasses.get(name);
if (dyn != null) return dyn;

try {
    return Class.forName(name, false, targetLoader != null ? targetLoader : Exoproc.class.getClassLoader());
} catch (ClassNotFoundException e) {
    ClassLoader ctx = Thread.currentThread().getContextClassLoader();
    if (ctx != null && ctx != targetLoader) {
        try { return Class.forName(name, false, ctx); } catch (ClassNotFoundException ignored) {}
    }
    return Class.forName(name);
}`,
    )

    .method('getOrCreateClassId', 'long')
    .public()
    .synchronized()
    .params([{ name: 'cls', type: 'Class<?>' }])
    .body(
      `Long existing = classNameToId.get(cls.getName());
if (existing != null) return existing;
long id = nextId.getAndIncrement();
classRegistry.put(id, cls);
classNameToId.put(cls.getName(), id);
return id;`,
    )

    .method('inspectClass', 'Map<String, Object>')
    .public()
    .params([{ name: 'className', type: 'String' }])
    .body(
      `Map<String, Object> res = new LinkedHashMap<String, Object>();
try {
    Class<?> cls = findTargetClass(className);
    long classId = getOrCreateClassId(cls);

    res.put("success", true);
    res.put("classId", classId);
    res.put("name", cls.getName());
    res.put("simpleName", cls.getSimpleName());
    res.put("isInterface", cls.isInterface());
    res.put("isArray", cls.isArray());
    res.put("isPrimitive", cls.isPrimitive());
    res.put("superclass", cls.getSuperclass() != null ? cls.getSuperclass().getName() : null);
    List<String> scChain = new ArrayList<String>();
    Class<?> scCur = cls.getSuperclass();
    while (scCur != null) {
        scChain.add(scCur.getName());
        scCur = scCur.getSuperclass();
    }
    res.put("superclassChain", scChain);

    List<Map<String, Object>> methodsList = new ArrayList<Map<String, Object>>();
    Set<String> seenSigs = new HashSet<String>();
    List<Method> allMethods = new ArrayList<Method>();
    Class<?> cur = cls;
    while (cur != null) {
        for (Method m : cur.getDeclaredMethods()) {
            if (!allMethods.contains(m)) allMethods.add(m);
        }
        cur = cur.getSuperclass();
    }
    for (Method m : cls.getMethods()) {
        if (!allMethods.contains(m)) allMethods.add(m);
    }

    for (Method m : allMethods) {
        try { m.setAccessible(true); } catch (Throwable ignored) {}
        List<String> paramTypes = new ArrayList<String>();
        for (Class<?> p : m.getParameterTypes()) paramTypes.add(p.getName());

        StringBuilder sigSb = new StringBuilder(m.getName()).append('(');
        for (int i = 0; i < paramTypes.size(); i++) {
            if (i > 0) sigSb.append(',');
            sigSb.append(paramTypes.get(i));
        }
        sigSb.append("):").append(m.getReturnType().getName());
        String sig = sigSb.toString();

        if (seenSigs.contains(sig)) continue;
        seenSigs.add(sig);

        long mId = nextId.getAndIncrement();
        methodRegistry.put(mId, m);

        Map<String, Object> mInfo = new LinkedHashMap<String, Object>();
        mInfo.put("id", mId);
        mInfo.put("name", m.getName());
        mInfo.put("returnType", m.getReturnType().getName());
        mInfo.put("params", paramTypes);
        mInfo.put("static", Modifier.isStatic(m.getModifiers()));
        mInfo.put("modifiers", m.getModifiers());
        methodsList.add(mInfo);
    }
    res.put("methods", methodsList);

    List<Map<String, Object>> fieldsList = new ArrayList<Map<String, Object>>();
    List<Field> allFields = new ArrayList<Field>();
    allFields.addAll(Arrays.asList(cls.getDeclaredFields()));
    for (Field f : cls.getFields()) {
        if (!allFields.contains(f)) allFields.add(f);
    }

    for (Field f : allFields) {
        try { f.setAccessible(true); } catch (Throwable ignored) {}
        long fId = nextId.getAndIncrement();
        fieldRegistry.put(fId, f);

        Map<String, Object> fInfo = new LinkedHashMap<String, Object>();
        fInfo.put("id", fId);
        fInfo.put("name", f.getName());
        fInfo.put("type", f.getType().getName());
        fInfo.put("static", Modifier.isStatic(f.getModifiers()));
        fInfo.put("modifiers", f.getModifiers());
        fieldsList.add(fInfo);
    }
    res.put("fields", fieldsList);

    List<Map<String, Object>> ctorsList = new ArrayList<Map<String, Object>>();
    for (Constructor<?> c : cls.getDeclaredConstructors()) {
        try { c.setAccessible(true); } catch (Throwable ignored) {}
        long cId = nextId.getAndIncrement();
        ctorRegistry.put(cId, c);

        List<String> paramTypes = new ArrayList<String>();
        for (Class<?> p : c.getParameterTypes()) paramTypes.add(p.getName());

        Map<String, Object> cInfo = new LinkedHashMap<String, Object>();
        cInfo.put("id", cId);
        cInfo.put("params", paramTypes);
        cInfo.put("modifiers", c.getModifiers());
        ctorsList.add(cInfo);
    }
    res.put("constructors", ctorsList);

    return res;
} catch (Throwable t) {
    res.put("success", false);
    res.put("error", t.getMessage() != null ? t.getMessage() : t.toString());
    return res;
}`,
    )

    .method('invokeMethod', 'Map<String, Object>')
    .public()
    .params([{ name: 'req', type: 'Map<String, Object>' }])
    .body(
      `Map<String, Object> res = new LinkedHashMap<String, Object>();
try {
    Long methodId = req.get("methodId") != null ? ((Number) req.get("methodId")).longValue() : null;
    Long targetHandle = req.get("targetHandle") != null ? ((Number) req.get("targetHandle")).longValue() : 0L;
    List<?> rawArgs = req.get("args") instanceof List ? (List<?>) req.get("args") : Collections.emptyList();

    Object executor = null;
    Long executorMethodId = null;
    if (req.get("executor") instanceof Map) {
        Map<?, ?> ex = (Map<?, ?>) req.get("executor");
        if (ex.get("handle") instanceof Number) {
            executor = objectRegistry.get(((Number) ex.get("handle")).longValue());
        }
        if (ex.get("methodId") instanceof Number) {
            executorMethodId = ((Number) ex.get("methodId")).longValue();
        }
    }

    Method method = null;
    if (methodId != null) {
        method = methodRegistry.get(methodId);
        if (method != null && !isMethodCompatible(method, rawArgs)) {
            Class<?> declCls = method.getDeclaringClass();
            String mName = method.getName();
            for (Method cand : declCls.getMethods()) {
                if (cand.getName().equals(mName) && isMethodCompatible(cand, rawArgs)) {
                    method = cand;
                    break;
                }
            }
        }
    }

    if (method == null) {
        String methodName = (String) req.get("methodName");
        Long classId = req.get("classId") != null ? ((Number) req.get("classId")).longValue() : null;
        Class<?> cls = classId != null ? classRegistry.get(classId) : null;
        if (cls == null && targetHandle != 0L) {
            Object target = objectRegistry.get(targetHandle);
            if (target != null) cls = target.getClass();
        }

        if (cls != null && methodName != null) {
            for (Method m : cls.getMethods()) {
                if (m.getName().equals(methodName) && isMethodCompatible(m, rawArgs)) {
                    method = m;
                    break;
                }
            }
            if (method == null) {
                for (Method m : cls.getDeclaredMethods()) {
                    if (m.getName().equals(methodName) && isMethodCompatible(m, rawArgs)) {
                        method = m;
                        break;
                    }
                }
            }
        }
    }

    if (method == null) {
        res.put("success", false);
        res.put("error", "Method not found: " + req);
        return res;
    }

    method.setAccessible(true);
    Object target = targetHandle != 0L ? objectRegistry.get(targetHandle) : null;
    Object[] args = convertArgs(method.getParameterTypes(), rawArgs);

    Object result;
    if (executor != null) {
        result = invokeOnExecutor(executor, executorMethodId, method, target, args);
    } else {
        result = method.invoke(target, args);
    }

    return serializeValue(result);
} catch (InvocationTargetException ite) {
    Throwable cause = ite.getCause() != null ? ite.getCause() : ite;
    res.put("success", false);
    res.put("error", cause.getMessage() != null ? cause.getMessage() : cause.toString());
    return res;
} catch (Throwable t) {
    res.put("success", false);
    res.put("error", t.getMessage() != null ? t.getMessage() : t.toString());
    return res;
}`,
    )

    .method('getField', 'Map<String, Object>')
    .public()
    .params([{ name: 'req', type: 'Map<String, Object>' }])
    .body(
      `Map<String, Object> res = new LinkedHashMap<String, Object>();
try {
    Long fieldId = req.get("fieldId") != null ? ((Number) req.get("fieldId")).longValue() : null;
    Long targetHandle = req.get("targetHandle") != null ? ((Number) req.get("targetHandle")).longValue() : 0L;
    String fieldName = (String) req.get("fieldName");

    Field field = fieldId != null ? fieldRegistry.get(fieldId) : null;
    if (field == null) {
        Long classId = req.get("classId") != null ? ((Number) req.get("classId")).longValue() : null;
        Class<?> cls = classId != null ? classRegistry.get(classId) : null;
        if (cls == null && targetHandle != 0L) {
            Object target = objectRegistry.get(targetHandle);
            if (target != null) cls = target.getClass();
        }

        if (cls != null && fieldName != null) {
            try {
                field = cls.getField(fieldName);
            } catch (NoSuchFieldException e) {
                field = cls.getDeclaredField(fieldName);
            }
        }
    }

    if (field == null) {
        res.put("success", false);
        res.put("error", "Field not found: " + req);
        return res;
    }

    field.setAccessible(true);
    Object target = targetHandle != 0L ? objectRegistry.get(targetHandle) : null;
    Object val = field.get(target);
    return serializeValue(val);
} catch (Throwable t) {
    res.put("success", false);
    res.put("error", t.getMessage() != null ? t.getMessage() : t.toString());
    return res;
}`,
    )

    .method('setField', 'Map<String, Object>')
    .public()
    .params([{ name: 'req', type: 'Map<String, Object>' }])
    .body(
      `Map<String, Object> res = new LinkedHashMap<String, Object>();
try {
    Long fieldId = req.get("fieldId") != null ? ((Number) req.get("fieldId")).longValue() : null;
    Long targetHandle = req.get("targetHandle") != null ? ((Number) req.get("targetHandle")).longValue() : 0L;
    String fieldName = (String) req.get("fieldName");
    Object rawValue = req.get("value");

    Field field = fieldId != null ? fieldRegistry.get(fieldId) : null;
    if (field == null) {
        Long classId = req.get("classId") != null ? ((Number) req.get("classId")).longValue() : null;
        Class<?> cls = classId != null ? classRegistry.get(classId) : null;
        if (cls == null && targetHandle != 0L) {
            Object target = objectRegistry.get(targetHandle);
            if (target != null) cls = target.getClass();
        }

        if (cls != null && fieldName != null) {
            try {
                field = cls.getField(fieldName);
            } catch (NoSuchFieldException e) {
                field = cls.getDeclaredField(fieldName);
            }
        }
    }

    if (field == null) {
        res.put("success", false);
        res.put("error", "Field not found: " + req);
        return res;
    }

    field.setAccessible(true);
    Object target = targetHandle != 0L ? objectRegistry.get(targetHandle) : null;
    Object convertedVal = convertArg(field.getType(), rawValue);
    field.set(target, convertedVal);

    res.put("success", true);
    return res;
} catch (Throwable t) {
    res.put("success", false);
    res.put("error", t.getMessage() != null ? t.getMessage() : t.toString());
    return res;
}`,
    )

    .method('constructInstance', 'Map<String, Object>')
    .public()
    .params([{ name: 'req', type: 'Map<String, Object>' }])
    .body(
      `Map<String, Object> res = new LinkedHashMap<String, Object>();
try {
    Long ctorId = req.get("ctorId") != null ? ((Number) req.get("ctorId")).longValue() : null;
    Long classId = req.get("classId") != null ? ((Number) req.get("classId")).longValue() : null;
    List<?> rawArgs = req.get("args") instanceof List ? (List<?>) req.get("args") : Collections.emptyList();

    Constructor<?> ctor = ctorId != null ? ctorRegistry.get(ctorId) : null;
    if (ctor == null && classId != null) {
        Class<?> cls = classRegistry.get(classId);
        if (cls != null) {
            for (Constructor<?> c : cls.getDeclaredConstructors()) {
                if (c.getParameterTypes().length == rawArgs.size()) {
                    ctor = c;
                    break;
                }
            }
        }
    }

    if (ctor == null) {
        res.put("success", false);
        res.put("error", "Constructor not found: " + req);
        return res;
    }

    ctor.setAccessible(true);
    Object[] args = convertArgs(ctor.getParameterTypes(), rawArgs);
    Object obj = ctor.newInstance(args);
    return serializeValue(obj);
} catch (Throwable t) {
    res.put("success", false);
    res.put("error", t.getMessage() != null ? t.getMessage() : t.toString());
    return res;
}`,
    )

    .method('getObjectClass', 'Map<String, Object>')
    .public()
    .params([{ name: 'targetHandle', type: 'long' }])
    .body(
      `Map<String, Object> res = new LinkedHashMap<String, Object>();
Object target = objectRegistry.get(targetHandle);
if (target == null) {
    res.put("success", false);
    res.put("error", "Object handle not found: " + targetHandle);
    return res;
}
Class<?> cls = target.getClass();
long classId = getOrCreateClassId(cls);
res.put("success", true);
res.put("classId", classId);
res.put("name", cls.getName());
return res;`,
    )

    .method('getObjectString', 'Map<String, Object>')
    .public()
    .params([{ name: 'targetHandle', type: 'long' }])
    .body(
      `Map<String, Object> res = new LinkedHashMap<String, Object>();
Object target = objectRegistry.get(targetHandle);
if (target == null) {
    res.put("success", false);
    res.put("error", "Object handle not found: " + targetHandle);
    return res;
}
res.put("success", true);
res.put("value", String.valueOf(target));
return res;`,
    )

    .method('releaseHandles', 'Map<String, Object>')
    .public()
    .params([{ name: 'handles', type: 'List<?>' }])
    .body(
      `Map<String, Object> res = new LinkedHashMap<String, Object>();
if (handles != null) {
    for (Object h : handles) {
        if (h instanceof Number) {
            objectRegistry.remove(((Number) h).longValue());
        }
    }
}
res.put("success", true);
return res;`,
    )

    .method('serializeValue', 'Map<String, Object>')
    .private()
    .params([{ name: 'val', type: 'Object' }])
    .body(
      `Map<String, Object> res = new LinkedHashMap<String, Object>();
res.put("success", true);

if (val == null) {
    res.put("isObject", false);
    res.put("value", null);
    return res;
}

if (val instanceof Boolean || val instanceof Number || val instanceof Character) {
    res.put("isObject", false);
    res.put("value", val);
    return res;
}

if (val instanceof String) {
    res.put("isObject", false);
    res.put("value", val);
    return res;
}

long handle = nextHandle.getAndIncrement();
objectRegistry.put(handle, val);
res.put("isObject", true);
res.put("handle", handle);
res.put("className", val.getClass().getName());
res.put("toString", String.valueOf(val));
return res;`,
    )

    .method('isMethodCompatible', 'boolean')
    .private()
    .params([
      { name: 'm', type: 'Method' },
      { name: 'rawArgs', type: 'List<?>' },
    ])
    .body(
      `Class<?>[] paramTypes = m.getParameterTypes();
if (paramTypes.length != rawArgs.size()) return false;
for (int i = 0; i < paramTypes.length; i++) {
    Object raw = rawArgs.get(i);
    if (raw == null) {
        if (paramTypes[i].isPrimitive()) return false;
        continue;
    }
    if (raw instanceof Map) {
        Map<?, ?> map = (Map<?, ?>) raw;
        if (map.containsKey("handle") || map.containsKey("$handle")) {
            Object hVal = map.containsKey("handle") ? map.get("handle") : map.get("$handle");
            if (hVal instanceof Number) {
                Object obj = objectRegistry.get(((Number) hVal).longValue());
                if (obj != null && !paramTypes[i].isAssignableFrom(obj.getClass())) {
                    return false;
                }
                continue;
            }
        }
    }
    if (raw instanceof Number) {
        if (!isNumericType(paramTypes[i])) return false;
        continue;
    }
    if (raw instanceof Boolean) {
        if (paramTypes[i] != boolean.class && paramTypes[i] != Boolean.class) return false;
        continue;
    }
    if (raw instanceof String) {
        if (paramTypes[i] == byte[].class) continue;
        if (paramTypes[i] != String.class && paramTypes[i] != CharSequence.class && paramTypes[i] != Object.class) return false;
        continue;
    }
    if (!paramTypes[i].isInstance(raw)) return false;
}
return true;`,
    )

    .method('isNumericType', 'boolean')
    .private()
    .params([{ name: 'c', type: 'Class<?>' }])
    .body(
      `return c == int.class || c == Integer.class ||
       c == long.class || c == Long.class ||
       c == float.class || c == Float.class ||
       c == double.class || c == Double.class ||
       c == byte.class || c == Byte.class ||
       c == short.class || c == Short.class;`,
    )

    .method('convertArgs', 'Object[]')
    .private()
    .params([
      { name: 'paramTypes', type: 'Class<?>[]' },
      { name: 'rawArgs', type: 'List<?>' },
    ])
    .body(
      `Object[] args = new Object[paramTypes.length];
for (int i = 0; i < paramTypes.length; i++) {
    Object raw = i < rawArgs.size() ? rawArgs.get(i) : null;
    args[i] = convertArg(paramTypes[i], raw);
}
return args;`,
    )

    .method('convertArg', 'Object')
    .private()
    .params([
      { name: 'targetType', type: 'Class<?>' },
      { name: 'raw', type: 'Object' },
    ])
    .body(
      `if (raw == null) return null;

if (raw instanceof Map) {
    Map<?, ?> map = (Map<?, ?>) raw;
    if (map.containsKey("handle") || map.containsKey("$handle")) {
        Object hVal = map.containsKey("handle") ? map.get("handle") : map.get("$handle");
        if (hVal instanceof Number) {
            return objectRegistry.get(((Number) hVal).longValue());
        }
    }
}

if (targetType == int.class || targetType == Integer.class) return ((Number) raw).intValue();
if (targetType == long.class || targetType == Long.class) {
    return (raw instanceof Number) ? ((Number) raw).longValue() : Long.parseLong(raw.toString());
}
if (targetType == float.class || targetType == Float.class) return ((Number) raw).floatValue();
if (targetType == double.class || targetType == Double.class) return ((Number) raw).doubleValue();
if (targetType == boolean.class || targetType == Boolean.class) return Boolean.valueOf(raw.toString());
if (targetType == byte.class || targetType == Byte.class) return ((Number) raw).byteValue();
if (targetType == short.class || targetType == Short.class) return ((Number) raw).shortValue();
if (targetType == char.class || targetType == Character.class) return raw.toString().charAt(0);
if (targetType == String.class) return raw.toString();

if (targetType == byte[].class && raw instanceof String) {
    try {
        Class<?> b64Cls = Class.forName("java.util.Base64");
        Object decoder = b64Cls.getMethod("getDecoder").invoke(null);
        return decoder.getClass().getMethod("decode", String.class).invoke(decoder, raw.toString());
    } catch (Throwable ignored) {
        try {
            return (byte[]) Class.forName("javax.xml.bind.DatatypeConverter")
                .getMethod("parseBase64Binary", String.class)
                .invoke(null, raw.toString());
        } catch (Throwable ignored2) {}
    }
}

if (targetType.isInstance(raw)) return raw;

if (targetType.isArray() && raw instanceof List) {
    List<?> list = (List<?>) raw;
    Class<?> comp = targetType.getComponentType();
    Object arr = Array.newInstance(comp, list.size());
    for (int i = 0; i < list.size(); i++) {
        Array.set(arr, i, convertArg(comp, list.get(i)));
    }
    return arr;
}

return raw;`,
    )

    .method('invokeOnExecutor', 'Object')
    .private()
    .throws('Exception')
    .params([
      { name: 'executor', type: 'Object' },
      { name: 'executorMethodId', type: 'Long' },
      { name: 'method', type: 'Method' },
      { name: 'target', type: 'Object' },
      { name: 'args', type: 'Object[]' },
    ])
    .body(
      `Method submit = executorMethodId != null ? methodRegistry.get(executorMethodId) : null;
if (submit == null) {
    Method runnableCand = null;
    for (Method m : executor.getClass().getMethods()) {
        if (m.getParameterTypes().length != 1 || Modifier.isStatic(m.getModifiers())) continue;
        Class<?> pt = m.getParameterTypes()[0];
        if (pt == Callable.class) {
            submit = m;
            break;
        }
        if (pt == Runnable.class && runnableCand == null) {
            runnableCand = m;
        }
    }
    if (submit == null) submit = runnableCand;
}

if (submit == null) {
    throw new IllegalArgumentException("Executor " + executor.getClass().getName() + " has no Runnable or Callable submit method");
}
submit.setAccessible(true);

Object[] box = new Object[1];
Throwable[] err = new Throwable[1];
CountDownLatch latch = new CountDownLatch(1);

Exoproc task = new Exoproc(method, target, args, latch, box, err);
submit.invoke(executor, task);

if (!latch.await(10, TimeUnit.SECONDS)) {
    throw new TimeoutException("Executor task timed out after 10s");
}
if (err[0] != null) {
    throw (err[0] instanceof Exception) ? (Exception) err[0] : new RuntimeException(err[0]);
}
return box[0];`,
    )

    // =========================================================================
    // Universal SAM Callback Dispatcher over Named Pipe
    // =========================================================================

    .method('handleCallbackResponseFrame', 'void')
    .private()
    .static()
    .params([{ name: 'body', type: 'byte[]' }])
    .body(
      `try {
    Object parsed = parseJson(new String(body, StandardCharsets.UTF_8));
    if (!(parsed instanceof Map)) return;
    Map<?, ?> map = (Map<?, ?>) parsed;
    long id = map.get("id") instanceof Number ? ((Number) map.get("id")).longValue() : 0L;
    boolean ok = !Boolean.FALSE.equals(map.get("success"));
    Object result = map.get("result");
    Throwable err = ok ? null : new RuntimeException(map.get("error") != null ? String.valueOf(map.get("error")) : "Callback failed");
    completeCallback(id, result, err);
} catch (Throwable ignored) {}`,
    )

    // =========================================================================
    // Pipe Transport & Binary Frame Protocol (9-byte Little-Endian Header)
    // =========================================================================

    .method('closeResource', 'void')
    .private()
    .static()
    .params([{ name: 'res', type: 'Object' }])
    .body(
      `if (res == null) return;
try {
    if (res instanceof Closeable) {
        ((Closeable) res).close();
    } else if (res instanceof Process) {
        ((Process) res).destroy();
    }
} catch (Throwable ignored) {}`,
    )

    .method('openChannel', 'Object[]')
    .private()
    .static()
    .throws('Exception')
    .params([
      { name: 'path', type: 'String' },
      { name: 'timeoutMs', type: 'long' },
    ])
    .body(
      `long deadline = System.currentTimeMillis() + timeoutMs;
if (path.startsWith("\\\\\\\\.\\\\pipe\\\\")) {
    RandomAccessFile raf = null;
    while (true) {
        try {
            raf = new RandomAccessFile(path, "rw");
            break;
        } catch (IOException e) {
            if (System.currentTimeMillis() >= deadline) throw e;
            try {
                Thread.sleep(15);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrupted waiting for pipe: " + path, ie);
            }
        }
    }
    InputStream in = new FileInputStream(raf.getFD());
    OutputStream out = new FileOutputStream(raf.getFD());
    return new Object[]{ in, out, raf };
}

while (true) {
    try {
        try {
            Class<?> udsCls = Class.forName("java.net.UnixDomainSocketAddress");
            Method ofMethod = udsCls.getMethod("of", String.class);
            Object addr = ofMethod.invoke(null, path);
            Class<?> scCls = Class.forName("java.nio.channels.SocketChannel");
            Method openMethod = scCls.getMethod("open", java.net.SocketAddress.class);
            Object channel = openMethod.invoke(null, addr);
            Class<?> chCls = Class.forName("java.nio.channels.Channels");
            Class<?> rbcCls = Class.forName("java.nio.channels.ReadableByteChannel");
            Class<?> wbcCls = Class.forName("java.nio.channels.WritableByteChannel");
            InputStream in = (InputStream) chCls.getMethod("newInputStream", rbcCls).invoke(null, channel);
            OutputStream out = (OutputStream) chCls.getMethod("newOutputStream", wbcCls).invoke(null, channel);
            return new Object[]{ in, out, channel };
        } catch (ClassNotFoundException cnfe) {
            Process proc = new ProcessBuilder("socat", "-", "UNIX-CONNECT:" + path).start();
            return new Object[]{ proc.getInputStream(), proc.getOutputStream(), proc };
        }
    } catch (Exception e) {
        if (System.currentTimeMillis() >= deadline) throw e;
        try {
            Thread.sleep(20);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw e;
        }
    }
}`,
    )

    .method('readFully', 'boolean')
    .private()
    .static()
    .throws('IOException')
    .params([
      { name: 'in', type: 'InputStream' },
      { name: 'buf', type: 'byte[]' },
      { name: 'len', type: 'int' },
    ])
    .body(
      `int off = 0;
while (off < len) {
    int n = in.read(buf, off, len - off);
    if (n < 0) return false;
    off += n;
}
return true;`,
    )

    .method('writeFrameRaw', 'void')
    .private()
    .static()
    .throws('IOException')
    .params([
      { name: 'out', type: 'OutputStream' },
      { name: 'type', type: 'int' },
      { name: 'reqId', type: 'int' },
      { name: 'payload', type: 'byte[]' },
    ])
    .body(
      `int len = payload != null ? payload.length : 0;
byte[] hdr = new byte[9];
hdr[0] = (byte) (len & 0xff);
hdr[1] = (byte) ((len >>> 8) & 0xff);
hdr[2] = (byte) ((len >>> 16) & 0xff);
hdr[3] = (byte) ((len >>> 24) & 0xff);
hdr[4] = (byte) (type & 0xff);
hdr[5] = (byte) (reqId & 0xff);
hdr[6] = (byte) ((reqId >>> 8) & 0xff);
hdr[7] = (byte) ((reqId >>> 16) & 0xff);
hdr[8] = (byte) ((reqId >>> 24) & 0xff);
out.write(hdr);
if (len > 0) {
    out.write(payload);
}
out.flush();`,
    )

    .method('sendFrame', 'void')
    .private()
    .static()
    .throws('IOException')
    .params([
      { name: 'type', type: 'int' },
      { name: 'reqId', type: 'int' },
      { name: 'payload', type: 'byte[]' },
    ])
    .body(
      `synchronized (txLock) {
    OutputStream out = c2sOutput;
    if (out == null) throw new IOException("Exoproc pipe output channel is not connected");
    writeFrameRaw(out, type, reqId, payload);
}`,
    )

    .method('handshakeChannel', 'void')
    .private()
    .static()
    .throws('IOException')
    .params([
      { name: 'in', type: 'InputStream' },
      { name: 'out', type: 'OutputStream' },
      { name: 'role', type: 'String' },
      { name: 'reqId', type: 'int' },
    ])
    .body(
      `Map<String, Object> hello = new LinkedHashMap<String, Object>();
hello.put("clientId", activeClientId);
hello.put("role", role);
hello.put("kind", "java-agent");
hello.put("pid", getPid());
hello.put("buildId", BUILD_ID);
hello.put("targetName", getTargetName());
byte[] helloBytes = stringifyJson(hello).getBytes(StandardCharsets.UTF_8);
writeFrameRaw(out, 0x01, reqId, helloBytes);

byte[] hdr = new byte[9];
if (!readFully(in, hdr, 9)) {
    throw new EOFException("EOF waiting for HELLO_ACK on role " + role);
}
int ackLen = (hdr[0] & 0xff) | ((hdr[1] & 0xff) << 8) | ((hdr[2] & 0xff) << 16) | ((hdr[3] & 0xff) << 24);
if (ackLen > 0) {
    byte[] ackBody = new byte[ackLen];
    if (!readFully(in, ackBody, ackLen)) {
        throw new EOFException("EOF reading HELLO_ACK body on role " + role);
    }
}`,
    )

    .method('dispatchCallback', 'Object')
    .public()
    .static()
    .params([
      { name: 'callbackId', type: 'String' },
      { name: 'methodName', type: 'String' },
      { name: 'args', type: 'Object[]' },
    ])
    .body(
      `long id = nextInvocationId.getAndIncrement();
CountDownLatch latch = new CountDownLatch(1);
Object[] resultBox = new Object[1];
Throwable[] errorBox = new Throwable[1];

Map<String, Object> inv = new LinkedHashMap<String, Object>();
inv.put("id", id);
inv.put("latch", latch);
inv.put("resultBox", resultBox);
inv.put("errorBox", errorBox);
pendingInvocations.put(id, inv);

List<Object> wireArgs = new ArrayList<Object>();
if (args != null) {
    Exoproc inst = instance;
    for (Object a : args) {
        if (a == null || a instanceof Boolean || a instanceof Number || a instanceof String || a instanceof Character) {
            wireArgs.add(a);
        } else if (inst != null) {
            long h = inst.nextHandle.getAndIncrement();
            inst.objectRegistry.put(h, a);
            Map<String, Object> ref = new LinkedHashMap<String, Object>();
            ref.put("handle", h);
            wireArgs.add(ref);
        } else {
            wireArgs.add(String.valueOf(a));
        }
    }
}

Map<String, Object> packet = new LinkedHashMap<String, Object>();
packet.put("id", id);
packet.put("callbackId", callbackId);
packet.put("method", methodName);
packet.put("args", wireArgs);

try {
    byte[] payload = stringifyJson(packet).getBytes(StandardCharsets.UTF_8);
    sendFrame(0x20, (int) id, payload);
} catch (IOException ioe) {
    pendingInvocations.remove(id);
    throw new RuntimeException("Failed to send callback over pipe: " + ioe.getMessage(), ioe);
}

try {
    boolean completed = latch.await(defaultTimeoutSeconds, TimeUnit.SECONDS);
    if (!completed) {
        pendingInvocations.remove(id);
        throw new RuntimeException("Callback timeout (" + defaultTimeoutSeconds + "s) for callbackId: " + callbackId + "#" + methodName);
    }
} catch (InterruptedException e) {
    pendingInvocations.remove(id);
    Thread.currentThread().interrupt();
    throw new RuntimeException("Callback interrupted for callbackId: " + callbackId + "#" + methodName, e);
} finally {
    pendingInvocations.remove(id);
}

if (errorBox[0] != null) {
    if (errorBox[0] instanceof RuntimeException) throw (RuntimeException) errorBox[0];
    throw new RuntimeException("Callback failed: " + errorBox[0].getMessage(), errorBox[0]);
}
return resultBox[0];`,
    )

    .method('dispatchCallback', 'Object')
    .public()
    .static()
    .params([
      { name: 'callbackId', type: 'String' },
      { name: 'methodName', type: 'String' },
    ])
    .body('return dispatchCallback(callbackId, methodName, new Object[0]);')

    .method('completeCallback', 'boolean')
    .public()
    .static()
    .params([
      { name: 'id', type: 'long' },
      { name: 'result', type: 'Object' },
      { name: 'error', type: 'Throwable' },
    ])
    .body(
      `Map<String, Object> inv = pendingInvocations.remove(id);
if (inv != null) {
    Object[] resultBox = (Object[]) inv.get("resultBox");
    Throwable[] errorBox = (Throwable[]) inv.get("errorBox");
    CountDownLatch latch = (CountDownLatch) inv.get("latch");
    if (resultBox != null) resultBox[0] = result;
    if (errorBox != null) errorBox[0] = error;
    if (latch != null) latch.countDown();
    return true;
}
return false;`,
    )

    // =========================================================================
    // Universal Host & Process Properties (Exoproc API)
    // =========================================================================

    .method('isAttached', 'boolean')
    .public()
    .static()
    .body('return true;')

    .method('getPid', 'long')
    .public()
    .static()
    .body(
      `try {
    String jvmName = ManagementFactory.getRuntimeMXBean().getName();
    int atIdx = jvmName.indexOf('@');
    if (atIdx > 0) return Long.parseLong(jvmName.substring(0, atIdx));
} catch (Throwable ignored) {}
return 0;`,
    )

    .method('getTargetName', 'String')
    .public()
    .static()
    .body(
      `String cmd = System.getProperty("sun.java.command", "");
int sp = cmd.indexOf(' ');
String main = sp > 0 ? cmd.substring(0, sp) : cmd;
return main.isEmpty() ? "javaw.exe" : main;`,
    )

    .method('getClassLoader', 'ClassLoader')
    .public()
    .static()
    .body(
      `if (targetLoader != null) return targetLoader;
ClassLoader cl = Exoproc.class.getClassLoader();
if (cl != null) return cl;
cl = Thread.currentThread().getContextClassLoader();
if (cl != null) return cl;
return ClassLoader.getSystemClassLoader();`,
    )

    .method('defineClass', 'Class<?>')
    .public()
    .static()
    .params([
      { name: 'name', type: 'String' },
      { name: 'bytecode', type: 'byte[]' },
    ])
    .body('return defineClass(name, bytecode, getClassLoader());')

    .method('defineClass', 'Class<?>')
    .public()
    .static()
    .params([
      { name: 'name', type: 'String' },
      { name: 'bytecode', type: 'byte[]' },
      { name: 'loader', type: 'ClassLoader' },
    ])
    .body(
      `ClassLoader cl = loader != null ? loader : getClassLoader();
try {
    Method m = ClassLoader.class.getDeclaredMethod("defineClass", String.class, byte[].class, int.class, int.class);
    m.setAccessible(true);
    return (Class<?>) m.invoke(cl, name, bytecode, 0, bytecode.length);
} catch (Throwable t) {
    try {
        Field f = Class.forName("sun.misc.Unsafe").getDeclaredField("theUnsafe");
        f.setAccessible(true);
        Object unsafe = f.get(null);
        Method def = unsafe.getClass().getMethod(
            "defineClass", String.class, byte[].class, int.class, int.class, ClassLoader.class, java.security.ProtectionDomain.class
        );
        return (Class<?>) def.invoke(unsafe, name, bytecode, 0, bytecode.length, cl, null);
    } catch (Throwable t2) {
        return defineClassBytes(name, bytecode);
    }
}`,
    )

    .method('newInstance', 'Object')
    .public()
    .static()
    .params([{ name: 'className', type: 'String' }])
    .body('return newInstance(className, null);')

    .method('newInstance', 'Object')
    .public()
    .static()
    .params([
      { name: 'className', type: 'String' },
      { name: 'loader', type: 'ClassLoader' },
    ])
    .body(
      `try {
    Class<?> cls = Class.forName(className, true, loader != null ? loader : getClassLoader());
    return cls.getDeclaredConstructor().newInstance();
} catch (Throwable t) {
    throw new RuntimeException("Failed to instantiate " + className + ": " + t.getMessage(), t);
}`,
    )

    .method('shutdown', 'void')
    .public()
    .static()
    .body(
      `shuttingDown = true;
connected = false;
closeResource(s2cResource);
closeResource(c2sResource);
s2cResource = null;
c2sResource = null;
s2cInput = null;
c2sOutput = null;
ExecutorService pool = rpcExecutor;
rpcExecutor = null;
if (pool != null) {
    try { pool.shutdownNow(); } catch (Throwable ignored) {}
}`,
    )

    .method('stop', 'void')
    .public()
    .static()
    .body('shutdown();')

    // =========================================================================
    // Standalone CLI Main Runner
    // =========================================================================

    .method('main', 'void')
    .public()
    .static()
    .params([{ name: 'args', type: 'String[]' }])
    .body(
      `String pipe = null;
if (args != null) {
    for (int i = 0; i < args.length; i++) {
        String a = args[i] != null ? args[i].trim() : "";
        if ("--pipe".equals(a) && i + 1 < args.length) {
            pipe = args[++i].trim();
        } else if (a.startsWith("--pipe=")) {
            pipe = a.substring(7).trim();
        } else if (!a.startsWith("-") && pipe == null && !a.isEmpty()) {
            pipe = a;
        }
    }
}
init(null, Exoproc.class.getClassLoader(), null, pipe);
while (!shuttingDown) {
    try {
        Thread.sleep(250);
    } catch (InterruptedException ignored) {
        break;
    }
}`,
    )

    // =========================================================================
    // Minimal Zero-Dependency JSON Parser & Serializer
    // =========================================================================

    .method('parseJson', 'Object')
    .public()
    .static()
    .params([{ name: 'json', type: 'String' }])
    .body(
      `if (json == null || json.trim().isEmpty()) return Collections.emptyMap();
return parseJsonVal(json.trim(), new int[]{0});`,
    )

    .method('skipWs', 'void')
    .private()
    .static()
    .params([
      { name: 's', type: 'String' },
      { name: 'pos', type: 'int[]' },
    ])
    .body(
      `while (pos[0] < s.length()) {
    char c = s.charAt(pos[0]);
    if (c == ' ' || c == '\\t' || c == '\\n' || c == '\\r') pos[0]++;
    else break;
}`,
    )

    .method('parseJsonVal', 'Object')
    .private()
    .static()
    .params([
      { name: 's', type: 'String' },
      { name: 'pos', type: 'int[]' },
    ])
    .body(
      `skipWs(s, pos);
if (pos[0] >= s.length()) return null;
char c = s.charAt(pos[0]);
if (c == '{') return parseJsonObj(s, pos);
if (c == '[') return parseJsonArr(s, pos);
if (c == '"') return parseJsonStr(s, pos);
if (c == 't' || c == 'f') {
    boolean b = s.startsWith("true", pos[0]);
    pos[0] += b ? 4 : 5;
    return b;
}
if (c == 'n') {
    pos[0] += 4;
    return null;
}
return parseJsonNum(s, pos);`,
    )

    .method('parseJsonObj', 'Map<String, Object>')
    .private()
    .static()
    .params([
      { name: 's', type: 'String' },
      { name: 'pos', type: 'int[]' },
    ])
    .body(
      `Map<String, Object> map = new LinkedHashMap<String, Object>();
pos[0]++;
skipWs(s, pos);
if (pos[0] < s.length() && s.charAt(pos[0]) == '}') {
    pos[0]++;
    return map;
}
while (pos[0] < s.length()) {
    skipWs(s, pos);
    String key = parseJsonStr(s, pos);
    skipWs(s, pos);
    if (pos[0] < s.length() && s.charAt(pos[0]) == ':') pos[0]++;
    skipWs(s, pos);
    Object val = parseJsonVal(s, pos);
    map.put(key, val);
    skipWs(s, pos);
    if (pos[0] < s.length() && s.charAt(pos[0]) == ',') {
        pos[0]++;
    } else if (pos[0] < s.length() && s.charAt(pos[0]) == '}') {
        pos[0]++;
        break;
    }
}
return map;`,
    )

    .method('parseJsonArr', 'List<Object>')
    .private()
    .static()
    .params([
      { name: 's', type: 'String' },
      { name: 'pos', type: 'int[]' },
    ])
    .body(
      `List<Object> list = new ArrayList<Object>();
pos[0]++;
skipWs(s, pos);
if (pos[0] < s.length() && s.charAt(pos[0]) == ']') {
    pos[0]++;
    return list;
}
while (pos[0] < s.length()) {
    skipWs(s, pos);
    Object val = parseJsonVal(s, pos);
    list.add(val);
    skipWs(s, pos);
    if (pos[0] < s.length() && s.charAt(pos[0]) == ',') {
        pos[0]++;
    } else if (pos[0] < s.length() && s.charAt(pos[0]) == ']') {
        pos[0]++;
        break;
    }
}
return list;`,
    )

    .method('parseJsonStr', 'String')
    .private()
    .static()
    .params([
      { name: 's', type: 'String' },
      { name: 'pos', type: 'int[]' },
    ])
    .body(
      `pos[0]++;
StringBuilder sb = new StringBuilder();
while (pos[0] < s.length()) {
    char c = s.charAt(pos[0]++);
    if (c == '"') break;
    if (c == '\\\\' && pos[0] < s.length()) {
        char esc = s.charAt(pos[0]++);
        if (esc == '"' || esc == '\\\\' || esc == '/') sb.append(esc);
        else if (esc == 'b') sb.append('\\b');
        else if (esc == 'f') sb.append('\\f');
        else if (esc == 'n') sb.append('\\n');
        else if (esc == 'r') sb.append('\\r');
        else if (esc == 't') sb.append('\\t');
        else if (esc == 'u' && pos[0] + 4 <= s.length()) {
            sb.append((char) Integer.parseInt(s.substring(pos[0], pos[0] + 4), 16));
            pos[0] += 4;
        }
    } else {
        sb.append(c);
    }
}
return sb.toString();`,
    )

    .method('parseJsonNum', 'Number')
    .private()
    .static()
    .params([
      { name: 's', type: 'String' },
      { name: 'pos', type: 'int[]' },
    ])
    .body(
      `int start = pos[0];
boolean isFloat = false;
while (pos[0] < s.length()) {
    char c = s.charAt(pos[0]);
    if ((c >= '0' && c <= '9') || c == '-' || c == '+') {
        pos[0]++;
    } else if (c == '.' || c == 'e' || c == 'E') {
        isFloat = true;
        pos[0]++;
    } else {
        break;
    }
}
String numStr = s.substring(start, pos[0]);
if (isFloat) return Double.parseDouble(numStr);
long l = Long.parseLong(numStr);
if (l >= Integer.MIN_VALUE && l <= Integer.MAX_VALUE) return (int) l;
return l;`,
    )

    .method('stringifyJson', 'String')
    .public()
    .static()
    .params([{ name: 'obj', type: 'Object' }])
    .body(
      `StringBuilder sb = new StringBuilder();
serializeJson(obj, sb);
return sb.toString();`,
    )

    .method('serializeJson', 'void')
    .private()
    .static()
    .params([
      { name: 'obj', type: 'Object' },
      { name: 'sb', type: 'StringBuilder' },
    ])
    .body(
      `if (obj == null) {
    sb.append("null");
} else if (obj instanceof Boolean || obj instanceof Number) {
    sb.append(obj);
} else if (obj instanceof CharSequence || obj instanceof Character) {
    sb.append('"').append(escapeJson(obj.toString())).append('"');
} else if (obj instanceof Map) {
    sb.append('{');
    Map<?, ?> map = (Map<?, ?>) obj;
    boolean first = true;
    for (Map.Entry<?, ?> entry : map.entrySet()) {
        if (!first) sb.append(',');
        first = false;
        sb.append('"').append(escapeJson(String.valueOf(entry.getKey()))).append("\\":");
        serializeJson(entry.getValue(), sb);
    }
    sb.append('}');
} else if (obj instanceof Collection) {
    sb.append('[');
    Collection<?> col = (Collection<?>) obj;
    boolean first = true;
    for (Object item : col) {
        if (!first) sb.append(',');
        first = false;
        serializeJson(item, sb);
    }
    sb.append(']');
} else if (obj.getClass().isArray()) {
    sb.append('[');
    int len = Array.getLength(obj);
    for (int i = 0; i < len; i++) {
        if (i > 0) sb.append(',');
        serializeJson(Array.get(obj, i), sb);
    }
    sb.append(']');
} else {
    sb.append('"').append(escapeJson(obj.toString())).append('"');
}`,
    )

    .method('escapeJson', 'String')
    .public()
    .static()
    .params([{ name: 's', type: 'String' }])
    .body(
      `if (s == null) return "";
StringBuilder sb = new StringBuilder();
for (int i = 0; i < s.length(); i++) {
    char c = s.charAt(i);
    if (c == '"') sb.append("\\\\\\"");
    else if (c == '\\\\') sb.append("\\\\\\\\");
    else if (c == '\\b') sb.append("\\\\b");
    else if (c == '\\f') sb.append("\\\\f");
    else if (c == '\\n') sb.append("\\\\n");
    else if (c == '\\r') sb.append("\\\\r");
    else if (c == '\\t') sb.append("\\\\t");
    else if (c < 0x20) sb.append(String.format("\\\\u%04x", (int) c));
    else sb.append(c);
}
return sb.toString();`,
    );

  return cls;
}

/**
 * Builds the delegating NJavaAgent class using the fluent JavaClassBuilder DSL.
 */
export function buildNJavaAgentClass(): JavaClassBuilder {
  const cls = new JavaClassBuilder('NJavaAgent');

  cls
    .package('org.exoproc.njava.agent')
    .public()
    .extends('org.exoproc.njava.agent.utils.Exoproc')
    .import('org.exoproc.njava.agent.utils.Exoproc')
    .import('java.lang.instrument.Instrumentation')

    .method('premain', 'void')
    .public()
    .static()
    .params([
      { name: 'agentArgs', type: 'String' },
      { name: 'inst', type: 'Instrumentation' },
    ])
    .body('Exoproc.premain(agentArgs, inst);')

    .method('agentmain', 'void')
    .public()
    .static()
    .params([
      { name: 'agentArgs', type: 'String' },
      { name: 'inst', type: 'Instrumentation' },
    ])
    .body('Exoproc.agentmain(agentArgs, inst);')

    .method('main', 'void')
    .public()
    .static()
    .params([{ name: 'args', type: 'String[]' }])
    .body('Exoproc.main(args);')

    .method('start', 'void')
    .public()
    .static()
    .body('Exoproc.start();')

    .method('start', 'void')
    .public()
    .static()
    .params([{ name: 'pipePath', type: 'String' }])
    .body('Exoproc.start(pipePath);')

    .method('start', 'void')
    .public()
    .static()
    .params([
      { name: 'pipePath', type: 'String' },
      { name: 'classLoader', type: 'ClassLoader' },
    ])
    .body('Exoproc.start(pipePath, classLoader);')

    .method('stop', 'void')
    .public()
    .static()
    .body('Exoproc.stop();');

  return cls;
}
