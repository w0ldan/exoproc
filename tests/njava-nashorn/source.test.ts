import { describe, expect, it } from 'bun:test';
import {
  Source,
  JavaCode,
  ScriptFunction,
  createJavaCode,
  getNashornTemplate,
} from '../../packages/java/nashorn/src/index.js';

describe('njava-nashorn: Source & JavaCode & ScriptFunction', () => {
  it('creates JavaCode from string and inherits from Source', () => {
    const rawCode = 'Minecraft.getMinecraft().displayGuiScreen(null);';
    const jc = createJavaCode(rawCode);

    expect(jc instanceof Source).toBe(true);
    expect(jc instanceof JavaCode).toBe(true);
    expect((jc as any).$className).toBe('jdk.nashorn.internal.runtime.Source');
    expect((jc as any).__isJavaCode).toBe(true);
    expect(jc.getString()).toBe(rawCode);
    expect(jc.toString()).toBe(rawCode);
    expect(jc.valueOf()).toBe(rawCode);
    expect(String(jc)).toBe(rawCode);
  });

  it('creates ScriptFunction when given a JS function', () => {
    const fn = function testAction() {
      return 42;
    };
    const sf = createJavaCode(fn);

    expect(sf instanceof Source).toBe(true);
    expect(sf instanceof ScriptFunction).toBe(true);
    expect((sf as any).$className).toBe(
      'jdk.nashorn.internal.runtime.ScriptFunction',
    );
    expect((sf as any).__isScriptFunction).toBe(true);
    expect((sf as any).fn).toBe(fn);
    expect((sf as any).name).toBe('testAction');

    // Body extracted lazily and cached on first access
    const body1 = sf.getString();
    expect(body1).toContain('return 42;');
    expect((sf as any).body).toBe(body1);
    expect(sf.toString()).toBe(body1);
  });

  it('manages one-time targetCasts cache on JavaCode', () => {
    const jc = createJavaCode('int x = 10;');

    expect(jc.hasCast('java.lang.String')).toBe(false);
    jc.setCast('java.lang.String', 'int x = 10;');
    expect(jc.hasCast('java.lang.String')).toBe(true);
    expect(jc.getCast<string>('java.lang.String')).toBe('int x = 10;');

    // Multi-target casts
    jc.setCast('java.lang.Runnable', { className: 'RunnableAdapter1' });
    expect(jc.getCast<any>('java.lang.Runnable')).toEqual({
      className: 'RunnableAdapter1',
    });
    expect(jc.casts.size).toBe(2);
  });

  it('exposes Java.code in Nashorn template', () => {
    const template = getNashornTemplate();
    expect(template).toContain('J.code = function');

    // Test template code evaluation in isolated scope
    const fn = new Function(
      `${template}; return Java.code('System.out.println("hello");');`,
    );
    const res = fn();
    expect(res).toBeDefined();
    expect(res.$className).toBe('jdk.nashorn.internal.runtime.Source');
    expect(res.__isJavaCode).toBe(true);
    expect(res.getString()).toBe('System.out.println("hello");');
    expect(String(res)).toBe('System.out.println("hello");');
  });

  it('exposes Java.code with function in Nashorn template', () => {
    const template = getNashornTemplate();
    const fn = new Function(
      `${template}; return Java.code(function() { return 99; });`,
    );
    const res = fn();
    expect(res).toBeDefined();
    expect(res.$className).toBe('jdk.nashorn.internal.runtime.ScriptFunction');
    expect(res.__isScriptFunction).toBe(true);
    expect(res.getString()).toContain('return 99');
    expect(String(res)).toContain('return 99');
  });
});
