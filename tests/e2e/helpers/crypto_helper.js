/**
 * crypto_helper.js - Zero-dependency cryptography utilities for E2E tests.
 */

const crypto = require('node:crypto');

// Ambiguous characters (0, 1, I, O) excluded
const PAIRING_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function sha256(data) {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function generatePairingCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  }
  return code;
}

function generateDeviceSecret(bytesCount = 32) {
  return crypto.randomBytes(bytesCount).toString('hex');
}

function generateBearerToken(bytesCount = 48) {
  return crypto.randomBytes(bytesCount).toString('hex');
}

function hashPin(pin, salt) {
  return sha256(`${salt}:${pin}`);
}

function randomUUID() {
  return crypto.randomUUID();
}

module.exports = {
  PAIRING_ALPHABET,
  sha256,
  generatePairingCode,
  generateDeviceSecret,
  generateBearerToken,
  hashPin,
  randomUUID,
};
