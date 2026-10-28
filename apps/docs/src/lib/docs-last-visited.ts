/**
 * Cookie name shared between `DocsLastVisitedTracker` (writes it client-side
 * on every docs page view) and `docs/[[...slug]]/page.tsx` (reads it
 * server-side to send `/[lang]/docs` back to wherever the user left off,
 * instead of always to `getting-started`).
 */
export const DOCS_LAST_VISITED_COOKIE = 'exoproc-last-docs-page';
