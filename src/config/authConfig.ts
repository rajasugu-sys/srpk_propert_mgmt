import type {
  AccessType,
  AuthSession,
  AutoLockTimerMode,
} from '../types/estate';

export const AUTH_SESSION_STORAGE_KEY = 'srpk_auth_session_v1';
export const LAST_ACTIVITY_TS_KEY = 'srpk_last_activity_ts_v1';
export const HIDDEN_AT_TS_KEY = 'srpk_hidden_at_ts_v1';
export const AUTO_LOCK_TIMER_KEY = 'srpk_auto_lock_timer_v1';

export const BACKGROUND_RELAUNCH_LOCK_MS = 2 * 60 * 1000; // 2 minutes

export interface AutoLockOptionMeta {
  value: AutoLockTimerMode;
  label: string;
  description: string;
  inactivityMs: number;
  backgroundMs: number;
}

export const AUTO_LOCK_OPTIONS: AutoLockOptionMeta[] = [
  {
    value: 'immediate',
    label: 'Immediate (whenever app goes to background)',
    description: 'Locks instantly when switching apps or closing',
    inactivityMs: 15 * 60 * 1000,
    backgroundMs: 0,
  },
  {
    value: '5m',
    label: '5 minutes',
    description: 'Locks after 5 min idle or >2 min in background',
    inactivityMs: 5 * 60 * 1000,
    backgroundMs: BACKGROUND_RELAUNCH_LOCK_MS,
  },
  {
    value: '15m',
    label: '15 minutes (Default)',
    description: 'Locks after 15 min idle or >2 min in background',
    inactivityMs: 15 * 60 * 1000,
    backgroundMs: BACKGROUND_RELAUNCH_LOCK_MS,
  },
  {
    value: '30m',
    label: '30 minutes',
    description: 'Locks after 30 min idle or >2 min in background',
    inactivityMs: 30 * 60 * 1000,
    backgroundMs: BACKGROUND_RELAUNCH_LOCK_MS,
  },
];

export function isValidAutoLockMode(val: unknown): val is AutoLockTimerMode {
  return val === 'immediate' || val === '5m' || val === '15m' || val === '30m';
}

export function getAutoLockOptionMeta(mode: AutoLockTimerMode): AutoLockOptionMeta {
  return (
    AUTO_LOCK_OPTIONS.find((opt) => opt.value === mode) || AUTO_LOCK_OPTIONS[2]
  );
}

export function loadAutoLockTimerMode(): AutoLockTimerMode {
  if (typeof window === 'undefined') return '15m';
  try {
    const raw = localStorage.getItem(AUTO_LOCK_TIMER_KEY);
    if (isValidAutoLockMode(raw)) return raw;
  } catch {
    // ignore storage errors
  }
  return '15m';
}

export function saveAutoLockTimerMode(mode: AutoLockTimerMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTO_LOCK_TIMER_KEY, mode);
  } catch {
    // ignore storage errors
  }
}

export function recordLastActivityTimestamp(ts: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LAST_ACTIVITY_TS_KEY, String(ts));
  } catch {
    // ignore storage errors
  }
}

export function getLastActivityTimestamp(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_TS_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function clearLastActivityTimestamp(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LAST_ACTIVITY_TS_KEY);
  } catch {
    // ignore storage errors
  }
}

export function recordHiddenAtTimestamp(ts: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HIDDEN_AT_TS_KEY, String(ts));
  } catch {
    // ignore storage errors
  }
}

