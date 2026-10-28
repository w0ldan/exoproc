/**
 * Translates between the renderer-facing channel path convention
 * (workspace-relative, POSIX-style, e.g. `/src/index.ts`, unchanged since
 * F3/F7a) and `Win32FileSystem`'s own absolute `C:\...` convention -- the
 * one real filesystem everything (Explorer/Editor, `cmd.exe`, `node.exe`)
 * reads and writes as of F9. Every consumer that needs to touch
 * `machine.fileSystem` on behalf of a channel path goes through these two
 * functions so the translation only needs writing once.
 *
 * `root` is the current workspace root's absolute Windows path -- NOT a
 * fixed constant. `workspace.ts`'s `getWorkspaceRoot()` starts at
 * `WIN32_WORKSPACE_PATH` (the default, session-only location -- see that
 * module's doc comment for why nothing here persists on its own) but can
 * point anywhere
 * else in `Win32FileSystem` after the user picks a different folder from
 * the simulate tree, or imports a `.zip` (see `SimulateFolderPicker.tsx` /
 * `WorkspaceSource`'s `simulate-path`/`zip` variants) -- channel-relative
 * paths always resolve against whichever root is current, so Explorer/
 * Editor/the terminal's `dir` all follow the same rebind without needing
 * to know it happened.
 */

export function toWindowsPath(path: string, root: string): string {
  const trimmed = path.startsWith('/') ? path.slice(1) : path;
  return trimmed ? `${root}\\${trimmed.replace(/\//g, '\\')}` : root;
}

export function toChannelPath(windowsPath: string, root: string): string {
  const prefix = `${root}\\`;
  const relative = windowsPath.startsWith(prefix)
    ? windowsPath.slice(prefix.length)
    : windowsPath;
  return `/${relative.replace(/\\/g, '/')}`;
}
