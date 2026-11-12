/**
 * Computes a salted SHA-256 hex hash of the 4-digit TV PIN.
 * Salt format: "${spaceId}:${pin}"
 */
export async function hashTvPin(pin: string, spaceId: string): Promise<string> {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('TV PIN must be exactly 4 numeric digits.');
  }

  const saltString = `${spaceId}:${pin}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(saltString);

  const cryptoObj =
    typeof window !== 'undefined'
      ? window.crypto
      : (globalThis as unknown as { crypto?: Crypto }).crypto;

  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error(
      'Web Crypto API is not available. Please ensure the app is running in a secure context (HTTPS or localhost).'
    );
  }

  const hashBuffer = await cryptoObj.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate 4-digit PIN format
 */
export function validateTvPin(pin: string): { valid: boolean; error: string | null } {
  if (!/^\d{4}$/.test(pin)) {
    return { valid: false, error: 'PIN must be exactly 4 numeric digits.' };
  }
  return { valid: true, error: null };
}
