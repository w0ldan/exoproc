/**
 * Exoproc JIT C-Define abstraction library
 */

export interface CDefineOptions {
  noSeparator?: boolean;
  separator?: string;
}

export interface CDefineGroup {
  readonly _isCDefineGroup: boolean;
  _cDefines: Record<string, number | bigint>;
  _options?: CDefineOptions;
  combine(...flags: (number | bigint)[]): number;
}

export function cdefines<
  const T extends Record<string, any>,
  P extends string = '',
>(
  mapping: T,
  prefixOrSeparator?: P | CDefineOptions,
  options?: CDefineOptions,
): T & CDefineGroup {
  const resolvedJS: any = {};
  const resolvedC: Record<string, number | bigint> = {};

  let prefix: string | undefined = undefined;
  let localOptions = options ?? {};

  if (typeof prefixOrSeparator === 'string') {
    // If it's a single non-alphanumeric character, treat it as a separator shorthand
    if (/^[^a-zA-Z0-9]$/.test(prefixOrSeparator)) {
      localOptions = { ...localOptions, separator: prefixOrSeparator };
    } else {
      prefix = prefixOrSeparator;
    }
  } else if (prefixOrSeparator && typeof prefixOrSeparator === 'object') {
    localOptions = prefixOrSeparator;
  }

  const separator = localOptions.noSeparator
    ? ''
    : (localOptions.separator ?? '_');
  const prefixStr = prefix ? `${prefix}${separator}` : '';

  for (const [key, val] of Object.entries(mapping)) {
    if (val && typeof val === 'object' && val._isCDefineGroup) {
      // Recursive nesting of a child CDefineGroup - automatically prepends parent prefix and key
      const nestedGroup = val;
      const newCDefines: Record<string, number | bigint> = {};
      const childSep = nestedGroup._options?.noSeparator
        ? ''
        : (nestedGroup._options?.separator ?? '');
      const parentAndKeyPrefix = prefixStr
        ? `${prefixStr}${key}${childSep}`
        : `${key}${childSep}`;

      for (const [subCKey, subCVal] of Object.entries(nestedGroup._cDefines)) {
        const combinedCKey = `${parentAndKeyPrefix}${subCKey}`;
        newCDefines[combinedCKey] = subCVal as any;
      }
      nestedGroup._cDefines = newCDefines;
      resolvedJS[key] = nestedGroup;
    } else {
      // Primitive constant
      const cKey = `${prefixStr}${key}`;
      resolvedJS[key] = val;
      resolvedC[cKey] = val;
    }
  }

  return Object.assign(resolvedJS, {
    _isCDefineGroup: true,
    _cDefines: resolvedC,
    _options: localOptions,
    combine(...flags: (number | bigint)[]): number {
      let result = 0;
      for (const flag of flags) {
        result |= Number(flag);
      }
      return result;
    },
  });
}

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

type LastOfUnion<U> =
  UnionToIntersection<U extends any ? (f: U) => void : never> extends (
    a: infer A,
  ) => void
    ? A
    : never;

type UnionToTuple<U, Last = LastOfUnion<U>> = [U] extends [never]
  ? []
  : [Last, ...UnionToTuple<Exclude<U, Last>>];

type TupleOfLength<N extends number, Acc extends any[] = []> = `${N}` extends
  `-${string}` | `${string}.${string}`
  ? any[]
  : Acc['length'] extends N
    ? Acc
    : TupleOfLength<N, [...Acc, any]>;

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

type DigitToNumber = {
  '0': 0;
  '1': 1;
  '2': 2;
  '3': 3;
  '4': 4;
  '5': 5;
  '6': 6;
  '7': 7;
  '8': 8;
  '9': 9;
};

type SplitSum<N extends number> = N extends 0
  ? ['0', 0]
  : N extends 1
    ? ['1', 0]
    : N extends 2
      ? ['2', 0]
      : N extends 3
        ? ['3', 0]
        : N extends 4
          ? ['4', 0]
          : N extends 5
            ? ['5', 0]
            : N extends 6
              ? ['6', 0]
              : N extends 7
                ? ['7', 0]
                : N extends 8
                  ? ['8', 0]
                  : N extends 9
                    ? ['9', 0]
                    : N extends 10
                      ? ['0', 1]
                      : N extends 11
                        ? ['1', 1]
                        : N extends 12
                          ? ['2', 1]
                          : N extends 13
                            ? ['3', 1]
                            : N extends 14
                              ? ['4', 1]
                              : N extends 15
                                ? ['5', 1]
                                : N extends 16
                                  ? ['6', 1]
                                  : N extends 17
                                    ? ['7', 1]
                                    : N extends 18
                                      ? ['8', 1]
                                      : N extends 19
                                        ? ['9', 1]
                                        : never;

