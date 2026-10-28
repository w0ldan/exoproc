import type { LucideIcon } from 'lucide-react';

/**
 * Analogue of VS Code's `vs/workbench/common/views.ts` `IViewContainersRegistry`
 * (`Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry)`).
 * A view container is one icon slot in the activity bar; features register
 * their own container as a side effect of importing their `*.contribution.ts`
 * module (see `workbench/contrib/explorer/explorer.contribution.ts` and
 * `workbench/contrib/debug/debug.contribution.ts`), exactly like VS Code's
 * `contrib/<feature>/browser/<feature>.contribution.ts` registration files.
 */
export interface ViewContainerDescriptor {
  readonly id: string;
  readonly title: string | ((lang: string) => string);
  readonly icon: LucideIcon;
  /** Lower sorts first, matching VS Code's activity bar ordering convention. */
  readonly order: number;
  readonly getHref: (lang: string) => string;
  /** `view` is the current `?view=` search param (see `IdeWorkbench`), defaulted to `'explorer'` -- all three IDE views share one route now, so `pathname` alone can no longer tell them apart. */
  readonly isActive: (pathname: string, lang: string, view: string) => boolean;
}

export function getViewContainerTitle(
  container: ViewContainerDescriptor,
  lang: string,
): string {
  return typeof container.title === 'function'
    ? container.title(lang)
    : container.title;
}

const containers = new Map<string, ViewContainerDescriptor>();

/**
 * Overwrites rather than throwing on a repeat `id` -- a `*.contribution.ts`
 * module calls this at top level, so a Turbopack Fast Refresh reload of
 * that module re-runs the call against this same still-alive `containers`
 * map. The identical bug bit `createDecorator` in `platform/instantiation/
 * common/instantiation.ts` for the same reason; overwriting there and here
 * both turn a reload into a no-op update instead of a thrown error.
 */
export function registerViewContainer(
  descriptor: ViewContainerDescriptor,
): void {
  containers.set(descriptor.id, descriptor);
}

export function getViewContainers(): readonly ViewContainerDescriptor[] {
  return [...containers.values()].sort(
    (left, right) => left.order - right.order,
  );
}
