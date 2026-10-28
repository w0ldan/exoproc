'use client';

import { useEffect, useState } from 'react';
import { bootstrapShell } from '@/shell/renderer/bootstrap';
import type { ThreadSnapshotDto } from '@/shell/common/channels';
import {
  CommandService,
  CommandsRegistry,
} from '@/platform/commands/common/commands';
import {
  KeybindingService,
  KeybindingsRegistry,
} from '@/platform/keybinding/common/keybinding';
import { getExoprocApi } from '@/shell/renderer/bootstrap';
import { FileService } from '@/workbench/services/files/IFileService';

/** Temporary acceptance probe: proves the engine really runs behind the boundary. */
export default function ShellProbePage() {
  const [lines, setLines] = useState<string[]>(['pending']);

  useEffect(() => {
    let cancelled = false;
    const log: string[] = [];
    const add = (line: string) => {
      log.push(line);
      if (!cancelled) setLines([...log]);
    };

    void (async () => {
      try {
        bootstrapShell();
        const { app, machine, debug, memory } = window.exoproc;

        add(`app version=${await app.getVersion()}`);

        // Push events must arrive without being asked for.
        const pushed: ThreadSnapshotDto[] = [];
        const off = debug.onDidChangeThread((snapshot) =>
          pushed.push(snapshot),
        );

        const proc = await machine.createDemoProcess();
        add(
          `process pid=${proc.pid} image=${proc.image} threads=${proc.threads.length} mappings=${proc.mappings.length}`,
        );

        const thread = proc.threads[0];
        add(`bigint rip=${typeof thread.registers.RIP} state=${thread.state}`);

        const before = thread.registers.RIP;
        const ref = { pid: proc.pid, tid: thread.tid };
        const step = await debug.step(ref, 3);
        const after = await debug.getThread(ref);
        add(
          `step reason=${step?.reason} mnemonic=${step?.instruction.mnemonic}`,
        );
        add(
          `rip moved=${after !== undefined && after.registers.RIP !== before}`,
        );
        add(`pushed=${pushed.length}`);

        await debug.addBreakpoint(ref, before);
        const withBp = await debug.getThread(ref);
        add(`breakpoint stored=${withBp?.breakpoints.includes(before)}`);

        const code = await debug.disassemble(ref, before, 4);
        add(`disassembled=${code.length} first=${code[0]?.mnemonic}`);

        const mapping = proc.mappings[0];
        const bytes = await memory.read(proc.pid, mapping.base, 16);
        add(
          `memory bytes=${bytes.byteLength} isU8=${bytes instanceof Uint8Array}`,
        );

        // The scanner is stateful: `next` must narrow what `first` found,
        // which only works if the main process kept the same instance.
        const { scan } = window.exoproc;
        add(`scan target mapping=${mapping.id} size=${mapping.size}`);
        const started = performance.now();
        const first = await Promise.race([
          scan.first(proc.pid, {
            type: 'i32',
            compare: 'unknown',
            mappingIds: [mapping.id],
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('scan.first timed out (60s)')),
              60_000,
            ),
          ),
        ]);
        add(`scan took=${Math.round(performance.now() - started)}ms`);
        add(
          `scan first total=${first.total} page=${first.results.length} truncated=${first.truncated}`,
        );
        const narrowed = await scan.next(proc.pid, { compare: 'unchanged' });
        add(
          `scan next total=${narrowed.total} narrowed=${narrowed.total <= first.total}`,
        );
        if (narrowed.results.length > 0) {
          const probe = narrowed.results[0].address;
          add(
            `scan readValue type=${typeof (await scan.readValue(proc.pid, probe))}`,
          );
        }

        // Worst realistic case: unknown-value scan across every mapping.
        const wideStart = performance.now();
        const wide = await scan.first(proc.pid, {
          type: 'i32',
          compare: 'unknown',
        });
        add(
          `scan wide took=${Math.round(performance.now() - wideStart)}ms total=${wide.total} truncated=${wide.truncated}`,
        );

        // -------------------------------------------------- workspace + fs
        const { workspace, fs } = window.exoproc;

        const emptyInfo = await workspace.bind({ type: 'empty' });
        add(
          `workspace bind empty root=${emptyInfo.rootName} label=${emptyInfo.sourceLabel}`,
        );

        await fs.writeFile(
          '/hello.txt',
          new TextEncoder().encode('persisted?'),
          {
            create: true,
            overwrite: true,
          },
        );
        const readBack = new TextDecoder().decode(
          await fs.readFile('/hello.txt'),
        );
        add(`fs write+read roundtrip=${readBack === 'persisted?'}`);

        const listing = (await fs.readDirectory('/')).map(([name]) => name);
        add(
          `fs readDirectory sees written file=${listing.includes('hello.txt')}`,
        );

        // F9: `machine.fileSystem` is the same in-memory instance for the
        // whole lifetime of this Worker -- `bind({type:'empty'})` only
        // resets the workspace *root* back to `WIN32_WORKSPACE_PATH`
        // (`initializeWorkspace()`), it never clears file content, so this
        // checks that the written file is still there rather than a
        // namespace-swap. Content itself is session-only, not persisted
        // to disk (see `workspace.ts`'s doc comment) -- this only proves
        // it survives a re-bind *within* the same session, not a reload.
        await workspace.bind({ type: 'empty' });
        let persisted = false;
        try {
          await fs.stat('/hello.txt');
          persisted = true;
        } catch {
          persisted = false;
        }
        add(`fs survives a rebind within the same session=${persisted}`);

        // ---------------------------------------- commands + keybindings
        let paletteOpened = 0;
        const cmdDisposable = CommandsRegistry.register({
          id: 'probe.openPalette',
          title: 'Probe: Open Palette',
          handler: () => {
            paletteOpened += 1;
          },
        });
        const keyDisposable = KeybindingsRegistry.register({
          key: 'ctrl+shift+p',
          commandId: 'probe.openPalette',
        });
        const commandService = new CommandService();
        const keybindingService = new KeybindingService(commandService);
        const attachment = keybindingService.attach();

        // A real DOM `KeyboardEvent`, dispatched through the real
        // document listener `attach()` installed -- not a mocked call
        // into the handler, the whole path end to end.
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            code: 'KeyP',
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        add(`keybinding dispatched command=${paletteOpened === 1}`);

        // A non-matching key must not fire it again.
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            code: 'KeyA',
            bubbles: true,
            cancelable: true,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        add(`unrelated key ignored=${paletteOpened === 1}`);

        attachment.dispose();
        cmdDisposable.dispose();
        keyDisposable.dispose();

        // -------------------------------------------------- IFileService
        const fileService = new FileService(getExoprocApi());
        await fileService.bindWorkspace({ type: 'empty' });

        const workspaceEvents: string[] = [];
        const offWorkspace = fileService.onDidChangeWorkspace((info) =>
          workspaceEvents.push(info.sourceLabel),
        );
        const fileEvents: string[] = [];
        const offFiles = fileService.onDidChangeFile((changes) => {
          for (const change of changes)
            fileEvents.push(`${change.kind}:${change.path}`);
        });

        await fileService.writeFileText('/notes/todo.md', '- [ ] ship it');
        const text = await fileService.readFileText('/notes/todo.md');
        add(`IFileService write+read text=${text === '- [ ] ship it'}`);

        const dirEntries = (await fileService.readDirectory('/notes')).map(
          ([n]) => n,
        );
        add(`IFileService readDirectory=${dirEntries.join(',')}`);

        const info = fileService.getWorkspaceInfo();
        add(
          `IFileService getWorkspaceInfo cached=${info?.sourceLabel === 'empty'}`,
        );

        await fileService.rename('/notes/todo.md', '/notes/todo-renamed.md', {
          overwrite: false,
        });
        const renamedText = await fileService.readFileText(
          '/notes/todo-renamed.md',
        );
        add(`IFileService rename roundtrip=${renamedText === '- [ ] ship it'}`);

        await fileService.delete('/notes', { recursive: true });
        let deletedGone = false;
        try {
          await fileService.stat('/notes');
        } catch {
          deletedGone = true;
        }
        add(`IFileService delete removes=${deletedGone}`);

        await fileService.bindWorkspace({ type: 'empty' });
        add(
          `IFileService onDidChangeWorkspace fired=${workspaceEvents.length === 1}`,
        );
        add(`IFileService onDidChangeFile fired=${fileEvents.length > 0}`);

        offWorkspace.dispose();
        offFiles.dispose();

        // ---------------------------------------------------- terminal
        const { terminal } = window.exoproc;
        const session = await terminal.create();
        add(
          `terminal create id=${typeof session.id === 'string' && session.id.length > 0}`,
        );

        let terminalOutput = session.initialOutput;
        const offData = terminal.onData((event) => {
          if (event.sessionId === session.id) terminalOutput += event.chunk;
        });

        // Returned inline as `initialOutput`, not raced through `onData`.
        add(
          `terminal banner received=${terminalOutput.includes('Microsoft Windows')}`,
        );

        await terminal.sendLine(session.id, 'echo hello-from-terminal');
        // `execute()` on the engine side is synchronous, so the reply chunk
        // is already queued -- but it only arrives on the next poll tick
        // (60ms), same as the pre-shell SSE version.
        await new Promise((resolve) => setTimeout(resolve, 300));
        add(
          `terminal echo output=${terminalOutput.includes('hello-from-terminal')}`,
        );

        offData();
        await terminal.dispose(session.id);

        off();
        add('DONE');
      } catch (cause) {
        add(`FAIL ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <pre id="shell-probe">{lines.join('\n')}</pre>;
}
