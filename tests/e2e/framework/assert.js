/**
 * assert.js - Domain assertion library extending node:assert/strict.
 */

const baseAssert = require('node:assert/strict');

const customAssert = Object.create(baseAssert);

/**
 * Asserts HTTP response status code.
 * @param {object} res - Response object with status or statusCode property
 * @param {number} expectedStatus - Expected HTTP status code
 * @param {string} [message] - Optional failure message
 */
customAssert.status = function status(res, expectedStatus, message) {
  const actualStatus = res && typeof res.status === 'number' ? res.status : res?.statusCode;
  const msg = message || `Expected HTTP status ${expectedStatus}, got ${actualStatus}`;
  baseAssert.strictEqual(actualStatus, expectedStatus, msg);
};

/**
 * Asserts that a numeric value falls within inclusive [min, max] range.
 * @param {number} actual - Number to test
 * @param {number} min - Minimum inclusive value
 * @param {number} max - Maximum inclusive value
 * @param {string} [message] - Optional failure message
 */
customAssert.inRange = function inRange(actual, min, max, message) {
  const msg = message || `Expected ${actual} to be within range [${min}, ${max}]`;
  baseAssert.ok(actual >= min && actual <= max, msg);
};

/**
 * Asserts that a string matches a regular expression or pattern.
 * @param {string} actual - String to test
 * @param {RegExp|string} pattern - Pattern to test against
 * @param {string} [message] - Optional failure message
 */
customAssert.match = function match(actual, pattern, message) {
  baseAssert.match(String(actual), pattern instanceof RegExp ? pattern : new RegExp(pattern), message);
};

/**
 * Asserts that an object matches an expected schema shape.
 * @param {object} obj - Object to validate
 * @param {object} schema - Schema mapping keys to expected types (e.g. { id: 'string', count: 'number' })
 * @param {string} [message] - Optional failure message
 */
customAssert.hasShape = function hasShape(obj, schema, message) {
  baseAssert.ok(obj && typeof obj === 'object', message || 'Expected value to be an object');
  for (const [key, expectedType] of Object.entries(schema)) {
    const actualValue = obj[key];
    const actualType = typeof actualValue;
    if (expectedType.endsWith('?')) {
      const baseType = expectedType.slice(0, -1);
      if (actualValue !== undefined && actualValue !== null) {
        baseAssert.strictEqual(
          actualType,
          baseType,
          message || `Field "${key}" expected type "${baseType}", got "${actualType}"`
        );
      }
    } else {
      baseAssert.ok(
        actualValue !== undefined,
        message || `Required field "${key}" is missing from object`
      );
      baseAssert.strictEqual(
        actualType,
        expectedType,
        message || `Field "${key}" expected type "${expectedType}", got "${actualType}"`
      );
    }
  }
};

/**
 * Asserts that a file byte size is within allowed maximum.
 * @param {number} sizeBytes - Actual byte count
 * @param {number} maxBytes - Allowed maximum bytes
 * @param {string} [message] - Optional failure message
 */
customAssert.fileSizeWithin = function fileSizeWithin(sizeBytes, maxBytes, message) {
  const msg = message || `File size ${sizeBytes} bytes exceeds maximum allowed ${maxBytes} bytes`;
  baseAssert.ok(sizeBytes <= maxBytes, msg);
};

module.exports = customAssert;
