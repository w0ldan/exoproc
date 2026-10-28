import { describe, expect, it } from 'bun:test';
import { getNashornTemplate } from '../../packages/java/nashorn/src/index.js';

describe('njava-nashorn: templates', () => {
  it('generates Nashorn ES5 template with class and member maps', () => {
    const template = getNashornTemplate({
      mappings: {
        'net.minecraft.client.Minecraft': 'ave',
      },
      fieldMappings: {
        'net.minecraft.client.Minecraft': { thePlayer: 'h' },
      },
      methodMappings: {
        'net.minecraft.client.Minecraft': { getMinecraft: 'A' },
      },
    });

    expect(template).toContain('Object.assign');
    expect(template).toContain('Object.entries');
    expect(template).toContain('Array.prototype.find');
    expect(template).toContain('"net.minecraft.client.Minecraft":"ave"');
    expect(template).toContain('J.getObfClass');
    expect(template).toContain('J.getObfField');
    expect(template).toContain('J.getObfMethod');
  });
});
