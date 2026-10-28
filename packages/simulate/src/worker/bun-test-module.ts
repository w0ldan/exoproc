import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  mock,
  suite,
  test,
} from 'node:test';
import { expect } from 'expect';

export {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  suite,
  test,
};

/** Bun names Node's suite-level hooks `beforeAll` and `afterAll`. */
export const beforeAll = before;
export const afterAll = after;
