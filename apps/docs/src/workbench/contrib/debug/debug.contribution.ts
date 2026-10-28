import { Bug } from 'lucide-react';
import { registerViewContainer } from '@/platform/views/viewContainerRegistry';
import { localizedPath } from '@/lib/i18n';
import { getIdeTranslations } from '@/lib/ide-i18n';

registerViewContainer({
  id: 'workbench.view.debug',
  title: (lang) => getIdeTranslations(lang).views.debugger,
  icon: Bug,
  order: 1,
  getHref: (lang) => `${localizedPath(lang, '/ide')}?view=debugger`,
  isActive: (pathname, lang, view) =>
    pathname === localizedPath(lang, '/ide') && view === 'debugger',
});
