'use client';

import { useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';

interface InstallBoxProps {
  lang: string;
}

const COMMAND = 'powershell -c "irm https://exoproc.woldan.me/install.ps1|iex"';

export function InstallBox({ lang }: InstallBoxProps) {
  const [copied, setCopied] = useState(false);
  const isTr = lang === 'tr';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-neutral-300/80 bg-neutral-100/90 shadow-md backdrop-blur-xl transition-all dark:border-white/10 dark:bg-neutral-950/80 dark:shadow-2xl">
      <div className="relative flex items-center justify-between px-4 py-3 sm:px-5 sm:py-3.5">
        <div className="flex items-center gap-3 font-mono text-xs sm:text-sm text-neutral-700 dark:text-neutral-200 overflow-x-auto select-all">
          <Terminal className="h-4 w-4 text-cyan-600 dark:text-cyan-400 shrink-0 select-none" />
          <span className="tracking-tight text-neutral-950 dark:text-white font-medium whitespace-nowrap">
            {COMMAND}
          </span>
        </div>

        <button
          onClick={handleCopy}
          aria-label="Copy install command"
          className="ml-3 flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300/80 bg-white px-3 text-xs font-medium text-neutral-700 shadow-sm transition-all hover:bg-neutral-50 hover:text-neutral-950 active:scale-95 cursor-pointer dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                {isTr ? 'Kopyalandı' : 'Copied'}
              </span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
              <span>{isTr ? 'Kopyala' : 'Copy'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
