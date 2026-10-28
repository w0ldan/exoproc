import { describe, test, expect, afterEach } from 'bun:test';
import { type DummyProcess } from 'exoproc-dummy';
import { type HostAccessor, createAccessor } from 'exoproc-accessors';
import { getJava, getJavaSync } from 'bun-njava';
import { spawnJavaDummyProcess } from './java-dummy-process.js';

describe('njava > Deobfuscation & Mapping Subsystem', () => {
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

  test('Sync Java proxy with Deobfuscation mappings: Class, Field and Method transparent translation', async () => {
    proc = spawnJavaDummyProcess();
    host = await createAccessor(proc.pid);

    const Java = getJavaSync(host);
    expect(Java).toBeDefined();

    // 1. Register obfuscation mappings:
    // Remote JVM has obfuscated class "Idle" with fields "score", "name" and methods "greet", "add"
    Java.mapClass('Idle', 'net.minecraft.entity.player.EntityPlayer', {
      fields: {
        score: 'playerScore',
        name: 'playerName',
      },
      methods: {
        greet: 'sayHello',
        add: 'calculateSum',
      },
    });

    // 2. Resolve class using DEOBFUSCATED name
    const Player = Java.type('net.minecraft.entity.player.EntityPlayer');
    expect(Player).toBeDefined();

    // Class metadata presents deobfuscated name
    expect(Player.name).toBe('net.minecraft.entity.player.EntityPlayer');
    expect(Player.getName()).toBe('net.minecraft.entity.player.EntityPlayer');
    expect(Player.getSimpleName()).toBe('EntityPlayer');
    expect(Player.toString()).toBe(
      '[JavaClass net.minecraft.entity.player.EntityPlayer]',
    );
    expect(Player.class.toString()).toBe(
      'class net.minecraft.entity.player.EntityPlayer',
    );
    expect(Player.class.getName()).toBe(
      'net.minecraft.entity.player.EntityPlayer',
    );
    expect(Player.class.getSimpleName()).toBe('EntityPlayer');

    // 3. Instantiate using constructor matching
    const player = new Player('Alex', 1234);
    expect(player).toBeDefined();

    // Object metadata presents deobfuscated name
    expect(player.$className).toBe('net.minecraft.entity.player.EntityPlayer');
    expect(player.getClass().getName()).toBe(
      'net.minecraft.entity.player.EntityPlayer',
    );
    expect(player.getClass().getSimpleName()).toBe('EntityPlayer');
    expect(player.getClass().toString()).toBe(
      '[JavaClass net.minecraft.entity.player.EntityPlayer]',
    );

    // 4. Read fields using DEOBFUSCATED names
    expect(player.playerName).toBe('Alex');
    expect(player.playerScore).toBe(1234);

    // 5. Write field using DEOBFUSCATED name
    player.playerScore = 9999;
    expect(player.playerScore).toBe(9999);

    player.playerName = 'Notch';
    expect(player.playerName).toBe('Notch');

    // 6. Call instance method using DEOBFUSCATED name
    const greeting = player.sayHello('Welcome to Exoproc');
    expect(greeting).toContain('Welcome to Exoproc');
    expect(greeting).toContain('Notch');

    // 7. Call static method using DEOBFUSCATED name
    const sum = Player.calculateSum(40, 2);
    expect(sum).toBe(42);
  }, 120000);

  test('Async Java proxy with Deobfuscation mappings: await transparent member mapping', async () => {
    proc = spawnJavaDummyProcess();
    host = await createAccessor(proc.pid);

    const Java = await getJava(host);
    expect(Java).toBeDefined();

    Java.mapClass('Idle', 'net.minecraft.client.entity.EntityPlayerSP', {
      fields: {
        score: 'experience',
        name: 'username',
      },
      methods: {
        greet: 'sendChat',
      },
    });

    // Resolve class asynchronously via deobfuscated name
    const PlayerSP = await Java.typeAsync(
      'net.minecraft.client.entity.EntityPlayerSP',
    );
    expect(PlayerSP.name).toBe('net.minecraft.client.entity.EntityPlayerSP');
    expect(PlayerSP.getSimpleName()).toBe('EntityPlayerSP');

    // Instantiate
    const player = await new PlayerSP('Steve', 500);
    expect(player.$className).toBe(
      'net.minecraft.client.entity.EntityPlayerSP',
    );

    // Read deobf fields
    expect(await player.username).toBe('Steve');
    expect(await player.experience).toBe(500);

    // Call deobf method
    const chat = await player.sendChat('Hello World');
    expect(chat).toContain('Hello World');
    expect(chat).toContain('Steve');
  }, 120000);

  test('JavaMappingRegistry loads Tiny mappings directly via loadTiny and load', () => {
    const { JavaMappingRegistry } = require('bun-njava');
    const mapper = new JavaMappingRegistry();

    const tinyData = [
      'v1\tnamed\tobf',
      'CLASS\torg/test/Demo\ta/b/c',
      'FIELD\torg/test/Demo\tI\tcounter\tf1',
      'METHOD\torg/test/Demo\t()V\tincrement\tm1',
    ].join('\n');

    mapper.loadTiny(tinyData);

    expect(mapper.resolveObfClass('org.test.Demo')).toBe('a.b.c');
    expect(mapper.resolveObfClass('Demo')).toBe('a.b.c');
    expect(mapper.resolveDeobfClass('a.b.c')).toBe('org.test.Demo');
    expect(mapper.resolveObfField('Demo', 'counter')).toBe('f1');
    expect(mapper.resolveDeobfField('Demo', 'f1')).toBe('counter');
    expect(mapper.resolveObfMethod('Demo', 'increment')).toBe('m1');
    expect(mapper.resolveDeobfMethod('Demo', 'm1')).toBe('increment');

    // Auto-detection in load()
    const mapper2 = new JavaMappingRegistry();
    mapper2.load(tinyData);
    expect(mapper2.resolveObfField('Demo', 'counter')).toBe('f1');
  });

  test('JavaMappingRegistry loads dynamic agent mappings with loadAgentMappings and resolves Exoproc obfuscated members', async () => {
    const { JavaMappingRegistry } = require('bun-njava');
    const { loadAgentMappings } = await import('njava-agent');
    const { getTestJavaPath } = await import('./java-test-helpers.js');

    const mapper = new JavaMappingRegistry();
    const mappingsText = loadAgentMappings(mapper, {
      javaPath: getTestJavaPath(8),
    });

    expect(mappingsText).toContain('v1\tnamed\tobf');

    // Exoproc class resolution
    expect(mapper.resolveObfClass('Exoproc')).toBe(
      'org.exoproc.njava.agent.utils.Exoproc',
    );
    expect(
      mapper.resolveObfClass('org.exoproc.njava.agent.utils.Exoproc'),
    ).toBe('org.exoproc.njava.agent.utils.Exoproc');

    // Obfuscated fields resolution: deobf -> obf
    expect(mapper.resolveObfField('Exoproc', 'instance')).toBe('a');
    expect(mapper.resolveObfField('Exoproc', 'httpServer')).toBe('b');
    expect(
      mapper.resolveObfField(
        'org.exoproc.njava.agent.utils.Exoproc',
        'targetLoader',
      ),
    ).toBe('c');

    // Reverse deobfuscated fields: obf -> deobf
    expect(mapper.resolveDeobfField('Exoproc', 'a')).toBe('instance');
    expect(mapper.resolveDeobfField('Exoproc', 'b')).toBe('httpServer');

    // Obfuscated methods resolution
    expect(mapper.resolveObfMethod('Exoproc', 'serializeValue')).toBe('a');
    expect(mapper.resolveObfMethod('Exoproc', 'isMethodCompatible')).toBe('b');
    expect(mapper.resolveDeobfMethod('Exoproc', 'a')).toBe('serializeValue');
  }, 60000);
});
