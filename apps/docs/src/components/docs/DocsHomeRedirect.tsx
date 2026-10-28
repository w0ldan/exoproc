'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DOCS_LAST_VISITED_COOKIE } from '@/lib/docs-last-visited';
import { localizedPath } from '@/lib/i18n';

export interface DocsHomeRedirectProps {
  readonly lang: string;
}

/**
 * Renders for bare `/[lang]/docs` (no `index.mdx` in either locale, see
 * `docs/[[...slug]]/page.tsx`). Reads `DocsLastVisitedTracker`'s cookie and
 * replaces to wherever the user left off, or `getting-started` on a first
 * visit / after switching language.
 *
 * Client-side, not a server `redirect()` reading `next/headers`'s
 * `cookies()`: that was the original design, but calling a dynamic API
 * from this route -- which `generateStaticParams` otherwise makes mostly
 * static -- crashed with a Next.js `DYNAMIC_SERVER_USAGE` digest under
 * OpenNext's Cloudflare Workers runtime specifically (never reproduced
 * with a plain `next start`, only surfaced once actually deployed).
 * Keeping the whole page static and doing the redirect after mount here
 * sidesteps that entirely.
 */
export function DocsHomeRedirect({ lang }: DocsHomeRedirectProps) {
  const router = useRouter();

  useEffect(() => {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${DOCS_LAST_VISITED_COOKIE}=([^;]*)`),
    );
    const lastVisited = match ? decodeURIComponent(match[1]) : undefined;
    // Turkish (the hidden-prefix default locale, see `lib/i18n.ts`) records
    // bare paths like `/docs/architecture/overview`, not `/tr/docs/...` --
    // `localizedPath` gives the right prefix (or none) to match against
    // either way.
    const prefix = `${localizedPath(lang, '/docs')}/`;
    const target =
      lastVisited && lastVisited.startsWith(prefix)
        ? lastVisited
        : `${localizedPath(lang, '/docs')}/getting-started`;
    router.replace(target);
  }, [lang, router]);

  return null;
}
