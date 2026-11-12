/**
 * console_reporter.js - ANSI colored human-friendly console reporter.
 */

class ConsoleReporter {
  constructor(options = {}) {
    this.verbose = Boolean(options.verbose);
    this.noColor = Boolean(options.noColor || process.env.NO_COLOR || !process.stdout.isTTY);
    this.currentSuite = null;
  }

  c(colorCode, text) {
    if (this.noColor) return text;
    return `\x1b[${colorCode}m${text}\x1b[0m`;
  }

  green(text) { return this.c('32', text); }
  red(text) { return this.c('31', text); }
  yellow(text) { return this.c('33', text); }
  cyan(text) { return this.c('36', text); }
  dim(text) { return this.c('2', text); }
  bold(text) { return this.c('1', text); }

  onRunStart(plan) {
    console.log(this.bold(`\nRunning ${plan.total} test(s)...`));
  }

  onTestStart(testDef) {
    if (this.currentSuite !== testDef.suiteName) {
      this.currentSuite = testDef.suiteName;
      console.log(`\n${this.bold(this.cyan(this.currentSuite))}`);
    }
  }

  onTestPass(testDef, durationMs) {
    const tierTag = testDef.tier ? this.dim(`[T${testDef.tier}] `) : '';
    const featTag = testDef.feature ? this.cyan(`[${testDef.feature}] `) : '';
    const timeStr = this.dim(`(${Math.round(durationMs)}ms)`);
    console.log(`  ${this.green('✔ PASS')} ${tierTag}${featTag}${testDef.name} ${timeStr}`);
  }

  onTestFail(testDef, durationMs, error) {
    const tierTag = testDef.tier ? this.dim(`[T${testDef.tier}] `) : '';
    const featTag = testDef.feature ? this.cyan(`[${testDef.feature}] `) : '';
    const timeStr = this.dim(`(${Math.round(durationMs)}ms)`);
    console.log(`  ${this.red('✖ FAIL')} ${tierTag}${featTag}${testDef.name} ${timeStr}`);
    if (error) {
      console.log(`    ${this.red('Error:')} ${error.message}`);
      if (this.verbose && error.stack) {
        const indented = error.stack
          .split('\n')
          .slice(1)
          .map((line) => `      ${line}`)
          .join('\n');
        console.log(this.dim(indented));
      }
    }
  }

  onTestSkip(testDef) {
    const tierTag = testDef.tier ? this.dim(`[T${testDef.tier}] `) : '';
    console.log(`  ${this.yellow('- SKIP')} ${tierTag}${testDef.name}`);
  }

  onRunComplete(summary) {
    console.log('\n' + this.bold('='.repeat(65)));
    console.log(this.bold('                    TEST EXECUTION SUMMARY'));
    console.log('='.repeat(65));
    console.log(`  Total Tests:    ${summary.total}`);
    console.log(`  Passed:         ${this.green(String(summary.passed))}`);
    console.log(`  Failed:         ${summary.failed > 0 ? this.red(String(summary.failed)) : '0'}`);
    console.log(`  Skipped:        ${summary.skipped > 0 ? this.yellow(String(summary.skipped)) : '0'}`);
    console.log(`  Duration:       ${(summary.durationMs / 1000).toFixed(2)}s`);
    console.log('-'.repeat(65));

    console.log(this.bold('  Tier Breakdown:'));
    for (let t = 1; t <= 4; t++) {
      const tierData = summary.byTier[`tier${t}`] || { total: 0, passed: 0, failed: 0, skipped: 0 };
      if (tierData.total > 0) {
        const passRate = tierData.total > 0 ? Math.round((tierData.passed / tierData.total) * 100) : 0;
        console.log(
          `    Tier ${t}: ${tierData.passed}/${tierData.total} passed (${passRate}%)`
        );
      }
    }
    console.log('='.repeat(65) + '\n');
  }
}

module.exports = {
  ConsoleReporter,
};
