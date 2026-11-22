import {
  AuthSession,
  AutoLockTimerMode,
  RoleCredentialsConfig,
} from '../types/estate';

/**
 * Dual-Owner Credentials for SRPK Enterprise Estate.
 * Both authorized accounts authenticate with full Owner (Admin) permissions.
 * Override cleanly via Vite environment variables:
 *   VITE_OWNER_EMAIL   / VITE_OWNER_PIN
 *   VITE_OWNER_2_EMAIL / VITE_OWNER_2_PIN
 * Or update directly from Settings > Access & PIN Management.
 *
 * Initial Default Owner Accounts (change in Settings after first login):
 *   - Owner 1: username/email = "rajasugu@gmail.com" (alias: "owner@srpkestate.in") | PIN = "202601"
 *   - Owner 2 (Co-Owner / Partner): username/email = "Parthibannewid@gmail.com" (alias: "coowner@srpkestate.in") | PIN = "202602"
 */
export const DEFAULT_ROLE_CREDENTIALS: RoleCredentialsConfig = {
  Owner1: {
    username: (import.meta.env.VITE_OWNER_EMAIL || 'rajasugu@gmail.com').trim(),
    pin: (import.meta.env.VITE_OWNER_PIN || '202601').trim(),
  },
  Owner2: {
    username: (
      import.meta.env.VITE_OWNER_2_EMAIL ||
      import.meta.env.VITE_PARTNER_EMAIL ||
      'Parthibannewid@gmail.com'
    ).trim(),
    pin: (
      import.meta.env.VITE_OWNER_2_PIN ||
      import.meta.env.VITE_PARTNER_PIN ||
      '202602'
    ).trim(),
  },
};

export const AUTH_SESSION_STORAGE_KEY = 'srpk_auth_session_v1';
export const AUTH_CREDENTIALS_CACHE_KEY = 'srpk_auth_credentials_v1';
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

type LegacyCredentialsShape = Partial<RoleCredentialsConfig> & {
  Owner?: { username?: string; pin?: string };
  Partner?: { username?: string; pin?: string };
};

export function resolveEffectiveCredentials(
  settingsOverride?: RoleCredentialsConfig
): RoleCredentialsConfig {
  let cached: LegacyCredentialsShape | null = null;
  if (!settingsOverride && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(AUTH_CREDENTIALS_CACHE_KEY);
      if (raw) {
        cached = JSON.parse(raw) as LegacyCredentialsShape;
      }
    } catch {
      cached = null;
    }
  }

  const source = (settingsOverride || cached) as LegacyCredentialsShape | null;
  const owner1Src = source?.Owner1 || source?.Owner;
  const owner2Src = source?.Owner2 || source?.Partner;

  const rawOwner1 = owner1Src?.username?.trim() || '';
  const rawOwner2 = owner2Src?.username?.trim() || '';

  return {
    Owner1: {
      username:
        !rawOwner1 || rawOwner1.toLowerCase() === 'owner@srpkestate.in'
          ? DEFAULT_ROLE_CREDENTIALS.Owner1.username
          : rawOwner1,
      pin: owner1Src?.pin?.trim() || DEFAULT_ROLE_CREDENTIALS.Owner1.pin,
    },
    Owner2: {
      username:
        !rawOwner2 || rawOwner2.toLowerCase() === 'coowner@srpkestate.in'
          ? DEFAULT_ROLE_CREDENTIALS.Owner2.username
          : rawOwner2,
      pin: owner2Src?.pin?.trim() || DEFAULT_ROLE_CREDENTIALS.Owner2.pin,
    },
  };
}

export function persistCredentialsCache(creds: RoleCredentialsConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTH_CREDENTIALS_CACHE_KEY, JSON.stringify(creds));
  } catch {
    // ignore storage errors
  }
}

export function verifyOwnerLogin(params: {
  usernameInput: string;
  pinInput: string;
  settingsCredentials?: RoleCredentialsConfig;
}):
  | { ok: true; session: AuthSession }
  | { ok: false; error: string } {
  const effective = resolveEffectiveCredentials(params.settingsCredentials);
  const enteredUser = params.usernameInput.trim().toLowerCase();
  const enteredPin = params.pinInput.trim();

  if (!enteredUser || !enteredPin) {
    return {
      ok: false,
      error: 'Enter both your authorized Owner email/username and PIN/password.',
    };
  }

  const candidates: Array<{
    accountLabel: 'Owner 1' | 'Owner 2';
    username: string;
    aliases: string[];
    pin: string;
  }> = [
    {
      accountLabel: 'Owner 1',
      username: effective.Owner1.username.trim(),
      aliases:
        effective.Owner1.username.trim().toLowerCase() === 'rajasugu@gmail.com'
          ? ['rajasugu@gmail.com', 'owner@srpkestate.in']
          : [effective.Owner1.username.trim().toLowerCase()],
      pin: effective.Owner1.pin.trim(),
    },
    {
      accountLabel: 'Owner 2',
      username: effective.Owner2.username.trim(),
      aliases:
        effective.Owner2.username.trim().toLowerCase() === 'parthibannewid@gmail.com'
          ? ['parthibannewid@gmail.com', 'coowner@srpkestate.in']
          : [effective.Owner2.username.trim().toLowerCase()],
      pin: effective.Owner2.pin.trim(),
    },
  ];

  const matchedAccount = candidates.find(
    (c) =>
      c.username.toLowerCase() === enteredUser || c.aliases.includes(enteredUser)
  );

  if (!matchedAccount) {
    return {
      ok: false,
      error:
        'Access denied: unauthorized account. Only the two configured Owner accounts may sign in.',
    };
  }

  if (enteredPin !== matchedAccount.pin) {
    return {
      ok: false,
      error: 'Incorrect PIN or password for this Owner account.',
    };
  }

  return {
    ok: true,
    session: {
      role: 'Owner',
      accountLabel: matchedAccount.accountLabel,
      username: matchedAccount.username,
      loginMethod: 'password',
      authenticatedAt: new Date().toISOString(),
    },
  };
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

    const parsed = JSON.parse(raw) as Omit<Partial<AuthSession>, 'role'> & {
      role?: string;
    };
    if (
      (parsed.role === 'Owner' || parsed.role === 'Partner') &&
      typeof parsed.username === 'string' &&
      parsed.username.trim()
    ) {
      clearHiddenAtTimestamp();
      recordLastActivityTimestamp();
      return {
        role: 'Owner',
        accountLabel:
          parsed.accountLabel === 'Owner 2' || parsed.role === 'Partner'
            ? 'Owner 2'
            : 'Owner 1',
        username: parsed.username,
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
