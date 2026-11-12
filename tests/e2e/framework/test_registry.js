/**
 * test_registry.js - Hierarchical and flat test suite registry.
 */

class TestRegistry {
  constructor() {
    this.suites = [];
    this.currentSuite = null;
    this.allTests = [];
    this.hooks = {
      beforeAll: [],
      afterAll: [],
      beforeEach: [],
      afterEach: [],
    };
  }

  reset() {
    this.suites = [];
    this.currentSuite = null;
    this.allTests = [];
    this.hooks = {
      beforeAll: [],
      afterAll: [],
      beforeEach: [],
      afterEach: [],
    };
  }

  describe(name, fn) {
    const parentSuite = this.currentSuite;
    const suite = {
      name,
      parent: parentSuite,
      suites: [],
      tests: [],
      hooks: {
        beforeAll: [],
        afterAll: [],
        beforeEach: [],
        afterEach: [],
      },
    };

    if (parentSuite) {
      parentSuite.suites.push(suite);
    } else {
      this.suites.push(suite);
    }

    this.currentSuite = suite;
    try {
      fn();
    } finally {
      this.currentSuite = parentSuite;
    }
  }

  test(name, optsOrFn, maybeFn) {
    let opts = {};
    let fn = maybeFn;

    if (typeof optsOrFn === 'function') {
      fn = optsOrFn;
    } else if (typeof optsOrFn === 'object' && optsOrFn !== null) {
      opts = optsOrFn;
    }

    if (typeof fn !== 'function') {
      throw new Error(`Test "${name}" must provide a function implementation.`);
    }

    const suite = this.currentSuite;
    const suiteName = suite ? suite.name : 'Default Suite';
    const tier = opts.tier !== undefined ? Number(opts.tier) : (suite?.tier || 1);
    const feature = opts.feature || suite?.feature || null;
    const timeout = opts.timeout ? Number(opts.timeout) : null;

    const testItem = {
      id: `${suiteName} > ${name}`,
      name,
      suiteName,
      suite,
      tier,
      feature,
      timeout,
      fn,
      skip: Boolean(opts.skip),
      only: Boolean(opts.only),
    };

    if (suite) {
      suite.tests.push(testItem);
    }
    this.allTests.push(testItem);
  }

  beforeAll(fn) {
    if (this.currentSuite) {
      this.currentSuite.hooks.beforeAll.push(fn);
    } else {
      this.hooks.beforeAll.push(fn);
    }
  }

  afterAll(fn) {
    if (this.currentSuite) {
      this.currentSuite.hooks.afterAll.push(fn);
    } else {
      this.hooks.afterAll.push(fn);
    }
  }

  beforeEach(fn) {
    if (this.currentSuite) {
      this.currentSuite.hooks.beforeEach.push(fn);
    } else {
      this.hooks.beforeEach.push(fn);
    }
  }

  afterEach(fn) {
    if (this.currentSuite) {
      this.currentSuite.hooks.afterEach.push(fn);
    } else {
      this.hooks.afterEach.push(fn);
    }
  }

  filterTests(filters = {}) {
    const { tier, feature, grep } = filters;
    let filtered = [...this.allTests];

    // Tier filtering
    if (tier && tier !== 'all') {
      const targetTier = parseInt(tier, 10);
      filtered = filtered.filter((t) => t.tier === targetTier);
    }

    // Feature filtering (e.g. F01, F05)
    if (feature) {
      const targetFeat = feature.toUpperCase();
      filtered = filtered.filter((t) => {
        if (t.feature && t.feature.toUpperCase() === targetFeat) return true;
        if (t.name.toUpperCase().includes(targetFeat)) return true;
        if (t.suiteName.toUpperCase().includes(targetFeat)) return true;
        return false;
      });
    }

    // Grep regex or substring filtering
    if (grep) {
      let regex;
      try {
        regex = new RegExp(grep, 'i');
      } catch {
        regex = new RegExp(grep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
      filtered = filtered.filter((t) => regex.test(t.name) || regex.test(t.suiteName));
    }

    // Handle .only if present
    const onlyTests = filtered.filter((t) => t.only);
    if (onlyTests.length > 0) {
      return onlyTests;
    }

    return filtered;
  }
}

const defaultRegistry = new TestRegistry();

module.exports = {
  TestRegistry,
  defaultRegistry,
};