type AddDigits<A extends Digit, B extends Digit, C extends 0 | 1> = SplitSum<
  [
    ...TupleOfLength<DigitToNumber[A]>,
    ...TupleOfLength<DigitToNumber[B]>,
    ...TupleOfLength<C>,
  ]['length'] &
    number
>;

type StringToChars<S extends string> = S extends `${infer Char}${infer Rest}`
  ? [Char, ...StringToChars<Rest>]
  : [];

type CharsToString<T extends any[], Acc extends string = ''> = T extends [
  infer Head extends string,
  ...infer Tail,
]
  ? CharsToString<Tail, `${Acc}${Head}`>
  : Acc;

type AddChars<
  C1 extends any[],
  C2 extends any[],
  Carry extends 0 | 1 = 0,
  Acc extends string[] = [],
> = C1 extends []
  ? C2 extends []
    ? Carry extends 1
      ? ['1', ...Acc]
      : Acc
    : AddChars_OneLeft<C2, Carry, Acc>
  : C2 extends []
    ? AddChars_OneLeft<C1, Carry, Acc>
    : C1 extends [...infer Init1, infer Last1 extends Digit]
      ? C2 extends [...infer Init2, infer Last2 extends Digit]
        ? AddDigits<Last1, Last2, Carry> extends [
            infer SumDigit extends string,
            infer NewCarry extends 0 | 1,
          ]
          ? AddChars<Init1, Init2, NewCarry, [SumDigit, ...Acc]>
          : never
        : never
      : never;

type AddChars_OneLeft<
  C extends any[],
  Carry extends 0 | 1,
  Acc extends string[],
> = C extends []
  ? Carry extends 1
    ? ['1', ...Acc]
    : Acc
  : C extends [...infer Init, infer Last extends Digit]
    ? AddDigits<Last, '0', Carry> extends [
        infer SumDigit extends string,
        infer NewCarry extends 0 | 1,
      ]
      ? AddChars_OneLeft<Init, NewCarry, [SumDigit, ...Acc]>
      : never
    : never;

type StringToNumber<S extends string> = S extends `${infer N extends number}`
  ? N
  : never;

type Add<A extends number, B extends number> = StringToNumber<
  CharsToString<AddChars<StringToChars<`${A}`>, StringToChars<`${B}`>>>
>;

type AddToEach<N extends number, U extends number> = U extends any
  ? Add<N, U>
  : never;

type SubsetSums<T extends any[]> = T extends [
  infer Head extends number,
  ...infer Tail,
]
  ? SubsetSums<Tail> | AddToEach<Head, SubsetSums<Tail>>
  : 0;

type SubsetSumsSafe<T extends any[]> = T['length'] extends
  0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  ? SubsetSums<T>
  : number;

/**
 * Utility type to extract the exact strict union of literal constant values from a CDefineGroup.
 * Useful for strict enums where combinations are not allowed.
 */
export type CDefineStrictUnion<T> = T[Exclude<
  keyof T,
  '_isCDefineGroup' | '_cDefines' | '_options' | 'combine'
>];

/**
 * Utility type to extract the set of all valid bitwise combinations of constants in a CDefineGroup.
 * Supports an optional second template parameter `Strict extends boolean = false`.
 * - When `false` (default): Mathematically computes all possible valid bitwise combinations for small groups (<= 8 flags), so `5` is valid for `4 | 1`, but `6` is not.
 * - When `true`: Strictly allows only individual, uncombined constant literals (e.g. `1` or `4` is allowed, but `5` is rejected).
 * Fallbacks safely to `number` or `bigint` for larger or negative flag groups.
 */
export type CDefineValueType<
  T,
  Strict extends boolean = false,
> = Strict extends true
  ? CDefineStrictUnion<T>
  : CDefineStrictUnion<T> extends bigint
    ? bigint
    : 0 extends CDefineStrictUnion<T>
      ? SubsetSumsSafe<UnionToTuple<Exclude<CDefineStrictUnion<T>, 0>>>
      : Exclude<
          SubsetSumsSafe<UnionToTuple<Exclude<CDefineStrictUnion<T>, 0>>>,
          0
        >;
