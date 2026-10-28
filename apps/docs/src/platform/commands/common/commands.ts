import type { Disposable } from '@/base/common/event';
import { createDecorator } from '@/platform/instantiation/common/instantiation';

/**
 * Analogue of VS Code's `vs/platform/commands/common/commands.ts`
 * (`ICommandService` + `CommandsRegistry`). A command is a named,
 * callable action; anything can register one as a side effect of loading
 * a `*.contribution.ts` module and anything else can run it by id
 * without knowing who registered it -- this indirection is what a
 * Command Palette needs to exist at all (F6).
 */

export type CommandHandler = (...args: readonly unknown[]) => unknown;

export interface CommandDescriptor {
  readonly id: string;
  readonly title: string | ((lang: string) => string);
  readonly handler: CommandHandler;
}

export function getCommandTitle(
  command: CommandDescriptor,
  lang: string,
): string {
  return typeof command.title === 'function'
    ? command.title(lang)
    : command.title;
}

class CommandsRegistryImpl {
  private readonly commands = new Map<string, CommandDescriptor>();

  /**
   * Replaces rather than rejecting a repeat `id`, for the same reason
   * `registerViewContainer` does: a contribution module re-run by Fast
   * Refresh must be able to re-register without throwing.
   */
  public register(descriptor: CommandDescriptor): Disposable {
    this.commands.set(descriptor.id, descriptor);
    return {
      dispose: () => {
        if (this.commands.get(descriptor.id) === descriptor) {
          this.commands.delete(descriptor.id);
        }
      },
    };
  }

  public get(id: string): CommandDescriptor | undefined {
    return this.commands.get(id);
  }

  public getAll(): readonly CommandDescriptor[] {
    return [...this.commands.values()];
  }
}

export const CommandsRegistry = new CommandsRegistryImpl();

export interface ICommandService {
  executeCommand<T = void>(id: string, ...args: readonly unknown[]): Promise<T>;
}

export const ICommandService =
  createDecorator<ICommandService>('commandService');

export class CommandService implements ICommandService {
  public async executeCommand<T = void>(
    id: string,
    ...args: readonly unknown[]
  ): Promise<T> {
    const descriptor = CommandsRegistry.get(id);
    if (!descriptor) throw new Error(`Command "${id}" is not registered.`);
    return (await descriptor.handler(...args)) as T;
  }
}
