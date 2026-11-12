/**
 * tap_reporter.js - Standard Test Anything Protocol (TAP) v13 reporter.
 */

const fs = require('node:fs');
const path = require('node:path');

class TapReporter {
  constructor(options = {}) {
    this.outputPath = options.outputPath || null;
    this.lines = [];
    this.testIndex = 0;
  }

  addLine(line) {
    this.lines.push(line);
    if (!this.outputPath) {
      console.log(line);
    }
  }

  onRunStart(plan) {
    this.addLine('TAP version 13');
    this.addLine(`1..${plan.total}`);
  }

  onTestStart() {}

  onTestPass(testDef, durationMs) {
    this.testIndex++;
    const tier = testDef.tier ? `[Tier ${testDef.tier}] ` : '';
    const feat = testDef.feature ? `[${testDef.feature}] ` : '';
    this.addLine(`ok ${this.testIndex} - ${tier}${feat}${testDef.suiteName} > ${testDef.name} # time=${Math.round(durationMs)}ms`);
  }

  onTestFail(testDef, durationMs, error) {
    this.testIndex++;
    const tier = testDef.tier ? `[Tier ${testDef.tier}] ` : '';
    const feat = testDef.feature ? `[${testDef.feature}] ` : '';
    this.addLine(`not ok ${this.testIndex} - ${tier}${feat}${testDef.suiteName} > ${testDef.name} # time=${Math.round(durationMs)}ms`);
    if (error) {
      this.addLine('  ---');
      this.addLine(`  message: ${JSON.stringify(error.message)}`);
      if (error.code) {
        this.addLine(`  code: ${JSON.stringify(error.code)}`);
      }
      this.addLine('  ...');
    }
  }

  onTestSkip(testDef) {
    this.testIndex++;
    const tier = testDef.tier ? `[Tier ${testDef.tier}] ` : '';
    this.addLine(`ok ${this.testIndex} - ${tier}${testDef.suiteName} > ${testDef.name} # SKIP`);
  }

  onRunComplete(summary) {
    this.addLine(`# tests ${summary.total}`);
    this.addLine(`# pass ${summary.passed}`);
    this.addLine(`# fail ${summary.failed}`);
    if (summary.skipped > 0) {
      this.addLine(`# skip ${summary.skipped}`);
    }

    if (this.outputPath) {
      const fullPath = path.resolve(this.outputPath);
      fs.mkdirSync(path.dirname(fullPath), { parents: true, recursive: true });
      fs.writeFileSync(fullPath, this.lines.join('\n') + '\n', 'utf-8');
      console.log(`TAP report written to: ${fullPath}`);
    }
  }
}

module.exports = {
  TapReporter,
};
