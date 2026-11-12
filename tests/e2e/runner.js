#!/usr/bin/env node
/**
 * runner.js - CLI Test Runner for Android TV Family File Library E2E test suite.
 * Pure Node.js built-ins: zero external npm dependencies.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  defaultRegistry,
  parseCliArgs,
  printHelp,
  runTestSuite,
  ConsoleReporter,
  TapReporter,
  JsonReporter,
} = require('./framework');

function findTestFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        findTestFiles(fullPath, fileList);
      }
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (
        (lower.startsWith('test_') || lower.endsWith('_test.js') || lower.endsWith('.test.js')) &&
        lower.endsWith('.js')
      ) {
        fileList.push(fullPath);
      }
    }
  }

  return fileList;
}

async function main() {
  const { values: cliValues, positionals, error: cliError } = parseCliArgs(process.argv.slice(2));

  if (cliError) {
    console.error(`CLI Error: ${cliError.message}`);
    console.error('Use --help for usage instructions.');
    process.exit(2);
  }

  if (cliValues.help) {
    printHelp();
    process.exit(0);
  }

  const e2eDir = path.resolve(__dirname);
  let testFiles = [];

  if (positionals && positionals.length > 0) {
    // Explicit test files supplied via CLI
    for (const p of positionals) {
      const resolved = path.resolve(p);
      if (fs.existsSync(resolved)) {
        if (fs.statSync(resolved).isDirectory()) {
          findTestFiles(resolved, testFiles);
        } else {
          testFiles.push(resolved);
        }
      } else {
        console.error(`Error: Test file or directory not found: ${p}`);
        process.exit(2);
      }
    }
  } else {
    // Auto-discover test files under tests/e2e/
    testFiles = findTestFiles(e2eDir);
    // If no test files found, check for self_test.js in framework
    const selfTest = path.join(e2eDir, 'framework_self_test.js');
    if (testFiles.length === 0 && fs.existsSync(selfTest)) {
      testFiles.push(selfTest);
    }
  }

  // Load all discovered test files
  for (const file of testFiles) {
    try {
      require(file);
    } catch (err) {
      console.error(`Error loading test file "${file}":`, err);
      process.exit(2);
    }
  }

  // Filter tests by tier, feature, grep
  const filteredTests = defaultRegistry.filterTests({
    tier: cliValues.tier,
    feature: cliValues.feature,
    grep: cliValues.grep,
  });

  // Handle --list mode
  if (cliValues.list) {
    console.log(`Discovered ${filteredTests.length} test(s) matching criteria:`);
    for (let i = 0; i < filteredTests.length; i++) {
      const t = filteredTests[i];
      const tierStr = t.tier ? `[Tier ${t.tier}] ` : '';
      const featStr = t.feature ? `[${t.feature}] ` : '';
      console.log(`  ${i + 1}. ${tierStr}${featStr}${t.suiteName} > ${t.name}`);
    }
    process.exit(0);
  }

  if (filteredTests.length === 0) {
    console.log('No tests matched the specified criteria.');
    process.exit(0);
  }

  // Configure reporters
  const reporters = [];
  const format = cliValues.format.toLowerCase();

  if (format === 'console' || format === 'all') {
    reporters.push(new ConsoleReporter({
      verbose: cliValues.verbose,
      noColor: cliValues['no-color'],
    }));
  }

  if (format === 'tap' || format === 'all') {
    reporters.push(new TapReporter({
      outputPath: cliValues.output,
    }));
  }

  if (format === 'json' || format === 'all') {
    reporters.push(new JsonReporter({
      outputPath: cliValues.output,
    }));
  }

  try {
    const summary = await runTestSuite(filteredTests, cliValues, reporters);
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal harness exception during test execution:', err);
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unhandled runner error:', err);
    process.exit(2);
  });
}

module.exports = {
  findTestFiles,
  main,
};
