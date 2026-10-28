import { Suspense } from 'react';
import '../global.css';
import { Inter } from 'next/font/google';
import { AppRootProvider } from '@/components/i18n/AppRootProvider';
import { i18n } from '@/lib/i18n';
import { IdeActivityBar } from '@/components/ide/IdeActivityBar';
import { TooltipProvider } from '@/components/ui/tooltip';

// `IdeActivityBar` reads `useSearchParams()` (to tell the three IDE views
// apart now that they share one route, see `IdeWorkbench`) -- Next.js
// requires a Suspense boundary around that so pages that *are* statically
// prerendered (the docs pages this same activity bar renders on) don't
// deopt to fully dynamic rendering. The fallback matches the real bar's
// width/background (and its `hidden md:flex` -- see `IdeActivityBar`'s
// own doc comment for why it's hidden on phones) exactly to avoid any
// layout shift.
function ActivityBarFallback() {
  return (
    <aside
      aria-hidden="true"
      className="sticky top-0 z-60 hidden h-dvh w-13 shrink-0 border-r border-neutral-200 bg-[#f8f9fa] dark:border-white/10 dark:bg-[#181818] md:block"
    />
  );
}

const inter = Inter({
  subsets: ['latin'],
});

export default async function Layout({
  params,
  children,
}: LayoutProps<'/[lang]'>) {
  const { lang } = await params;

  return (
    <html lang={lang} className={inter.className} suppressHydrationWarning>
      <body className="min-h-screen">
        <AppRootProvider lang={lang}>
          <TooltipProvider>
            <div className="flex min-h-screen">
              <Suspense fallback={<ActivityBarFallback />}>
                <IdeActivityBar lang={lang} />
              </Suspense>
              <div className="min-w-0 flex-1">{children}</div>
            </div>
          </TooltipProvider>
        </AppRootProvider>
      </body>
    </html>
  );
}

export async function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}
