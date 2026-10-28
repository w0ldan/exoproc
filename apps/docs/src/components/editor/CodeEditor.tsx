'use client';

import dynamic from 'next/dynamic';
import type { EditorProps } from '@monaco-editor/react';

// Monaco ships its own web workers and touches `window`/`navigator` at module
// load time, so it can never run during Next.js's server render pass --
// `ssr: false` keeps it out of that pass entirely (same reasoning as the
// dynamic `@xterm/xterm` import in Win64Screen.tsx).
const MonacoEditor = dynamic(
  () => import('@monaco-editor/react').then((mod) => mod.Editor),
  {
    ssr: false,
  },
);

export interface CodeEditorProps extends EditorProps {
  height?: string | number;
}

/** Thin wrapper around `@monaco-editor/react`, themed to match the docs site. */
export function CodeEditor({
  height = '320px',
  theme = 'vs-dark',
  options,
  ...props
}: CodeEditorProps) {
  return (
    <div className="my-4 overflow-hidden rounded-lg border">
      <MonacoEditor
        height={height}
        theme={theme}
        options={{ minimap: { enabled: false }, fontSize: 13, ...options }}
        {...props}
      />
    </div>
  );
}

export default CodeEditor;