export function getHiddenAtTimestamp(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(HIDDEN_AT_TS_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function clearHiddenAtTimestamp(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(HIDDEN_AT_TS_KEY);
  } catch {
    // ignore storage errors
  }
}

export function evaluateSessionLockStatus(
  mode: AutoLockTimerMode,
  now: number = Date.now()
): { locked: boolean; reason?: string } {
  const meta = getAutoLockOptionMeta(mode);

  const hiddenAt = getHiddenAtTimestamp();
  if (hiddenAt !== null) {
    const elapsedBg = now - hiddenAt;
    if (mode === 'immediate' || elapsedBg > meta.backgroundMs) {
      return {
        locked: true,
        reason:
          mode === 'immediate'
            ? 'App locked when moved to background.'
            : 'Session locked for security after leaving the app.',
      };
    }
  }

  const lastActivity = getLastActivityTimestamp();
  if (lastActivity !== null && now - lastActivity > meta.inactivityMs) {
    return {
      locked: true,
      reason: 'Session locked due to inactivity.',
    };
  }

  return { locked: false };
}

export function loadPersistedAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    // Ensure no permanent localStorage logged-in flag ever remains
    localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);

    const raw = sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!raw) return null;

    const lockCheck = evaluateSessionLockStatus(loadAutoLockTimerMode());
    if (lockCheck.locked) {
      sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
      clearHiddenAtTimestamp();
      clearLastActivityTimestamp();
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (
      (parsed.accessType === 'admin' || parsed.accessType === 'viewer') &&
      typeof parsed.userId === 'string' &&
      parsed.userId.trim() &&
      typeof parsed.authToken === 'string' &&
      parsed.authToken.trim()
    ) {
      clearHiddenAtTimestamp();
      recordLastActivityTimestamp();
      return {
        userId: parsed.userId,
        fullName: parsed.fullName || parsed.userId,
        email: parsed.email || '',
        mobileNumber: parsed.mobileNumber || '',
        accessType: parsed.accessType,
        accessStatus: parsed.accessStatus === 'revoked' ? 'revoked' : 'active',
        authToken: parsed.authToken,
        role: parsed.accessType === 'admin' ? 'Admin' : 'Viewer',
        username: parsed.userId,
        loginMethod: parsed.loginMethod === 'biometric' ? 'biometric' : 'password',
        authenticatedAt: parsed.authenticatedAt || new Date().toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function savePersistedAuthSession(session: AuthSession | null): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    if (!session) {
      sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
      clearLastActivityTimestamp();
      clearHiddenAtTimestamp();
    } else {
      sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
      clearHiddenAtTimestamp();
      recordLastActivityTimestamp();
    }
  } catch {
    // ignore storage errors
  }
}

export function getAuthFetchHeaders(
  authToken?: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  return headers;
}

export async function loginWithCredentials(
  identifier: string,
  password: string
): Promise<{ ok: true; session: AuthSession } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      session?: AuthSession;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.session) {
      return { ok: false, error: data.error || 'Sign-in failed.' };
    }
    return { ok: true, session: data.session };
  } catch {
    return { ok: false, error: 'Unable to reach authentication server.' };
  }
}

export async function signUpAccount(payload: {
  userId: string;
  fullName: string;
  email: string;
  mobileNumber: string;
  accessType: AccessType;
  password: string;
  masterAdminPin?: string;
}): Promise<{ ok: true; session: AuthSession } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      session?: AuthSession;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.session) {
      return { ok: false, error: data.error || 'Sign-up failed.' };
    }
    return { ok: true, session: data.session };
  } catch {
    return { ok: false, error: 'Unable to reach authentication server.' };
  }
}

export async function resetPasswordWithIdentifier(payload: {
  identifier: string;
  newPassword: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      message?: string;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'Password reset failed.' };
    }
    return {
      ok: true,
      message: data.message || 'Password updated. You can sign in now.',
    };
  } catch {
    return { ok: false, error: 'Unable to reach authentication server.' };
  }
}


export async function changeAccountPassword(
  authToken: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: getAuthFetchHeaders(authToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      message?: string;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'Failed changing password.' };
    }
    return { ok: true, message: data.message || 'Password changed successfully.' };
  } catch {
    return { ok: false, error: 'Unable to reach authentication server.' };
  }
}

export async function resolveBiometricLogin(
  identifier: string
): Promise<{ ok: true; session: AuthSession } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth/biometric-resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      session?: AuthSession;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.session) {
      return { ok: false, error: data.error || 'Biometric sign-in failed.' };
    }
    return { ok: true, session: data.session };
  } catch {
    return { ok: false, error: 'Unable to reach authentication server.' };
  }
}


export async function fetchMasterAdminPin(
  authToken: string
): Promise<{ ok: true; masterAdminPin: string } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth/master-pin', {
      headers: getAuthFetchHeaders(authToken),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      masterAdminPin?: string;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.masterAdminPin) {
      return { ok: false, error: data.error || 'Unable to load Master Admin PIN.' };
    }
    return { ok: true, masterAdminPin: data.masterAdminPin };
  } catch {
    return { ok: false, error: 'Unable to reach server.' };
  }
}

export async function updateMasterAdminPin(
  authToken: string,
  payload: { mode: 'generate' | 'custom'; customPin?: string }
): Promise<{ ok: true; masterAdminPin: string } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth/master-pin', {
      method: 'POST',
      headers: getAuthFetchHeaders(authToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      masterAdminPin?: string;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.masterAdminPin) {
      return { ok: false, error: data.error || 'Unable to update Master Admin PIN.' };
    }
    return { ok: true, masterAdminPin: data.masterAdminPin };
  } catch {
    return { ok: false, error: 'Unable to reach server.' };
  }
}
