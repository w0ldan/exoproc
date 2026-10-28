'use client';

import { useState } from 'react';

/* ---------- shared class tokens (one debugger surface, two containers) ---------- */
export const SURFACE = 'bg-[#1e1e1e] text-[#cccccc]';
export const PANEL_BG = 'bg-[#252526]';
export const BORDER = 'border-[#2d2d2d]';
export const MUTED = 'text-[#858585]';
export const INPUT_CLASS =
  'rounded border border-[#3c3c3c] bg-[#3c3c3c] px-1.5 py-1 font-mono text-xs text-[#cccccc] outline-none focus:border-[#007acc]';
export const TOOL_BUTTON_CLASS =
  'flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold text-[#cccccc] hover:bg-[#505050] disabled:cursor-not-allowed disabled:opacity-40';
export const GHOST_BUTTON_CLASS =
  'cursor-pointer rounded border border-[#3c3c3c] px-2 py-1 text-[0.68rem] font-semibold text-[#cccccc] hover:bg-[#3c3c3c] disabled:cursor-not-allowed disabled:opacity-40';

/** Monaco decoration + resize-handle CSS. Rendered once by the debugger root. */
export const DEBUGGER_CSS = `
  .debugger-rip-line { background: rgba(255, 200, 50, 0.12) !important; }
  .debugger-rip-glyph { background: transparent !important; }
  .debugger-rip-glyph::before {
    content: '\\25B6';
    color: #f5c542;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
  .debugger-breakpoint-glyph { background: transparent !important; }
  .debugger-breakpoint-glyph::before {
    content: '\\25CF';
    color: #e51400;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
  .debugger-cursor-line { background: rgba(0, 122, 204, 0.12) !important; }
  .resize-handle-horizontal {
    width: 4px;
    background: transparent;
    transition: background 150ms;
    cursor: col-resize;
  }
  .resize-handle-horizontal:hover,
  .resize-handle-horizontal:active { background: #007acc; }
  .resize-handle-vertical {
    height: 4px;
    background: transparent;
    transition: background 150ms;
    cursor: row-resize;
  }
  .resize-handle-vertical:hover,
  .resize-handle-vertical:active { background: #007acc; }
`;

/**
 * Generic panel tab -- deliberately not styled as a file tab (no filename/extension,
 * no file-type icon). Reads as a plain panel label, similar to an IDE chat-tab strip:
 * a small neutral dot indicator + short truncating text, with a subtle top-border
 * accent on the active tab.
 */
export function PanelTab({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
  badge?: string;
}) {
  const content = (
    <>
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-[#007acc]' : 'bg-[#5a5a5a]'}`}
      />
      <span className="truncate">{label}</span>
      {badge && <span className="tabular-nums opacity-70">{badge}</span>}
    </>
  );
  const className = `flex max-w-[180px] items-center gap-1.5 px-3 py-1.5 font-mono text-[0.72rem] ${
    active
      ? 'border-t-2 border-t-[#007acc] bg-[#1e1e1e] text-[#cccccc]'
      : 'border-t-2 border-t-transparent bg-[#2d2d2d] text-[#858585]'
  }`;
  if (!onClick) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${className} cursor-pointer`}
    >
      {content}
    </button>
  );
}

/* ---------- collapsible sidebar panel ---------- */
export function CollapsiblePanel({
  title,
  badge,
  action,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: string;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`border-b ${BORDER} last:border-b-0`}>
      <div className="flex w-full items-center gap-1.5 bg-[#2d2d2d] px-3 py-2 font-mono text-[0.7rem] font-semibold tracking-wide text-[#858585]">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex flex-1 cursor-pointer items-center gap-1.5 text-left"
        >
          <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>
            &#9654;
          </span>
          <span>{title}</span>
          {badge && <span className="ml-auto tabular-nums">{badge}</span>}
        </button>
        {action}
      </div>
      {open && children}
    </section>
  );
}

/* ---------- toolbar icons ---------- */
const iconProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 16 16',
  fill: 'currentColor',
} as const;

export const ContinueIcon = () => (
  <svg {...iconProps}>
    <path d="M4 2l10 6-10 6V2z" />
  </svg>
);
export const StepOverIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="11" r="2" />
    <path
      d="M2 5h3l3-3 3 3h3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    />
  </svg>
);
export const StepIntoIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="13" r="2" />
    <path
      d="M8 2v8M5 7l3 3 3-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    />
  </svg>
);
export const StepOutIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="13" r="2" />
    <path
      d="M8 10V2M5 5l3-3 3 3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    />
  </svg>
);
export const RunToCursorIcon = () => (
  <svg {...iconProps}>
    <path d="M3 2l7 4-7 4V2z" />
    <path d="M2 14h12" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);
export const TargetIcon = () => (
  <svg {...iconProps}>
    <circle
      cx="8"
      cy="8"
      r="5.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <circle cx="8" cy="8" r="1.6" />
  </svg>
);
