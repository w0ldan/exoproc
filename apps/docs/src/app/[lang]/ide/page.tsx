import { Suspense } from 'react';
import { IdeWorkbench } from '@/components/ide/IdeWorkbench';

export default async function IdePage({
  params,
}: {
  readonly params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-[#1e1e1e] text-sm text-[#929292]">
          {lang === 'en' ? 'Loading IDE…' : 'IDE yükleniyor…'}
        </div>
      }
    >
      <IdeWorkbench lang={lang} />
    </Suspense>
  );
}
