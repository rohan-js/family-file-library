/**
 * cli_parser.js - Zero-dependency CLI argument parser using node:util.parseArgs.
 */

const { parseArgs } = require('node:util');

const CLI_OPTIONS = {
  tier: { type: 'string', short: 't', default: 'all' },
  feature: { type: 'string', short: 'f' },
  grep: { type: 'string', short: 'g' },
  timeout: { type: 'string', default: '10000' },
  format: { type: 'string', short: 'F', default: 'console' },
  output: { type: 'string', short: 'o' },
  bail: { type: 'boolean', short: 'b', default: false },
  verbose: { type: 'boolean', short: 'v', default: false },
  list: { type: 'boolean', short: 'l', default: false },
  mock: { type: 'boolean', default: false },
  live: { type: 'boolean', default: false },
  'no-color': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

function printHelp() {
  console.log(`
Android TV Family File Library - E2E Test Runner

Usage:
  node tests/e2e/runner.js [options] [test-files...]

Options:
  -t, --tier <tier>          Filter execution by tier: 1, 2, 3, 4, or all [default: all]
  -f, --feature <id>         Filter execution by Feature ID (e.g., F01, F05, F33)
  -g, --grep <pattern>       Filter tests by regex or substring match on test name
      --timeout <ms>         Global per-test timeout in milliseconds [default: 10000]
  -F, --format <format>      Output reporter: console, tap, json, all [default: console]
  -o, --output <path>        Write structured test report to file (for tap or json)
  -b, --bail                 Stop test execution immediately on first failure
  -v, --verbose              Enable verbose test diagnostic logs and assertion diffs
  -l, --list                 List discovered and filtered tests without running them
      --mock                 Force in-memory mock backend mode [default: auto]
      --live                 Force live backend mode (requires SUPABASE_URL & keys)
      --no-color             Disable ANSI terminal colors
  -h, --help                 Display CLI help and exit
`);
}

function parseCliArgs(rawArgs = process.argv.slice(2)) {
  try {
    const { values, positionals } = parseArgs({
      args: rawArgs,
      options: CLI_OPTIONS,
      allowPositionals: true,
      strict: true,
    });

    const timeout = parseInt(values.timeout, 10);
    if (isNaN(timeout) || timeout <= 0) {
      return {
        values: null,
        positionals: null,
        error: new Error(`Invalid --timeout value: "${values.timeout}". Must be positive integer.`),
      };
    }

    const validFormats = ['console', 'tap', 'json', 'all'];
    if (!validFormats.includes(values.format.toLowerCase())) {
      return {
        values: null,
        positionals: null,
        error: new Error(`Invalid --format: "${values.format}". Must be one of: ${validFormats.join(', ')}`),
      };
    }

    return {
      values: {
        ...values,
        timeout,
        format: values.format.toLowerCase(),
      },
      positionals,
      error: null,
    };
  } catch (err) {
    return { values: null, positionals: null, error: err };
  }
}

module.exports = {
  CLI_OPTIONS,
  parseCliArgs,
  printHelp,
};
