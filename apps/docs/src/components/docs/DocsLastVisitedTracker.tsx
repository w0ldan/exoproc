'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { DOCS_LAST_VISITED_COOKIE } from '@/lib/docs-last-visited';

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Matches the docs root exactly -- not a real page, just where
 * `DocsHomeRedirect` bounces from -- in any of its three reachable forms:
 * bare `/docs` (Turkish, the hidden-prefix default locale, see
 * `lib/i18n.ts`), or explicitly-prefixed `/tr/docs` / `/en/docs`.
 */
const DOCS_ROOT_PATTERN = /^(?:\/[^/]+)?\/docs$/;

/**
 * Records every *real* docs page visited, so bare `/[lang]/docs` (see
 * `docs/[[...slug]]/page.tsx`) can send the user back to wherever they left
 * off instead of always resetting to `getting-started`.
 *
 * Explicitly skips the bare `/[lang]/docs` path itself: this tracker is
 * mounted in `docs/layout.tsx`, which wraps that route too, so without this
 * guard, landing on bare `/docs` would immediately overwrite the cookie
 * with the bare path -- clobbering the real last-visited page before
 * `DocsHomeRedirect`'s own effect (a sibling, mounted in the same commit)
 * gets a chance to read it. That's a real bug this shipped with once: the
 * redirect used to be a server-side `redirect()` that never rendered this
 * layout's children at all, so the bare path could never reach here; once
 * that became a client-side redirect (`DocsHomeRedirect`, needed to avoid
 * a `next/headers` `cookies()` crash under Cloudflare Workers -- see its
 * own doc comment), this tracker started running for the bare path too and
 * the assumption silently broke.
 */
export function DocsLastVisitedTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || DOCS_ROOT_PATTERN.test(pathname)) return;
    document.cookie = `${DOCS_LAST_VISITED_COOKIE}=${encodeURIComponent(pathname)}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
  }, [pathname]);

  return null;
}
