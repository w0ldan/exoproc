import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMDX } from 'fumadocs-mdx/next';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const withMDX = createMDX();

// No-op outside `next dev`; lets local dev access Cloudflare bindings (none
// currently declared beyond ASSETS/the self-reference service) the same way
// they'd be available once deployed via `opennextjs-cloudflare`.
initOpenNextCloudflareForDev();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// @exoproc/simulate and @exoproc/win32-abi are consumed as normal built
// workspace packages (their "main" points at dist/, like every other
// consumer in the monorepo -- see AGENTS.md's "Cross-package src/ imports
// can silently resolve to a stale dist/ build" note: run `bun run build` in
// those packages after changing their source). `bun:ffi` is a Bun built-in
// with no browser equivalent and no npm package to resolve normally, so it's
// aliased to the simulator's own compiled mock implementation of it. Using
// the compiled dist/ file (not the .ts source) avoids relying on Turbopack
// resolving explicit ".js" specifiers to sibling ".ts" files -- a NodeNext
// ESM+TS convention Turbopack doesn't support the way Vite/webpack do.
const bunFfiTarget = path.resolve(
  __dirname,
  '../../packages/simulate/dist/runtime/bun-ffi.js',
);

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // `proxy.ts` (Next.js 16's renamed middleware) was dropped: it's
  // Node.js-runtime-only with no Edge option, which OpenNext Cloudflare
  // doesn't support ("Node.js middleware is not currently supported").
  // It used to hide the default (tr) locale's URL prefix and negotiate
  // a bare `/` by `Accept-Language`; now that's done without middleware
  // (see `rewrites()` below) -- `/` itself just redirects to bare `/docs`
  // (not `/tr`, the separate marketing/home page) and lets that same
  // negotiation decide the language, rather than duplicating it here.
  // `DocsHomeRedirect` then bounces that to wherever
  // `DocsLastVisitedTracker` last recorded, or `getting-started` on a
  // first visit, so the site's actual entry point is the docs reader,
  // not a landing page pretending to be one.
  async rewrites() {
    const cookieIs = (value) => [{ type: 'cookie', key: 'NEXT_LOCALE', value }];
    const englishHas = [
      { type: 'header', key: 'accept-language', value: '^en.*' },
    ];
    const localize = (path) => [
      { source: path, has: cookieIs('en'), destination: `/en${path}` },
      { source: path, has: cookieIs('tr'), destination: `/tr${path}` },
      { source: path, has: englishHas, destination: `/en${path}` },
      { source: path, destination: `/tr${path}` },
    ];
    return [
      { source: '/', has: cookieIs('en'), destination: '/en' },
      { source: '/', has: cookieIs('tr'), destination: '/tr' },
      { source: '/', has: englishHas, destination: '/en' },
      { source: '/', destination: '/tr' },
      ...localize('/docs'),
      ...localize('/docs/:path*'),
      ...localize('/ide'),
      ...localize('/ide/:path*'),
    ];
  },
  turbopack: {
    root: path.resolve(__dirname, '../..'),
    resolveAlias: {
      'bun:ffi': 'win32-simulate/bun-ffi',
    },
  },
  webpack(webpackConfig) {
    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      'bun:ffi': bunFfiTarget,
    };
    return webpackConfig;
  },
};

export default withMDX(config);
