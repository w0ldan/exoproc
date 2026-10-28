'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Search } from 'lucide-react';
import {
  CommandsRegistry,
  ICommandService,
  getCommandTitle,
  type CommandDescriptor,
} from '@/platform/commands/common/commands';
import {
  IKeybindingService,
  KeybindingsRegistry,
} from '@/platform/keybinding/common/keybinding';
import { useService } from '@/platform/instantiation/browser/instantiationService';
import { useIdeTranslation } from '@/lib/ide-i18n';

const SHOW_COMMANDS_COMMAND_ID = 'workbench.action.showCommands';

/**
 * VS Code's Command Palette (`Ctrl+Shift+P`): a top-anchored overlay
 * listing every registered command (`CommandsRegistry`), filtered as you
 * type, run via `ICommandService` on Enter or click.
 *
 * Self-registers its own opening command and keybinding on mount rather
 * than wiring `ctrl+shift+p` to local state directly -- the palette IS
 * `workbench.action.showCommands`'s handler, the same relationship VS
 * Code's real palette has to its own opening command. Any future feature
 * (a status bar item, another shortcut) can open the palette the same
 * way, through the command, without knowing this component exists.
 *
 * Quick Open (`Ctrl+P`, file search) is deliberately not built alongside
 * this: it needs to list every file in the workspace, and the only file
 * listing this workbench has right now is the pre-shell `IExplorerService`
 * that F7 is about to replace with `IFileService`. Building it against
 * the outgoing service would mean building the same UI twice.
 */
export function CommandPalette() {
  const commandService = useService(ICommandService);
  const keybindingService = useService(IKeybindingService);
  const { lang, t } = useIdeTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const commandDisposable = CommandsRegistry.register({
      id: SHOW_COMMANDS_COMMAND_ID,
      title: 'Show All Commands',
      handler: () => {
        // Reset here, at the point the palette is asked to open, rather
        // than reactively in an effect keyed on `open` -- resetting
        // state from inside an effect body is exactly the
        // cascading-render pattern React's own lint rule flags.
        setQuery('');
        setActiveIndex(0);
        setOpen(true);
      },
    });
    const keybindingDisposable = KeybindingsRegistry.register({
      key: 'ctrl+shift+p',
      commandId: SHOW_COMMANDS_COMMAND_ID,
    });
    const attachment = keybindingService.attach();
    return () => {
      commandDisposable.dispose();
      keybindingDisposable.dispose();
      attachment.dispose();
    };
  }, [keybindingService]);

  useEffect(() => {
    if (!open) return;
    // The input only exists once `open` renders it -- focus next frame.
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const commands = useMemo(() => {
    if (!open) return [];
    const all = CommandsRegistry.getAll().filter(
      (command) => command.id !== SHOW_COMMANDS_COMMAND_ID,
    );
    const normalizedQuery = query.trim().toLowerCase();
    const mapped = all.map((command) => ({
      command,
      displayTitle: getCommandTitle(command, lang),
    }));
    if (!normalizedQuery) return mapped;
    return mapped.filter((item) =>
      item.displayTitle.toLowerCase().includes(normalizedQuery),
    );
  }, [open, query, lang]);

  const runCommand = (command: CommandDescriptor) => {
    setOpen(false);
    void commandService.executeCommand(command.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, commands.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = commands[activeIndex];
      if (item) runCommand(item.command);
    }
  };

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-100 flex justify-center bg-black/40 pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        className="h-fit w-full max-w-160 overflow-hidden rounded-md border border-white/10 bg-[#252526] text-[#cccccc] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-3">
          <Search
            aria-hidden="true"
            className="size-4 shrink-0 text-[#8c8c8c]"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t.commandPalette.placeholder}
            aria-label={t.commandPalette.searchAria}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={commands[activeIndex]?.command.id}
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-[#6b6b6b]"
          />
        </div>
        <ul
          id="command-palette-list"
          role="listbox"
          className="max-h-80 overflow-y-auto py-1"
        >
          {commands.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-[#8c8c8c]">
              {t.commandPalette.noMatching}
            </li>
          ) : (
            commands.map((item, index) => (
              <li
                key={item.command.id}
                id={item.command.id}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(item.command)}
                className={`cursor-pointer px-3 py-1.5 text-sm ${
                  index === activeIndex ? 'bg-[#04395e] text-white' : ''
                }`}
              >
                {item.displayTitle}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

export default CommandPalette;
