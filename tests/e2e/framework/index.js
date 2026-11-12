/**
 * framework/index.js - Public entrypoint and API facade for E2E test framework.
 */

const assert = require('./assert');
const { defaultRegistry, TestRegistry } = require('./test_registry');
const { createContext } = require('./context');
const { executeTest, runTestSuite, MultiReporter } = require('./executor');
const { parseCliArgs, printHelp } = require('./cli_parser');
const { ConsoleReporter } = require('./reporters/console_reporter');
const { TapReporter } = require('./reporters/tap_reporter');
const { JsonReporter } = require('./reporters/json_reporter');

function describe(name, fn) {
  return defaultRegistry.describe(name, fn);
}

function test(name, optsOrFn, maybeFn) {
  return defaultRegistry.test(name, optsOrFn, maybeFn);
}

const it = test;

function beforeAll(fn) {
  return defaultRegistry.beforeAll(fn);
}

function afterAll(fn) {
  return defaultRegistry.afterAll(fn);
}

function beforeEach(fn) {
  return defaultRegistry.beforeEach(fn);
}

function afterEach(fn) {
  return defaultRegistry.afterEach(fn);
}

module.exports = {
  describe,
  test,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  assert,
  defaultRegistry,
  TestRegistry,
  createContext,
  executeTest,
  runTestSuite,
  MultiReporter,
  parseCliArgs,
  printHelp,
  ConsoleReporter,
  TapReporter,
  JsonReporter,
};
