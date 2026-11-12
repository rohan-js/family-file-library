/**
 * json_reporter.js - Structured JSON reporter for CI artifacts and dashboarding.
 */

const fs = require('node:fs');
const path = require('node:path');

class JsonReporter {
  constructor(options = {}) {
    this.outputPath = options.outputPath || null;
    this.results = [];
  }

  onRunStart() {}
  onTestStart() {}

  onTestPass(testDef, durationMs) {
    this.results.push({
      id: testDef.id,
      name: testDef.name,
      suite: testDef.suiteName,
      tier: testDef.tier,
      feature: testDef.feature,
      status: 'passed',
      durationMs,
      error: null,
    });
  }

  onTestFail(testDef, durationMs, error) {
    this.results.push({
      id: testDef.id,
      name: testDef.name,
      suite: testDef.suiteName,
      tier: testDef.tier,
      feature: testDef.feature,
      status: 'failed',
      durationMs,
      error: {
        message: error.message,
        code: error.code || null,
        stack: error.stack || null,
      },
    });
  }

  onTestSkip(testDef) {
    this.results.push({
      id: testDef.id,
      name: testDef.name,
      suite: testDef.suiteName,
      tier: testDef.tier,
      feature: testDef.feature,
      status: 'skipped',
      durationMs: 0,
      error: null,
    });
  }

  onRunComplete(summary) {
    const report = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      summary: {
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        skipped: summary.skipped,
        durationMs: summary.durationMs,
        exitCode: summary.failed > 0 ? 1 : 0,
        byTier: summary.byTier,
      },
      results: this.results,
    };

    const jsonStr = JSON.stringify(report, null, 2);
    if (this.outputPath) {
      const fullPath = path.resolve(this.outputPath);
      fs.mkdirSync(path.dirname(fullPath), { parents: true, recursive: true });
      fs.writeFileSync(fullPath, jsonStr + '\n', 'utf-8');
      console.log(`JSON report written to: ${fullPath}`);
    } else {
      console.log(jsonStr);
    }
  }
}

module.exports = {
  JsonReporter,
};
