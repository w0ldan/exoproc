import { expect, test, describe } from 'bun:test';
import { MinecraftTimer, MinecraftEntity } from 'exoproc-minecraft';

describe('exoproc-minecraft > Client Wrappers', () => {
  const mockMappings: any = {
    Entity: {
      realClassName: 'pk',
      fields: {
        posX: 's',
        posY: 't',
        posZ: 'u',
        motionX: 'v',
        motionY: 'w',
        motionZ: 'x',
        rotationYaw: 'y',
        rotationPitch: 'z',
        onGround: 'C',
        isDead: 'I',
        entityId: 'c',
      },
      methods: {},
    },
    Timer: {
      realClassName: 'avl',
      fields: {
        timerSpeed: 'timerSpeed',
      },
      methods: {},
    },
  };

  test('MinecraftEntity reads pos, motion, rotation and computes distance', async () => {
    const fieldValues: Record<string, any> = {
      s: 100.5, // posX
      t: 64.0, // posY
      u: -200.25, // posZ
      v: 0.1, // motionX
      w: -0.05, // motionY
      x: 0.2, // motionZ
      y: 90.0, // rotationYaw
      z: 45.0, // rotationPitch
      C: true, // onGround
      I: false, // isDead
      c: 42, // entityId
    };

    const fakeClass: any = {
      readField: async (name: string, _inst: bigint) => fieldValues[name],
      writeField: async (name: string, val: any, _inst: bigint) => {
        fieldValues[name] = val;
      },
      getSuperclassChain: async () => ['pk', 'java.lang.Object'],
    };

    const fakeBridge: any = {
      getClassName: async () => 'pk',
      getClass: async () => fakeClass,
    };

    const entity = new MinecraftEntity(
      0x1000n,
      fakeClass,
      mockMappings,
      fakeBridge,
    );

    const pos = await entity.getPos();
    expect(pos.x).toBe(100.5);
    expect(pos.y).toBe(64.0);
    expect(pos.z).toBe(-200.25);

    const motion = await entity.getMotion();
    expect(motion.x).toBe(0.1);
    expect(motion.y).toBe(-0.05);

    const rot = await entity.getRotation();
    expect(rot.yaw).toBe(90.0);
    expect(rot.pitch).toBe(45.0);

    expect(await entity.isOnGround()).toBe(true);
    expect(await entity.isDead()).toBe(false);
    expect(await entity.getId()).toBe(42);

    // Distance calculation
    const dist = await entity.getDistanceTo({ x: 100.5, y: 64.0, z: -203.25 });
    expect(dist).toBeCloseTo(3.0, 5);

    // Mutation
    await entity.setPos(150.0, 70.0, 200.0);
    expect(fieldValues.s).toBe(150.0);
    expect(fieldValues.t).toBe(70.0);
    expect(fieldValues.u).toBe(200.0);
  });

  test('MinecraftTimer reads and writes timerSpeed', async () => {
    let speed = 1.0;
    const fakeClass: any = {
      readField: async (name: string) => (name === 'timerSpeed' ? speed : 0),
      writeField: async (name: string, val: any) => {
        if (name === 'timerSpeed') speed = val;
      },
    };

    const timer = new MinecraftTimer(0x2000n, fakeClass, mockMappings);
    expect(await timer.getTimerSpeed()).toBe(1.0);

    await timer.setTimerSpeed(2.5);
    expect(await timer.getTimerSpeed()).toBe(2.5);
  });
});
