/**
 * fixture_helper.js - Synthetic fixture catalog resolver and inspector.
 */

const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('./crypto_helper');

class FixtureHelper {
  constructor(fixturesDir) {
    this.fixturesDir = fixturesDir || path.resolve(__dirname, '../../fixtures');
    this.manifestPath = path.join(this.fixturesDir, 'fixtures_manifest.json');
    this._manifest = null;
  }

  get manifest() {
    if (!this._manifest) {
      if (fs.existsSync(this.manifestPath)) {
        try {
          this._manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
        } catch {
          this._manifest = null;
        }
      }
    }
    return this._manifest;
  }

  isCatalogReady() {
    return fs.existsSync(this.manifestPath);
  }

  getPath(fixtureName) {
    return path.join(this.fixturesDir, fixtureName);
  }

  exists(fixtureName) {
    return fs.existsSync(this.getPath(fixtureName));
  }

  read(fixtureName) {
    const fullPath = this.getPath(fixtureName);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Fixture "${fixtureName}" not found at ${fullPath}. Run python tests/fixtures/generate_fixtures.py first.`);
    }
    return fs.readFileSync(fullPath);
  }

  readText(fixtureName) {
    return this.read(fixtureName).toString('utf-8');
  }

  getSize(fixtureName) {
    const fullPath = this.getPath(fixtureName);
    return fs.statSync(fullPath).size;
  }

  getSha256(fixtureName) {
    return sha256(this.read(fixtureName));
  }

  getFixtureInfo(fixtureName) {
    if (!this.manifest) return null;
    return this.manifest.fixtures.find((f) => f.name === fixtureName) || null;
  }

  getAllFixtures() {
    if (!this.manifest) return [];
    return this.manifest.fixtures;
  }

  verifyAll() {
    if (!this.manifest) return false;
    for (const item of this.manifest.fixtures) {
      if (!this.exists(item.name)) return false;
      if (this.getSize(item.name) !== item.size_bytes) return false;
    }
    return true;
  }
}

const defaultFixtureHelper = new FixtureHelper();

module.exports = {
  FixtureHelper,
  defaultFixtureHelper,
};
