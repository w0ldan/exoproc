/**
 * Core type definitions for @exoproc/njava-nashorn
 */

export interface NashornTemplateOptions {
  globalName?: string;
  mappings?: Record<string, string>; // canonicalClass -> obfClass
  fieldMappings?: Record<string, Record<string, string>>; // class -> (canonicalField -> obfField)
  methodMappings?: Record<string, Record<string, string>>; // class -> (canonicalMethod -> obfMethod)
  pool?: {
    getAllDetected?: () => Array<{
      canonicalName: string;
      simpleName?: string;
      realClassName: string;
      fields?: Record<string, string>;
      methods?: Record<string, string>;
    }>;
  };
  includePolyfills?: boolean;
  onUnmapped?: 'warn' | 'throw' | 'passthrough';
  customHeader?: string;
  customClasses?: Record<string, any>;
}
