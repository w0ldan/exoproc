import type { Disposable } from '@/base/common/event';
import { createDecorator } from '@/platform/instantiation/common/instantiation';
import { ICommandService } from '@/platform/commands/common/commands';

/**
 * Analogue of VS Code's `vs/platform/keybinding/common/keybinding.ts` +
 * `KeybindingsRegistry`, cut down to what a Command Palette / Quick Open
 * pair actually needs (F6): a global shortcut fires a command by id.
 * VS Code's real keybinding system additionally resolves chords and
 * `when`-clause context -- out of scope here on purpose, since this
 * application registers on the order of two shortcuts, not hundreds.
 */

export interface KeybindingDescriptor {
  /** Normalized form produced by {@link normalizeKeybinding}, e.g. `"ctrl+shift+p"`. */
  readonly key: string;
  readonly commandId: string;
}

class KeybindingsRegistryImpl {
  private readonly bindings = new Map<string, KeybindingDescriptor>();

  /** Keyed by `key::commandId` so a Fast Refresh re-registration replaces itself, not accumulates. */
  public register(descriptor: KeybindingDescriptor): Disposable {
    const key = `${descriptor.key}::${descriptor.commandId}`;
    this.bindings.set(key, descriptor);
    return { dispose: () => this.bindings.delete(key) };
  }

  public getAll(): readonly KeybindingDescriptor[] {
    return [...this.bindings.values()];
  }
}

export const KeybindingsRegistry = new KeybindingsRegistryImpl();

/**
 * Turns a real `KeyboardEvent` into the same string form used by
 * `KeybindingDescriptor.key`. Uses `event.code` for the letter/digit
 * itself (layout- and shift-independent) rather than `event.key`, which
 * would otherwise make `ctrl+shift+p` fail to match on browsers that
 * report `event.key` as `"P"` while Shift is held.
 */
export function normalizeKeybinding(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  parts.push(physicalKey(event));
  return parts.join('+');
}

function physicalKey(event: KeyboardEvent): string {
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter) return letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(event.code);
  if (digit) return digit[1];
  return event.key.toLowerCase();
}

export interface IKeybindingService {
  /** Starts global dispatch. Call once, from the workbench root; dispose to stop. */
  attach(): Disposable;
}

export const IKeybindingService =
  createDecorator<IKeybindingService>('keybindingService');

export class KeybindingService implements IKeybindingService {
  public constructor(private readonly commands: ICommandService) {}

  public attach(): Disposable {
    const handler = (event: KeyboardEvent) => {
      const pressed = normalizeKeybinding(event);
      const match = KeybindingsRegistry.getAll().find(
        (binding) => binding.key === pressed,
      );
      if (!match) return;
      event.preventDefault();
      void this.commands.executeCommand(match.commandId);
    };
    document.addEventListener('keydown', handler);
    return { dispose: () => document.removeEventListener('keydown', handler) };
  }
}
