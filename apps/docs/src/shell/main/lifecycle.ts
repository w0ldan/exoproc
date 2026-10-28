import { AppChannel, type AppPathName } from '../common/channels';
import { ipc } from './ipc';

/**
 * Application-level metadata the renderer is allowed to ask for. The
 * paths are simulated-machine paths, not host paths -- the renderer has
 * no notion of a host filesystem and must never be handed one.
 */

const VERSION = '0.0.8';

const PATHS: Record<AppPathName, string> = {
  home: 'C:\\Users\\Serkan',
  temp: 'C:\\Users\\Serkan\\AppData\\Local\\Temp',
  userData: 'C:\\Users\\Serkan\\AppData\\Roaming\\Exoproc',
  workspace: 'C:\\Users\\Serkan\\Workspace',
};

export function registerAppHandlers(): void {
  ipc.handle(AppChannel.getVersion, () => VERSION);

  ipc.handle(AppChannel.getPath, (name: AppPathName) => {
    const path = PATHS[name];
    if (!path) throw new Error(`Unknown application path "${name}".`);
    return path;
  });
}
