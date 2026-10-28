/**
 * Side-effect-only aggregator, mirroring VS Code's `vs/workbench/workbench.
 * common.main.ts` (the file that imports every `*.contribution.ts` so their
 * top-level `register*()` calls run before anything renders). Importing
 * this module is what actually populates the view container registry --
 * see `platform/views/viewContainerRegistry.ts`.
 */
import './explorer/explorer.contribution';
import './debug/debug.contribution';
import './snapshots/snapshots.contribution';
// Registers "View: Show X" palette commands from the containers the three
// imports above just registered -- must run after them.
import './view-commands/browser/view-commands.contribution';
