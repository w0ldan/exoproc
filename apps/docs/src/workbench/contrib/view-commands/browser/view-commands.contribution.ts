import { CommandsRegistry } from '@/platform/commands/common/commands';
import {
  getViewContainers,
  getViewContainerTitle,
} from '@/platform/views/viewContainerRegistry';
import { parseLocalizedPathname } from '@/lib/i18n';
import { getIdeTranslations } from '@/lib/ide-i18n';

/**
 * Registers one "View: Show X" command per view container, generated
 * from `viewContainerRegistry` rather than hand-listed -- the same
 * relationship VS Code's palette has to its own registered views. Adding
 * a new view container (a new `*.contribution.ts` importing
 * `registerViewContainer`) makes it searchable in the Command Palette
 * with no extra step.
 *
 * Navigation is a plain `window.location.assign`, not the Next.js
 * router's soft navigation -- a command handler is a bare function with
 * no React context to pull `useRouter()` from, and this workbench has
 * exactly two views, so the cost of a full navigation here is not worth
 * threading a router reference through command registration to avoid.
 */
function currentLang(): string {
  return parseLocalizedPathname(window.location.pathname).lang;
}

for (const container of getViewContainers()) {
  CommandsRegistry.register({
    id: `workbench.view.${container.id}`,
    title: (lang) => {
      const vTitle = getViewContainerTitle(container, lang);
      return getIdeTranslations(lang).commandPalette.viewShow(vTitle);
    },
    handler: () => {
      window.location.assign(container.getHref(currentLang()));
    },
  });
}
