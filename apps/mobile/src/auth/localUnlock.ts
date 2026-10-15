import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytesAsync } from 'expo-crypto';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const pinKey = 'asteriq.local-unlock.pin.v1';
const biometricKey = 'asteriq.local-unlock.biometric.v1';
const refreshTokenKey = 'asteriq.auth.refresh-token.v1';
const pinIterations = 310_000;
const attemptsKey = 'asteriq.local-unlock.attempts.v1';
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let verifying = false;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function derivePinVerifier(pin: string, salt: Uint8Array): Promise<string> {
  const derived = await pbkdf2Async(sha256, pin, salt, {
    c: pinIterations,
    dkLen: 32,
    asyncTick: 25,
  });
  return toHex(derived);
}

export async function hasLocalPin(): Promise<boolean> {
  return (await SecureStore.getItemAsync(pinKey)) !== null;
}

export async function setLocalPin(pin: string): Promise<void> {
  if (!/^\d{6,12}$/.test(pin)) {
    throw new Error('Choose a PIN with 6 to 12 digits.');
  }
  const salt = await getRandomBytesAsync(16);
  const verifier = await derivePinVerifier(pin, salt);
  await SecureStore.setItemAsync(pinKey, `${toHex(salt)}:${verifier}`, secureOptions);
  await SecureStore.deleteItemAsync(attemptsKey);
}

export async function verifyLocalPin(pin: string): Promise<boolean> {
  if (verifying) throw new Error('PIN verification is already in progress.');
  verifying = true;
  try {
    const rawAttempts = await SecureStore.getItemAsync(attemptsKey);
    let attempts = { failures: 0, until: 0 };
    try {
      const parsed = JSON.parse(rawAttempts ?? '{}') as typeof attempts;
      if (Number.isFinite(parsed.failures) && Number.isFinite(parsed.until)) attempts = parsed;
    } catch {
      /* Corrupt counters never grant access. */
    }
    if (Date.now() < attempts.until)
      throw new Error(
        'Too many incorrect PIN attempts. Retry in ' +
          Math.ceil((attempts.until - Date.now()) / 1000) +
          ' seconds.',
      );
    const stored = await SecureStore.getItemAsync(pinKey);
    if (!stored) return false;
    const [saltHex, expected] = stored.split(':');
    let valid = false;
    if (
      saltHex &&
      expected &&
      /^[a-f0-9]{32}$/.test(saltHex) &&
      /^[a-f0-9]{64}$/.test(expected) &&
      /^\d{6,12}$/.test(pin)
    ) {
      const salt = Uint8Array.from(saltHex.match(/.{2}/g) ?? [], (byte) =>
        Number.parseInt(byte, 16),
      );
      const actual = await derivePinVerifier(pin, salt);
      let difference = actual.length ^ expected.length;
      for (let index = 0; index < expected.length; index++)
        difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
      valid = difference === 0;
    }
    if (valid) {
      await SecureStore.deleteItemAsync(attemptsKey);
      return true;
    }
    const failures = attempts.failures + 1;
    const until =
      failures % 5 === 0
        ? Date.now() + Math.min(900000, 60000 * 2 ** Math.floor(failures / 5 - 1))
        : 0;
    await SecureStore.setItemAsync(attemptsKey, JSON.stringify({ failures, until }), secureOptions);
    return false;
  } finally {
    verifying = false;
  }
}

export async function biometricsAvailable(): Promise<boolean> {
  const [hardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hardware && enrolled;
}

export async function enableBiometricUnlock(): Promise<boolean> {
  if (!(await biometricsAvailable())) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Enable biometric app unlock',
    cancelLabel: 'Cancel',
    disableDeviceFallback: true,
    biometricsSecurityLevel: 'strong',
  });
  if (!result.success) return false;
  await SecureStore.setItemAsync(biometricKey, 'enabled', secureOptions);
  return true;
}

export async function biometricUnlock(): Promise<boolean> {
  if ((await SecureStore.getItemAsync(biometricKey)) !== 'enabled') return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock Asteriq AI',
    cancelLabel: 'Use PIN',
    disableDeviceFallback: true,
    biometricsSecurityLevel: 'strong',
  });
  return result.success;
}

export async function storeRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(refreshTokenKey, token, secureOptions);
}

export async function readRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(refreshTokenKey);
}

export async function clearLocalAuthentication(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(pinKey),
    SecureStore.deleteItemAsync(biometricKey),
    SecureStore.deleteItemAsync(refreshTokenKey),
    SecureStore.deleteItemAsync(attemptsKey),
    SecureStore.deleteItemAsync('asteriq.push.enabled.v1'),
  ]);
}

export async function disableBiometricUnlock() {
  await SecureStore.deleteItemAsync(biometricKey);
}
