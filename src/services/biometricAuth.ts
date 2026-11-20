import { UserRole } from '../types/estate';

const WEBAUTHN_STORAGE_KEY = 'srpk_webauthn_credentials_v1';

export interface StoredBiometricCredential {
  role: UserRole;
  username: string;
  credentialId: string;
  enrolledAt: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8Array(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomChallenge(length = 32): ArrayBuffer {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf.buffer;
}

export async function isPlatformBiometricSupported(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !('credentials' in navigator) ||
    !('PublicKeyCredential' in window)
  ) {
    return false;
  }

  try {
    if (
      typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ===
      'function'
    ) {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return false;
  } catch {
    return false;
  }
}

export function getEnrolledBiometrics(): StoredBiometricCredential[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(WEBAUTHN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<
      Partial<StoredBiometricCredential> & { role?: string }
    >;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) =>
          typeof item.username === 'string' &&
          item.username.length > 0 &&
          typeof item.credentialId === 'string' &&
          item.credentialId.length > 0
      )
      .map((item) => ({
        role: 'Owner' as const,
        username: item.username!,
        credentialId: item.credentialId!,
        enrolledAt: item.enrolledAt || new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

export function isBiometricEnrolledForUser(username: string): boolean {
  const target = username.trim().toLowerCase();
  return getEnrolledBiometrics().some(
    (c) => c.username.trim().toLowerCase() === target
  );
}

export function removeBiometricForUser(username: string): void {
  if (typeof window === 'undefined') return;
  const target = username.trim().toLowerCase();
  const next = getEnrolledBiometrics().filter(
    (c) => c.username.trim().toLowerCase() !== target
  );
  try {
    localStorage.setItem(WEBAUTHN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

function mapWebAuthnError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') {
      return 'Biometric verification was cancelled or timed out. Try again or sign in with your PIN.';
    }
    if (err.name === 'SecurityError') {
      return 'Biometrics require a secure top-level HTTPS/localhost window (blocked inside restricted preview frames).';
    }
    if (err.name === 'InvalidStateError') {
      return 'A biometric passkey is already registered on this device.';
    }
  }
  return err instanceof Error
    ? err.message
    : 'Biometric authentication could not complete on this browser.';
}

export async function registerPlatformBiometric(
  username: string
): Promise<
  | { ok: true; credential: StoredBiometricCredential }
  | { ok: false; error: string }
> {
  const supported = await isPlatformBiometricSupported();
  if (!supported) {
    return {
      ok: false,
      error: 'Face ID / Fingerprint hardware authenticator is unavailable on this browser.',
    };
  }

  try {
    const cleanUser = username.trim();
    const userId = new TextEncoder().encode(`srpk-owner-${cleanUser.toLowerCase()}`);
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(32),
        rp: {
          name: 'SRPK Enterprise Estate',
          id: window.location.hostname,
        },
        user: {
          id: userId,
          name: cleanUser,
          displayName: `Owner (${cleanUser})`,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    if (!credential) {
      return { ok: false, error: 'Device did not return a biometric credential.' };
    }

    const credentialId = bytesToBase64Url(new Uint8Array(credential.rawId));
    const entry: StoredBiometricCredential = {
      role: 'Owner',
      username: cleanUser,
      credentialId,
      enrolledAt: new Date().toISOString(),
    };

    const next = [
      ...getEnrolledBiometrics().filter(
        (c) => c.username.trim().toLowerCase() !== cleanUser.toLowerCase()
      ),
      entry,
    ];
    localStorage.setItem(WEBAUTHN_STORAGE_KEY, JSON.stringify(next));

    return { ok: true, credential: entry };
  } catch (err) {
    return { ok: false, error: mapWebAuthnError(err) };
  }
}

export async function authenticateWithPlatformBiometric(
  targetUsername?: string
): Promise<
  | { ok: true; role: UserRole; username: string }
  | { ok: false; error: string }
> {
  const enrolled = getEnrolledBiometrics();
  const candidates = targetUsername
    ? enrolled.filter(
        (c) => c.username.trim().toLowerCase() === targetUsername.trim().toLowerCase()
      )
    : enrolled;

  const targets = candidates.length > 0 ? candidates : enrolled;
  if (targets.length === 0) {
    return {
      ok: false,
      error: 'No biometric credential is enrolled on this device yet. Sign in with PIN first.',
    };
  }

  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(32),
        allowCredentials: targets.map((c) => {
          const rawBytes = base64UrlToUint8Array(c.credentialId);
          return {
            type: 'public-key' as const,
            id: rawBytes.buffer as ArrayBuffer,
            transports: ['internal' as AuthenticatorTransport],
          };
        }),
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!assertion) {
      return { ok: false, error: 'Biometric verification returned empty assertion.' };
    }

    const matchedId = bytesToBase64Url(new Uint8Array(assertion.rawId));
    const matched = targets.find((t) => t.credentialId === matchedId) || targets[0];

    return {
      ok: true,
      role: 'Owner',
      username: matched.username,
    };
  } catch (err) {
    return { ok: false, error: mapWebAuthnError(err) };
  }
}
