import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleScreenPresenter } from '../../packages/simulate/dist/host/console-screen-presenter.js';
import { Win32VideoOutput } from '../../packages/simulate/dist/runtime/video-output.js';

describe('host console screen presenter', () => {
  it('draws only changed Windows framebuffer cell spans', () => {
    const operations: string[] = [];
    const videoOutput = new Win32VideoOutput({
      columns: 4,
      rows: 2,
    });
    const presenter = new ConsoleScreenPresenter(videoOutput, {
      clear: () => operations.push('clear'),
      setCursor: (column, row) => operations.push(`cursor ${column},${row}`),
      write: (text) => operations.push(`write ${JSON.stringify(text)}`),
    });

    presenter.present();
    assert.deepEqual(operations, ['clear', 'cursor 0,0']);

    operations.length = 0;
    videoOutput.write(new TextEncoder().encode('AB'));
    presenter.present();
    // The default attribute (light gray on the terminal's own default
    // background) is emitted as an SGR escape once, ahead of the first
    // character it applies to. Background 49 (not an explicit 40/black)
    // lets the host terminal's theme/transparency show through.
    assert.deepEqual(operations, [
      'cursor 0,0',
      'write "\\u001b[0;37;49mAB"',
      'cursor 2,0',
    ]);

    operations.length = 0;
    presenter.present();
    assert.deepEqual(operations, []);

    videoOutput.clear();
    presenter.present();
    // Same attribute as last time -- no SGR escape re-emitted.
    assert.deepEqual(operations, ['cursor 0,0', 'write "  "', 'cursor 0,0']);
  });
});
