import type { ModifierInput } from './modifiers.js';

export interface JavaFieldDef {
  modifiers?: ModifierInput;
  type: string;
  name: string;
  initialValue?: string;
}

export interface JavaParamDef {
  type: string;
  name: string;
}

export interface JavaConstructorDef {
  modifiers?: ModifierInput;
  params?: Record<string, string> | JavaParamDef[];
  throws?: string[];
  body: string;
}

export interface JavaMethodDef {
  annotations?: string[];
  modifiers?: ModifierInput;
  returns?: string;
  name: string;
  params?: Record<string, string> | JavaParamDef[];
  throws?: string[];
  body: string;
}

export interface JavaClassDef {
  package?: string;
  imports?: string[];
  annotations?: string[];
  modifiers?: ModifierInput;
  name: string;
  extends?: string;
  implements?: string | string[];
  fields?: Record<string, string | JavaFieldDef> | JavaFieldDef[];
  constructors?: JavaConstructorDef[];
  methods?: Record<string, string | JavaMethodDef> | JavaMethodDef[];
  innerClasses?: JavaClassDef[];
  rawMembers?: string[];
}
