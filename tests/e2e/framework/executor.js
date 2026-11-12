/**
 * executor.js - Async test execution engine with Promise.race and AbortController timeout guards.
 */

const { createContext } = require('./context');

class MultiReporter {
  constructor(reporters = []) {
    this.reporters = reporters;
  }

  onRunStart(plan) {
    for (const r of this.reporters) r.onRunStart?.(plan);
  }

  onTestStart(testDef) {
    for (const r of this.reporters) r.onTestStart?.(testDef);
  }

  onTestPass(testDef, durationMs) {
    for (const r of this.reporters) r.onTestPass?.(testDef, durationMs);
  }

  onTestFail(testDef, durationMs, error) {
    for (const r of this.reporters) r.onTestFail?.(testDef, durationMs, error);
  }

  onTestSkip(testDef) {
    for (const r of this.reporters) r.onTestSkip?.(testDef);
  }

  onRunComplete(summary) {
    for (const r of this.reporters) r.onRunComplete?.(summary);
  }
}

async function executeTest(testDef, config, reporter) {
  const timeoutMs = testDef.timeout || config.timeout || 10000;
  const ac = new AbortController();
  const ctx = createContext(testDef, ac.signal, config);

  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      ac.abort();
      const err = new Error(`Test timed out after ${timeoutMs}ms limit`);
      err.code = 'ERR_TEST_TIMEOUT';
      reject(err);
    }, timeoutMs);
  });

  const startTime = performance.now();
  try {
    reporter.onTestStart(testDef);
    await Promise.race([Promise.resolve(testDef.fn(ctx)), timeoutPromise]);
    const durationMs = performance.now() - startTime;
    reporter.onTestPass(testDef, durationMs);
    return { status: 'passed', durationMs, error: null };
  } catch (err) {
    const durationMs = performance.now() - startTime;
    reporter.onTestFail(testDef, durationMs, err);
    return { status: 'failed', durationMs, error: err };
  } finally {
    clearTimeout(timerId);
  }
}

async function runTestSuite(tests, config = {}, reporters = []) {
  const reporter = new MultiReporter(reporters);
  const plan = { total: tests.length };
  reporter.onRunStart(plan);

  const summary = {
    total: tests.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
    byTier: {
      tier1: { total: 0, passed: 0, failed: 0, skipped: 0 },
      tier2: { total: 0, passed: 0, failed: 0, skipped: 0 },
      tier3: { total: 0, passed: 0, failed: 0, skipped: 0 },
      tier4: { total: 0, passed: 0, failed: 0, skipped: 0 },
    },
  };

  const suiteStartTime = performance.now();
  let bailTriggered = false;

  for (const testDef of tests) {
    const tierKey = `tier${testDef.tier || 1}`;
    if (!summary.byTier[tierKey]) {
      summary.byTier[tierKey] = { total: 0, passed: 0, failed: 0, skipped: 0 };
    }
    summary.byTier[tierKey].total++;

    if (bailTriggered || testDef.skip) {
      summary.skipped++;
      summary.byTier[tierKey].skipped++;
      reporter.onTestSkip(testDef);
      continue;
    }

    const result = await executeTest(testDef, config, reporter);
    if (result.status === 'passed') {
      summary.passed++;
      summary.byTier[tierKey].passed++;
    } else {
      summary.failed++;
      summary.byTier[tierKey].failed++;
      if (config.bail) {
        bailTriggered = true;
      }
    }
  }

  summary.durationMs = performance.now() - suiteStartTime;
  reporter.onRunComplete(summary);

  return summary;
}

module.exports = {
  MultiReporter,
  executeTest,
  runTestSuite,
};
