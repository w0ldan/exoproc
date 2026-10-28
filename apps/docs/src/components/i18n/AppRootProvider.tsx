'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { RootProvider } from 'fumadocs-ui/provider/next';
import {
  i18n,
  localizedPath,
  parseLocalizedPathname,
  LOCALE_COOKIE,
} from '@/lib/i18n';

export interface AppRootProviderProps {
  readonly lang: string;
  readonly children: ReactNode;
}

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Wraps fumadocs' `RootProvider` with a custom `onLocaleChange`, replacing
 * its built-in language-switcher default (`I18nProvider`'s `onChange` in
 * `fumadocs-ui/contexts/i18n.js`). That default assumes the current
 * pathname's first segment IS the active locale (`segments[0] === locale`)
 * and either unshifts or swaps it in place -- true for `hideLocale: 'never'`,
 * but not here: with `hideLocale: 'default-locale'` (see `lib/i18n.ts`),
 * Turkish's pathname never has a leading `/tr` segment at all, and swapping
 * `en` -> `tr` in place produces `/tr/docs/...` instead of stripping the
 * prefix. `parseLocalizedPathname` (`lib/i18n.ts`) strips any existing
 * `en`/`tr` prefix first, then `localizedPath` reapplies the right one for
 * the target locale -- correct in both directions.
 *
 * Also writes the `NEXT_LOCALE` cookie before navigating and does a full
 * `window.location` navigation instead of `router.push`: switching *to*
 * Turkish always lands on a bare path (`localizedPath` hides its prefix),
 * and that bare path is otherwise renegotiated by `Accept-Language` on
 * every request (see `next.config.mjs`'s `rewrites()`) -- so on an
 * English-preferring browser, a soft client navigation to the bare path
 * would just get content-negotiated straight back to English, silently
 * undoing the user's explicit choice (a real reported bug: picking
 * "Türkçe" kept showing English text). A full navigation guarantees the
 * freshly-written cookie is actually present on the request that
 * `rewrites()` evaluates, which `rewrites()` now checks ahead of
 * `Accept-Language` for exactly this reason.
 */
export function AppRootProvider({ lang, children }: AppRootProviderProps) {
  const pathname = usePathname() ?? '/';

  const onLocaleChange = (nextLocale: string) => {
    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
    const { rest } = parseLocalizedPathname(pathname);
    window.location.href = localizedPath(nextLocale, rest);
  };

  return (
    <RootProvider i18n={{ ...i18n.provider(lang), onLocaleChange }}>
      {children}
    </RootProvider>
  );
}
