export type X64ExternalRelocationEncoding = 'absolute64' | 'rip-relative32';

export interface X64ExternalRelocation<Target = unknown> {
  readonly offset: number;
  readonly encoding: X64ExternalRelocationEncoding;
  readonly target: Target;
}
