'use client';

import { useRef, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { BookOpenText, Home, Settings } from 'lucide-react';
import '@/workbench/contrib';
import {
  getViewContainers,
  getViewContainerTitle,
} from '@/platform/views/viewContainerRegistry';
import { localizedPath } from '@/lib/i18n';
import { useIdeTranslation } from '@/lib/ide-i18n';

interface IdeActivityBarProps {
  readonly lang: string;
}

/**
 * VS Code's activity bar: one icon per registered view container (see
 * `platform/views/viewContainerRegistry.ts` -- populated by the
 * `workbench/contrib/*.contribution.ts` side-effect imports above, not a
 * hardcoded array), a `tablist`/`tab` ARIA structure with left/right... er,
 * up/down arrow-key navigation between icons, and a bottom section for
 * global actions (Home, Docs, Settings) below the view containers, same layering VS
 * Code uses (`.actions-container` top, `.global-activity` bottom).
 */
export function IdeActivityBar({ lang }: IdeActivityBarProps) {
  const { t } = useIdeTranslation(lang);
  const pathname = usePathname() ?? '';
  // All three IDE views now share one route (`/ide`, see `IdeWorkbench`),
  // told apart by this `?view=` search param -- see `ViewContainerDescriptor.isActive`'s doc comment.
  const view = useSearchParams().get('view') ?? 'explorer';
  const containers = getViewContainers();
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const homeHref = localizedPath(lang, '/');
  const isHome =
    pathname === '/' ||
    pathname === `/${lang}` ||
    pathname === `/${lang}/` ||
    pathname === homeHref;

  const focusItem = (index: number) => {
    const target =
      itemRefs.current[(index + containers.length) % containers.length];
    target?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLAnchorElement>,
    index: number,
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(containers.length - 1);
    }
  };

  return (
    <aside
      aria-label="IDE activity bar"
      // Hidden below `md`: phones only ever read docs here (no room to
      // usefully browse code or drive a debugger), so the IDE views this
      // bar switches between have no reason to be reachable -- see
      // `[lang]/layout.tsx`'s doc comment. Purely a `hidden md:flex` CSS
      // toggle, not `useIsMobile`-driven, so there's no client-only
      // hydration flash before JS decides whether to show it.
      className="sticky top-0 z-60 hidden h-dvh w-13 shrink-0 flex-col border-r border-neutral-200 bg-[#f8f9fa] text-neutral-500 transition-colors dark:border-white/10 dark:bg-[#181818] dark:text-[#9d9d9d] md:flex"
    >
      <nav
        role="tablist"
        aria-label={t.activityBar.viewsAria}
        aria-orientation="vertical"
        className="flex flex-1 flex-col"
      >
        {containers.map((container, index) => {
          const Icon = container.icon;
          const selected = container.isActive(pathname, lang, view);
          const title = getViewContainerTitle(container, lang);
          return (
            <Link
              key={container.id}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              href={container.getHref(lang)}
              role="tab"
              aria-selected={selected}
              aria-label={title}
              title={title}
              tabIndex={selected ? 0 : -1}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`relative flex h-12.5 items-center justify-center transition-colors hover:text-neutral-900 focus-visible:text-neutral-900 focus-visible:outline-none dark:hover:text-white dark:focus-visible:text-white ${
                selected ? 'text-neutral-900 dark:text-white' : ''
              }`}
            >
              {selected && (
                <span className="absolute inset-y-0 left-0 w-0.5 bg-[#007acc]" />
              )}
              <Icon className="size-6" strokeWidth={1.7} aria-hidden="true" />
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col border-t border-neutral-200 dark:border-white/10">
        <Link
          href={homeHref}
          aria-label={t.activityBar.home}
          title={t.activityBar.home}
          className={`relative flex h-12.5 items-center justify-center transition-colors hover:text-neutral-900 dark:hover:text-white ${
            isHome ? 'text-neutral-900 dark:text-white' : ''
          }`}
        >
          {isHome && (
            <span className="absolute inset-y-0 left-0 w-0.5 bg-[#007acc]" />
          )}
          <Home className="size-6" strokeWidth={1.7} aria-hidden="true" />
        </Link>
        <Link
          href={localizedPath(lang, '/docs')}
          aria-label={t.activityBar.docs}
          title={t.activityBar.docs}
          className={`relative flex h-12.5 items-center justify-center transition-colors hover:text-neutral-900 dark:hover:text-white ${
            pathname.startsWith(localizedPath(lang, '/docs'))
              ? 'text-neutral-900 dark:text-white'
              : ''
          }`}
        >
          {pathname.startsWith(localizedPath(lang, '/docs')) && (
            <span className="absolute inset-y-0 left-0 w-0.5 bg-[#007acc]" />
          )}
          <BookOpenText
            className="size-6"
            strokeWidth={1.7}
            aria-hidden="true"
          />
        </Link>
        {/* Placeholder, matching VS Code's activity bar bottom "Manage"/Settings
         * slot visually -- no settings surface exists in this IDE yet. */}
        <button
          type="button"
          aria-label={t.activityBar.settings}
          title={t.activityBar.settings}
          disabled
          className="flex h-12.5 items-center justify-center opacity-40 text-neutral-500 dark:text-[#9d9d9d]"
        >
          <Settings className="size-6" strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

export default IdeActivityBar;
