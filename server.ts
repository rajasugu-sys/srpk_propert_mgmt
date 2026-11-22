import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import {
  getSheetsConfigSummary,
  HARDCODED_SPREADSHEET_ID,
  pullAllFromSheetServer,
  pushAllTablesServer,
  REQUIRED_SHEET_TABS,
  syncTableServer,
  testConnectionAndSyncServer,
} from './server/sheetsSync.ts';
import type { ServerDatasetPayload, SyncTable } from './server/sheetsSync.ts';
import { INITIAL_ESTATE_DATASET } from './src/data/initialEstateData.ts';
import type {
  AccessType,
  AccountAccessStatus,
  AppUserAccount,
  AuthSession,
  EstateDataset,
  MaintenanceRequest,
  RequestCategory,
  UserRole,
} from './src/types/estate.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const AGREEMENTS_DIR = path.join(DATA_DIR, 'agreements');
const DB_FILE = path.join(DATA_DIR, 'estate-db.json');
const AUTH_SECRET_FILE = path.join(DATA_DIR, 'auth-secret.key');
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MASTER_PIN_REGEX = /^[A-Za-z0-9]{12}$/;

let cachedAuthSecret: string | null = null;

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add it in the Settings > Secrets panel.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(AGREEMENTS_DIR, { recursive: true });
}

async function getAuthSecret(): Promise<string> {
  if (cachedAuthSecret) return cachedAuthSecret;
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.trim().length >= 16) {
    cachedAuthSecret = process.env.AUTH_SECRET.trim();
    return cachedAuthSecret;
  }
  await ensureDataDir();
  try {
    const existing = (await fs.readFile(AUTH_SECRET_FILE, 'utf-8')).trim();
    if (existing.length >= 32) {
      cachedAuthSecret = existing;
      return cachedAuthSecret;
    }
  } catch {
    // create new key below
  }
  const generated = crypto.randomBytes(32).toString('hex');
  await fs.writeFile(AUTH_SECRET_FILE, generated, { encoding: 'utf-8', mode: 0o600 });
  cachedAuthSecret = generated;
  return cachedAuthSecret;
}

function hashPassword(
  password: string,
  providedSalt?: string
): { salt: string; hash: string } {
  const salt = providedSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  if (!salt || !expectedHash) return false;
  try {
    const computedBuf = crypto.scryptSync(password, salt, 64);
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    if (computedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(computedBuf, expectedBuf);
  } catch {
    return false;
  }
}

function timingSafeStringMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateMasterAdminPin(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i += 1) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function normalizeMobile(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function toUserRole(accessType: AccessType): UserRole {
  if (accessType === 'admin') return 'Admin';
  if (accessType === 'viewer') return 'Viewer';
  return 'Tenant';
}

interface AuthTokenPayload {
  userId: string;
  accessType: AccessType;
  iat: number;
  exp: number;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf-8');
}

async function signAuthToken(user: AppUserAccount): Promise<string> {
  const secret = await getAuthSecret();
  const now = Date.now();
  const payload: AuthTokenPayload = {
    userId: user.user_id,
    accessType: user.access_type,
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  return `${headerB64}.${payloadB64}.${base64UrlEncode(sig)}`;
}

async function verifyAuthToken(token: string): Promise<AuthTokenPayload | null> {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const secret = await getAuthSecret();
    const expectedSig = base64UrlEncode(
      crypto
        .createHmac('sha256', secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest()
    );
    if (!timingSafeStringMatch(sigB64, expectedSig)) return null;
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as AuthTokenPayload;
    if (!payload.userId || !payload.accessType || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

function buildAuthSession(
  user: AppUserAccount,
  loginMethod: 'password' | 'biometric',
  authToken: string
): AuthSession {
  return {
    userId: user.user_id,
    fullName: user.full_name,
    email: user.email,
    mobileNumber: user.mobile_number,
    accessType: user.access_type,
    accessStatus: user.access_status,
    mustResetPassword: Boolean(user.must_reset_password),
    tenantId: user.tenant_id || null,
    unitId: user.unit_id || null,
    authToken,
    role: toUserRole(user.access_type),
    username: user.user_id,
    loginMethod,
    authenticatedAt: new Date().toISOString(),
  };
}

function createInitialAdminUsers(): AppUserAccount[] {
  const now = new Date().toISOString();
  const owner1Email = (process.env.OWNER_1_EMAIL || 'rajasugu@gmail.com').trim();
  const owner1Pin = (process.env.OWNER_1_PIN || '202601').trim();
  const owner2Email = (
    process.env.OWNER_2_EMAIL || 'Parthibannewid@gmail.com'
  ).trim();
  const owner2Pin = (process.env.OWNER_2_PIN || '202602').trim();

  const h1 = hashPassword(owner1Pin);
  const h2 = hashPassword(owner2Pin);

  return [
    {
      user_id: 'raja',
      full_name: 'Raja',
      email: owner1Email,
      mobile_number: '9845011223',
      access_type: 'admin',
      access_status: 'active',
      must_reset_password: false,
      tenant_id: null,
      unit_id: null,
      password_salt: h1.salt,
      password_hash: h1.hash,
      created_at: now,
      updated_at: now,
    },
    {
      user_id: 'parthiban',
      full_name: 'Parthiban',
      email: owner2Email,
      mobile_number: '9845011224',
      access_type: 'admin',
      access_status: 'active',
      must_reset_password: false,
      tenant_id: null,
      unit_id: null,
      password_salt: h2.salt,
      password_hash: h2.hash,
      created_at: now,
      updated_at: now,
    },
  ];
}

function normalizeUserRecord(raw: Record<string, unknown>): AppUserAccount {
  const rawType = String(raw.access_type || 'viewer').toLowerCase();
  const access_type: AccessType =
    rawType === 'admin' || rawType === 'tenant' ? rawType : 'viewer';
  const rawStatus = String(raw.access_status || 'active').toLowerCase();
  const access_status: AccountAccessStatus =
    rawStatus === 'revoked' ? 'revoked' : 'active';

  return {
    user_id: String(raw.user_id || '').trim(),
    full_name: String(raw.full_name || '').trim(),
    email: String(raw.email || '').trim(),
    mobile_number: String(raw.mobile_number || '').trim(),
    access_type,
    access_status,
    must_reset_password:
      raw.must_reset_password === true || raw.must_reset_password === 'true',
    tenant_id: raw.tenant_id ? String(raw.tenant_id).trim() : null,
    unit_id: raw.unit_id ? String(raw.unit_id).trim() : null,
    password_salt: raw.password_salt ? String(raw.password_salt) : '',
    password_hash: raw.password_hash ? String(raw.password_hash) : '',
    created_at: String(raw.created_at || new Date().toISOString()),
    updated_at: String(raw.updated_at || new Date().toISOString()),
  };
}

function findUserByIdentifier(
  users: AppUserAccount[],
  identifier: string
): AppUserAccount | undefined {
  const clean = identifier.trim().toLowerCase();
  const cleanMobile = normalizeMobile(identifier);
  return users.find((u) => {
    if (u.user_id.trim().toLowerCase() === clean) return true;
    if (u.email && u.email.trim().toLowerCase() === clean) return true;
    if (
      cleanMobile.length >= 10 &&
      normalizeMobile(u.mobile_number) === cleanMobile
    ) {
      return true;
    }
    return false;
  });
}

async function readOrSeedEstateDataset(): Promise<EstateDataset> {
  let dataset: EstateDataset;
  let dirty = false;

  try {
    const raw = await fs.readFile(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<EstateDataset>;
    if (Array.isArray(parsed.properties) && Array.isArray(parsed.units)) {
      dataset = {
        ...INITIAL_ESTATE_DATASET,
        ...parsed,
        expenses: Array.isArray(parsed.expenses)
          ? parsed.expenses
          : INITIAL_ESTATE_DATASET.expenses,
        requests: Array.isArray(parsed.requests)
          ? parsed.requests
          : INITIAL_ESTATE_DATASET.requests,
        users: Array.isArray(parsed.users) ? parsed.users : [],
        settings: {
          ...INITIAL_ESTATE_DATASET.settings,
          ...(parsed.settings || {}),
        },
      };
    } else {
      dataset = {
        ...INITIAL_ESTATE_DATASET,
        requests: [...(INITIAL_ESTATE_DATASET.requests || [])],
        users: [],
      };
      dirty = true;
    }
  } catch {
    dataset = {
      ...INITIAL_ESTATE_DATASET,
      requests: [...(INITIAL_ESTATE_DATASET.requests || [])],
      users: [],
    };
    dirty = true;
  }

  const envMasterPin = (process.env.MASTER_ADMIN_PIN || '').trim().toUpperCase();
  if (
    !dataset.settings.master_admin_pin ||
    !MASTER_PIN_REGEX.test(dataset.settings.master_admin_pin)
  ) {
    dataset.settings.master_admin_pin = MASTER_PIN_REGEX.test(envMasterPin)
      ? envMasterPin
      : 'SRKP2026ADMN';
    dirty = true;
  }

  const users = Array.isArray(dataset.users) ? dataset.users : [];
  if (!users.some((u) => u.access_type === 'admin')) {
    const seededAdmins = createInitialAdminUsers();
    dataset.users = [...seededAdmins, ...users];
    dirty = true;
  }

  if (dirty) {
    await ensureDataDir();
    await fs.writeFile(DB_FILE, JSON.stringify(dataset, null, 2), 'utf-8');
  }

  return dataset;
}

async function persistEstateDataset(dataset: EstateDataset): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(DB_FILE, JSON.stringify(dataset, null, 2), 'utf-8');
}

function sanitizeUserForClient(u: AppUserAccount): AppUserAccount {
  return {
    user_id: u.user_id,
    full_name: u.full_name,
    email: u.email,
    mobile_number: u.mobile_number,
    access_type: u.access_type,
    access_status: u.access_status,
    must_reset_password: Boolean(u.must_reset_password),
    tenant_id: u.tenant_id || null,
    unit_id: u.unit_id || null,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

function buildAppConfigRows(dataset: EstateDataset): Array<{
  key: string;
  value: string;
  updated_at: string;
}> {
  return [
    {
      key: 'master_admin_pin',
      value: dataset.settings.master_admin_pin || 'SRKP2026ADMN',
      updated_at: new Date().toISOString(),
    },
  ];
}

async function syncUsersAndConfigToSheets(dataset: EstateDataset): Promise<void> {
  if (!getSheetsConfigSummary().secretConfigured) return;
  try {
    await syncTableServer('Users', dataset.users || []);
    await syncTableServer('AppConfig', buildAppConfigRows(dataset));
  } catch {
    // non-fatal background sync
  }
}

async function mergeUsersFromSheetsIfConfigured(
  dataset: EstateDataset
): Promise<EstateDataset> {
  if (!getSheetsConfigSummary().secretConfigured) return dataset;
  try {
    const pulled = await pullAllFromSheetServer();
    if (!pulled.ok || !pulled.data) return dataset;

    let changed = false;
    const sheetUsersRaw = pulled.data.Users || [];
    if (sheetUsersRaw.length > 0) {
      const sheetUsers = sheetUsersRaw
        .map((row) => normalizeUserRecord(row))
        .filter((u) => u.user_id && u.password_hash && u.password_salt);

      const mergedMap = new Map<string, AppUserAccount>();
      (dataset.users || []).forEach((u) =>
        mergedMap.set(u.user_id.toLowerCase(), u)
      );
      sheetUsers.forEach((su) => {
        const existing = mergedMap.get(su.user_id.toLowerCase());
        if (!existing || su.updated_at > existing.updated_at) {
          mergedMap.set(su.user_id.toLowerCase(), su);
          changed = true;
        }
      });
      if (changed) {
        dataset = { ...dataset, users: Array.from(mergedMap.values()) };
      }
    }

    const appConfigRows = pulled.data.AppConfig || [];
    const pinRow = appConfigRows.find(
      (r) => String(r.key || '').trim() === 'master_admin_pin'
    );
    const sheetPin = String(pinRow?.value || '').trim().toUpperCase();
    if (MASTER_PIN_REGEX.test(sheetPin) && sheetPin !== dataset.settings.master_admin_pin) {
      dataset = {
        ...dataset,
        settings: {
          ...dataset.settings,
          master_admin_pin: sheetPin,
        },
      };
      changed = true;
    }

    if (changed) {
      await persistEstateDataset(dataset);
    }
  } catch {
    // ignore sheet lookup failures during login
  }
  return dataset;
}

async function requireAuthSession(
  req: Request,
  res: Response,
  allowedRoles?: AccessType[]
): Promise<{ payload: AuthTokenPayload; dataset: EstateDataset; user: AppUserAccount } | null> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return null;
  }
  const payload = await verifyAuthToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return null;
  }
  const dataset = await readOrSeedEstateDataset();
  const user = (dataset.users || []).find(
    (u) => u.user_id.toLowerCase() === payload.userId.toLowerCase()
  );
  if (!user) {
    res.status(401).json({ error: 'User account not found. Please sign in again.' });
    return null;
  }
  if (user.access_status === 'revoked') {
    res.status(403).json({
      error: 'Your access has been revoked. Please contact the house owner.',
    });
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(user.access_type)) {
    res.status(403).json({
      error: 'Permission denied: your account does not have write/admin access.',
    });
    return null;
  }
  return { payload, dataset, user };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Bootstrap DB & auth secret on startup
  await getAuthSecret();
  await readOrSeedEstateDataset();

  // ==========================================
  // 0. Multi-Role Authentication Endpoints
  // ==========================================

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { identifier, password } = req.body as {
        identifier?: string;
        password?: string;
      };
      const cleanIdentifier = String(identifier || '').trim();
      const cleanPassword = String(password || '').trim();

      if (!cleanIdentifier || !cleanPassword) {
        res.status(400).json({
          ok: false,
          error: 'Enter your User ID / Mobile / Email and Password.',
        });
        return;
      }

      let dataset = await readOrSeedEstateDataset();
      let user = findUserByIdentifier(dataset.users || [], cleanIdentifier);

      if (!user) {
        dataset = await mergeUsersFromSheetsIfConfigured(dataset);
        user = findUserByIdentifier(dataset.users || [], cleanIdentifier);
      }

      if (!user) {
        res.status(401).json({
          ok: false,
          error: 'Invalid credentials. Check your User ID / Mobile / Email and Password.',
        });
        return;
      }

      if (user.access_status === 'revoked') {
        res.status(403).json({
          ok: false,
          error:
            'Your Tenant Portal access has been revoked following move-out. Please contact the house owner if you need past records.',
        });
        return;
      }

      const validPassword = verifyPassword(
        cleanPassword,
        user.password_salt || '',
        user.password_hash || ''
      );
      if (!validPassword) {
        res.status(401).json({
          ok: false,
          error: 'Incorrect Password or PIN. Please try again or use Reset Password.',
        });
        return;
      }

      const token = await signAuthToken(user);
      const session = buildAuthSession(user, 'password', token);
      res.json({ ok: true, session });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Sign-in failed.',
      });
    }
  });

  app.post('/api/auth/signup', async (req: Request, res: Response) => {
    try {
      const {
        userId,
        fullName,
        email,
        mobileNumber,
        accessType,
        password,
        masterAdminPin,
      } = req.body as {
        userId?: string;
        fullName?: string;
        email?: string;
        mobileNumber?: string;
        accessType?: string;
        password?: string;
        masterAdminPin?: string;
      };

      const cleanUserId = String(userId || '').trim();
      const cleanFullName = String(fullName || '').trim();
      const cleanEmail = String(email || '').trim();
      const cleanMobile = normalizeMobile(mobileNumber || '');
      const cleanPassword = String(password || '').trim();
      const cleanAccessType = String(accessType || '').trim().toLowerCase();

      if (cleanAccessType === 'tenant') {
        res.status(403).json({
          ok: false,
          error:
            'Tenant accounts cannot self-register. Tenants receive portal login details from the house owner upon onboarding.',
        });
        return;
      }

      if (cleanAccessType !== 'admin' && cleanAccessType !== 'viewer') {
        res.status(400).json({
          ok: false,
          error: 'Access Type must be Admin or Viewer.',
        });
        return;
      }

      if (!cleanUserId || cleanUserId.length < 3) {
        res.status(400).json({
          ok: false,
          error: 'User ID must be at least 3 characters.',
        });
        return;
      }

      if (!cleanFullName) {
        res.status(400).json({ ok: false, error: 'Full Name is required.' });
        return;
      }

      if (!cleanEmail || !cleanEmail.includes('@')) {
        res.status(400).json({ ok: false, error: 'Valid Email address is required.' });
        return;
      }

      if (cleanMobile.length < 10) {
        res.status(400).json({
          ok: false,
          error: 'Valid 10-digit Mobile Number is required.',
        });
        return;
      }

      if (cleanPassword.length < 4) {
        res.status(400).json({
          ok: false,
          error: 'Password / PIN must be at least 4 characters.',
        });
        return;
      }

      let dataset = await readOrSeedEstateDataset();
      dataset = await mergeUsersFromSheetsIfConfigured(dataset);

      if (cleanAccessType === 'admin') {
        const enteredPin = String(masterAdminPin || '').trim().toUpperCase();
        const storedPin = (dataset.settings.master_admin_pin || 'SRKP2026ADMN')
          .trim()
          .toUpperCase();
        if (!MASTER_PIN_REGEX.test(enteredPin) || !timingSafeStringMatch(enteredPin, storedPin)) {
          res.status(403).json({
            ok: false,
            error:
              'Invalid 12-character Master Admin PIN. Contact an existing Admin to obtain the current PIN.',
          });
          return;
        }
      }

      const existingUsers = dataset.users || [];
      const conflict = existingUsers.find(
        (u) =>
          u.user_id.toLowerCase() === cleanUserId.toLowerCase() ||
          (u.email && u.email.toLowerCase() === cleanEmail.toLowerCase()) ||
          (normalizeMobile(u.mobile_number) === cleanMobile && cleanMobile.length === 10)
      );

      if (conflict) {
        res.status(409).json({
          ok: false,
          error:
            'An account with that User ID, Email, or Mobile Number already exists.',
        });
        return;
      }

      const now = new Date().toISOString();
      const { salt, hash } = hashPassword(cleanPassword);
      const newUser: AppUserAccount = {
        user_id: cleanUserId,
        full_name: cleanFullName,
        email: cleanEmail,
        mobile_number: cleanMobile,
        access_type: cleanAccessType as AccessType,
        access_status: 'active',
        must_reset_password: false,
        tenant_id: null,
        unit_id: null,
        password_salt: salt,
        password_hash: hash,
        created_at: now,
        updated_at: now,
      };

      const nextDataset: EstateDataset = {
        ...dataset,
        users: [...existingUsers, newUser],
      };

      await persistEstateDataset(nextDataset);
      void syncUsersAndConfigToSheets(nextDataset);

      const token = await signAuthToken(newUser);
      const session = buildAuthSession(newUser, 'password', token);
      res.status(201).json({ ok: true, session });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Sign-up failed.',
      });
    }
  });

  app.post('/api/auth/reset-password', async (req: Request, res: Response) => {
    try {
      const { identifier, newPassword } = req.body as {
        identifier?: string;
        newPassword?: string;
      };
      const cleanIdentifier = String(identifier || '').trim();
      const cleanPassword = String(newPassword || '').trim();

      if (!cleanIdentifier || cleanPassword.length < 4) {
        res.status(400).json({
          ok: false,
          error:
            'Enter your registered User ID / Mobile Number and a new password (min 4 characters).',
        });
        return;
      }

      let dataset = await readOrSeedEstateDataset();
      let user = findUserByIdentifier(dataset.users || [], cleanIdentifier);
      if (!user) {
        dataset = await mergeUsersFromSheetsIfConfigured(dataset);
        user = findUserByIdentifier(dataset.users || [], cleanIdentifier);
      }

      if (!user) {
        res.status(404).json({
          ok: false,
          error: 'No account matches that User ID or Mobile Number.',
        });
        return;
      }

      if (user.access_status === 'revoked') {
        res.status(403).json({
          ok: false,
          error:
            'This account has been revoked and cannot reset its password.',
        });
        return;
      }

      const { salt, hash } = hashPassword(cleanPassword);
      const now = new Date().toISOString();
      const nextUsers = (dataset.users || []).map((u) =>
        u.user_id.toLowerCase() === user!.user_id.toLowerCase()
          ? {
              ...u,
              password_salt: salt,
              password_hash: hash,
              must_reset_password: false,
              updated_at: now,
            }
          : u
      );

      const nextDataset: EstateDataset = { ...dataset, users: nextUsers };
      await persistEstateDataset(nextDataset);
      void syncUsersAndConfigToSheets(nextDataset);

      res.json({
        ok: true,
        message: 'Password updated successfully. You can now sign in.',
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Password reset failed.',
      });
    }
  });

  app.post('/api/auth/force-reset-password', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res);
    if (!auth) return;

    try {
      const { newPassword } = req.body as { newPassword?: string };
      const cleanPassword = String(newPassword || '').trim();
      if (cleanPassword.length < 4) {
        res.status(400).json({
          ok: false,
          error: 'New password must be at least 4 characters.',
        });
        return;
      }

      const { salt, hash } = hashPassword(cleanPassword);
      const now = new Date().toISOString();
      let updatedUser: AppUserAccount = {
        ...auth.user,
        password_salt: salt,
        password_hash: hash,
        must_reset_password: false,
        updated_at: now,
      };

      const nextUsers = (auth.dataset.users || []).map((u) =>
        u.user_id.toLowerCase() === auth.user.user_id.toLowerCase() ? updatedUser : u
      );
      const nextDataset: EstateDataset = { ...auth.dataset, users: nextUsers };
      await persistEstateDataset(nextDataset);
      void syncUsersAndConfigToSheets(nextDataset);

      const token = await signAuthToken(updatedUser);
      res.json({
        ok: true,
        session: buildAuthSession(updatedUser, 'password', token),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Could not set new password.',
      });
    }
  });

  app.post('/api/auth/change-password', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res);
    if (!auth) return;

    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword?: string;
      };
      const cleanCurrent = String(currentPassword || '').trim();
      const cleanNew = String(newPassword || '').trim();

      if (
        !verifyPassword(
          cleanCurrent,
          auth.user.password_salt || '',
          auth.user.password_hash || ''
        )
      ) {
        res.status(403).json({
          ok: false,
          error: 'Current password is incorrect.',
        });
        return;
      }

      if (cleanNew.length < 4) {
        res.status(400).json({
          ok: false,
          error: 'New password must be at least 4 characters.',
        });
        return;
      }

      const { salt, hash } = hashPassword(cleanNew);
      const now = new Date().toISOString();
      const updatedUser: AppUserAccount = {
        ...auth.user,
        password_salt: salt,
        password_hash: hash,
        must_reset_password: false,
        updated_at: now,
      };

      const nextUsers = (auth.dataset.users || []).map((u) =>
        u.user_id.toLowerCase() === auth.user.user_id.toLowerCase() ? updatedUser : u
      );
      const nextDataset: EstateDataset = { ...auth.dataset, users: nextUsers };
      await persistEstateDataset(nextDataset);
      void syncUsersAndConfigToSheets(nextDataset);

      res.json({ ok: true, message: 'Password changed successfully.' });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed changing password.',
      });
    }
  });

  app.post('/api/auth/biometric-resolve', async (req: Request, res: Response) => {
    try {
      const { identifier } = req.body as { identifier?: string };
      const cleanIdentifier = String(identifier || '').trim();
      if (!cleanIdentifier) {
        res.status(400).json({ ok: false, error: 'Missing biometric user identifier.' });
        return;
      }

      let dataset = await readOrSeedEstateDataset();
      let user = findUserByIdentifier(dataset.users || [], cleanIdentifier);
      if (!user) {
        dataset = await mergeUsersFromSheetsIfConfigured(dataset);
        user = findUserByIdentifier(dataset.users || [], cleanIdentifier);
      }

      if (!user) {
        res.status(404).json({
          ok: false,
          error: 'Biometric account is not registered. Sign in with password.',
        });
        return;
      }

      if (user.access_status === 'revoked') {
        res.status(403).json({
          ok: false,
          error:
            'Your Tenant Portal access has been revoked following move-out.',
        });
        return;
      }

      const token = await signAuthToken(user);
      res.json({
        ok: true,
        session: buildAuthSession(user, 'biometric', token),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Biometric sign-in failed.',
      });
    }
  });

  app.post('/api/auth/tenant-provision', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin']);
    if (!auth) return;

    try {
      const { tenantId, unitId, fullName, mobileNumber, oneTimePassword } = req.body as {
        tenantId?: string;
        unitId?: string;
        fullName?: string;
        mobileNumber?: string;
        oneTimePassword?: string;
      };

      const cleanMobile = normalizeMobile(mobileNumber || '');
      const cleanName = String(fullName || '').trim();
      const cleanTenantId = String(tenantId || '').trim();
      const cleanUnitId = String(unitId || '').trim();
      const cleanOtp = String(oneTimePassword || '').trim();

      if (!cleanTenantId || !cleanName || cleanMobile.length < 10 || cleanOtp.length < 4) {
        res.status(400).json({
          ok: false,
          error:
            'Tenant ID, Full Name, 10-digit Mobile Number, and One-Time Password (min 4 chars) are required.',
        });
        return;
      }

      const { salt, hash } = hashPassword(cleanOtp);
      const now = new Date().toISOString();
      const existingUsers = auth.dataset.users || [];

      const existingIdx = existingUsers.findIndex(
        (u) =>
          u.access_type === 'tenant' &&
          (u.tenant_id === cleanTenantId ||
            u.user_id === cleanMobile ||
            normalizeMobile(u.mobile_number) === cleanMobile)
      );

      const tenantUser: AppUserAccount = {
        user_id: cleanMobile,
        full_name: cleanName,
        email: '',
        mobile_number: cleanMobile,
        access_type: 'tenant',
        access_status: 'active',
        must_reset_password: true,
        tenant_id: cleanTenantId,
        unit_id: cleanUnitId || null,
        password_salt: salt,
        password_hash: hash,
        created_at:
          existingIdx >= 0 ? existingUsers[existingIdx].created_at : now,
        updated_at: now,
      };

      const nextUsers =
        existingIdx >= 0
          ? existingUsers.map((u, idx) => (idx === existingIdx ? tenantUser : u))
          : [...existingUsers, tenantUser];

      const nextDataset: EstateDataset = { ...auth.dataset, users: nextUsers };
      await persistEstateDataset(nextDataset);
      void syncUsersAndConfigToSheets(nextDataset);

      res.json({
        ok: true,
        user: sanitizeUserForClient(tenantUser),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed provisioning tenant account.',
      });
    }
  });

  app.post('/api/auth/tenant-revoke', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin']);
    if (!auth) return;

    try {
      const { tenantId, mobileNumber } = req.body as {
        tenantId?: string;
        mobileNumber?: string;
      };
      const cleanTenantId = String(tenantId || '').trim();
      const cleanMobile = normalizeMobile(mobileNumber || '');

      const now = new Date().toISOString();
      let revokedCount = 0;
      const nextUsers = (auth.dataset.users || []).map((u) => {
        if (
          u.access_type === 'tenant' &&
          ((cleanTenantId && u.tenant_id === cleanTenantId) ||
            (cleanMobile.length >= 10 && normalizeMobile(u.mobile_number) === cleanMobile))
        ) {
          revokedCount += 1;
          return {
            ...u,
            access_status: 'revoked' as const,
            updated_at: now,
          };
        }
        return u;
      });

      const nextDataset: EstateDataset = { ...auth.dataset, users: nextUsers };
      await persistEstateDataset(nextDataset);
      void syncUsersAndConfigToSheets(nextDataset);

      res.json({ ok: true, revokedCount });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed revoking tenant account.',
      });
    }
  });

  app.get('/api/auth/master-pin', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin']);
    if (!auth) return;
    res.json({
      ok: true,
      masterAdminPin: auth.dataset.settings.master_admin_pin || 'SRKP2026ADMN',
    });
  });

  app.post('/api/auth/master-pin', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin']);
    if (!auth) return;

    try {
      const { mode, customPin } = req.body as {
        mode?: 'generate' | 'custom';
        customPin?: string;
      };
      let nextPin = '';
      if (mode === 'generate') {
        nextPin = generateMasterAdminPin();
      } else {
        nextPin = String(customPin || '').trim().toUpperCase();
        if (!MASTER_PIN_REGEX.test(nextPin)) {
          res.status(400).json({
            ok: false,
            error:
              'Master Admin PIN must be exactly 12 alphanumeric characters (A-Z, 0-9).',
          });
          return;
        }
      }

      const nextDataset: EstateDataset = {
        ...auth.dataset,
        settings: {
          ...auth.dataset.settings,
          master_admin_pin: nextPin,
        },
      };
      await persistEstateDataset(nextDataset);
      void syncUsersAndConfigToSheets(nextDataset);

      res.json({ ok: true, masterAdminPin: nextPin });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed updating Master Admin PIN.',
      });
    }
  });

  // ==========================================
  // 1. Authenticated Full-Stack Persistence Endpoints
  // ==========================================

  app.get('/api/estate', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res);
    if (!auth) return;

    try {
      const { dataset, user } = auth;

      if (user.access_type === 'tenant') {
        const tenant =
          dataset.tenants.find((t) => t.id === user.tenant_id) ||
          dataset.tenants.find(
            (t) => normalizeMobile(t.whatsapp_phone) === normalizeMobile(user.mobile_number)
          );
        const scopedTenantId = tenant?.id || user.tenant_id || '';
        const scopedUnitId = tenant?.unit_id || user.unit_id || '';
        const scopedPropertyId = tenant?.property_id || '';

        const scopedDataset: EstateDataset = {
          properties: dataset.properties.filter(
            (p) => p.property_id === scopedPropertyId
          ),
          units: dataset.units.filter((u) => u.unit_id === scopedUnitId),
          tenants: tenant ? [tenant] : [],
          houseMaintenanceBills: [],
          utilityReadings: dataset.utilityReadings.filter(
            (r) => r.unit_id === scopedUnitId
          ),
          invoices: dataset.invoices.filter(
            (inv) =>
              inv.tenant_id === scopedTenantId || inv.unit_id === scopedUnitId
          ),
          expenses: [],
          requests: [],
          users: [sanitizeUserForClient(user)],
          settings: {
            merchant_upi_id: dataset.settings.merchant_upi_id,
            merchant_name: dataset.settings.merchant_name,
            owner_whatsapp_phone: dataset.settings.owner_whatsapp_phone,
            last_synced_at: dataset.settings.last_synced_at,
            auto_lock_timer: dataset.settings.auto_lock_timer,
          },
        };
        res.json({ exists: true, data: scopedDataset });
        return;
      }

      const safeSettings =
        user.access_type === 'admin'
          ? dataset.settings
          : {
              ...dataset.settings,
              master_admin_pin: undefined,
            };

      res.json({
        exists: true,
        data: {
          ...dataset,
          users: (dataset.users || []).map(sanitizeUserForClient),
          settings: safeSettings,
        },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load estate data';
      res.status(500).json({ error: message });
    }
  });

  app.put('/api/estate', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin']);
    if (!auth) return;

    try {
      const incoming = (req.body || {}) as Partial<EstateDataset>;
      const existing = auth.dataset;

      // Preserve server-side password hashes & master_admin_pin cleanly
      const existingUserMap = new Map<string, AppUserAccount>();
      (existing.users || []).forEach((u) =>
        existingUserMap.set(u.user_id.toLowerCase(), u)
      );

      let mergedUsers = existing.users || [];
      if (Array.isArray(incoming.users)) {
        mergedUsers = incoming.users.map((u) => {
          const prev = existingUserMap.get(String(u.user_id || '').toLowerCase());
          return {
            ...u,
            password_salt: u.password_salt || prev?.password_salt || '',
            password_hash: u.password_hash || prev?.password_hash || '',
          };
        });
      }

      const nextMasterPin =
        incoming.settings?.master_admin_pin &&
        MASTER_PIN_REGEX.test(incoming.settings.master_admin_pin.trim().toUpperCase())
          ? incoming.settings.master_admin_pin.trim().toUpperCase()
          : existing.settings.master_admin_pin;

      const mergedDataset: EstateDataset = {
        ...existing,
        ...incoming,
        users: mergedUsers,
        settings: {
          ...existing.settings,
          ...(incoming.settings || {}),
          master_admin_pin: nextMasterPin,
        },
      };

      await persistEstateDataset(mergedDataset);
      res.json({ ok: true, savedAt: new Date().toISOString() });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to persist estate data';
      res.status(500).json({ error: message });
    }
  });

  // 1a. Shareable Tenant Portal Read (Non-secret view) & Requests
  app.get('/api/portal/tenant/:tenantId', async (req: Request, res: Response) => {
    try {
      const tenantId = String(req.params.tenantId || '').trim();
      const dataset = await readOrSeedEstateDataset();

      const tenant = dataset.tenants.find((t) => t.id === tenantId);
      if (!tenant) {
        res.status(404).json({ error: 'Tenant portal record not found.' });
        return;
      }

      const property =
        dataset.properties.find((p) => p.property_id === tenant.property_id) || null;
      const unit = dataset.units.find((u) => u.unit_id === tenant.unit_id) || null;
      const invoices = dataset.invoices
        .filter((inv) => inv.tenant_id === tenant.id)
        .sort((a, b) => b.billing_month.localeCompare(a.billing_month));
      const requests = (dataset.requests || [])
        .filter((r) => r.tenant_id === tenant.id || r.unit_id === tenant.unit_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));

      res.json({
        ok: true,
        tenant: {
          id: tenant.id,
          property_id: tenant.property_id,
          unit_id: tenant.unit_id,
          full_name: tenant.full_name,
          whatsapp_phone: tenant.whatsapp_phone,
          move_in_date: tenant.move_in_date,
          lease_end_date: tenant.lease_end_date,
          lease_type: tenant.lease_type,
          monthly_rent: tenant.monthly_rent,
          monthly_maintenance_charge: tenant.monthly_maintenance_charge,
          water_charge: tenant.water_charge,
          is_active: tenant.is_active,
        },
        property,
        unit,
        invoices,
        requests,
        paymentInfo: {
          merchant_upi_id: dataset.settings.merchant_upi_id,
          merchant_name: dataset.settings.merchant_name,
          owner_whatsapp_phone: dataset.settings.owner_whatsapp_phone,
        },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load tenant portal data.';
      res.status(500).json({ error: message });
    }
  });

  app.post(
    '/api/portal/tenant/:tenantId/requests',
    async (req: Request, res: Response) => {
      try {
        const tenantId = String(req.params.tenantId || '').trim();
        const { category, title, description } = req.body as {
          category?: RequestCategory;
          title?: string;
          description?: string;
        };

        const validCategories = new Set<RequestCategory>([
          'Plumbing',
          'Electrical',
          'Painting',
          'Other',
        ]);
        const cleanCategory: RequestCategory =
          category && validCategories.has(category) ? category : 'Other';
        const cleanTitle = String(title || '').trim();
        const cleanDescription = String(description || '').trim();

        if (!cleanTitle || !cleanDescription) {
          res.status(400).json({ error: 'Issue title and description are required.' });
          return;
        }

        const dataset = await readOrSeedEstateDataset();
        const tenant = dataset.tenants.find((t) => t.id === tenantId);
        if (!tenant) {
          res.status(404).json({ error: 'Tenant record not found.' });
          return;
        }

        const property = dataset.properties.find(
          (p) => p.property_id === tenant.property_id
        );
        const unit = dataset.units.find((u) => u.unit_id === tenant.unit_id);
        const nowIso = new Date().toISOString();

        const newRequest: MaintenanceRequest = {
          id: `REQ-${Date.now().toString().slice(-6)}`,
          property_id: tenant.property_id,
          property_name: property?.property_name || tenant.property_id,
          unit_id: tenant.unit_id,
          unit_name: unit?.unit_name || tenant.unit_id,
          tenant_id: tenant.id,
          tenant_name: tenant.full_name,
          category: cleanCategory,
          title: cleanTitle,
          description: cleanDescription,
          status: 'Open',
          reported_by: 'Tenant Portal',
          created_at: nowIso,
          updated_at: nowIso,
          resolved_at: null,
          resolution_note: '',
        };

        const nextRequests = [newRequest, ...(dataset.requests || [])];
        const nextDataset: EstateDataset = {
          ...dataset,
          requests: nextRequests,
        };

        await persistEstateDataset(nextDataset);
        const sheetResult = await syncTableServer('Requests', nextRequests);

        res.status(201).json({
          ok: true,
          request: newRequest,
          sheetsSynced: sheetResult.ok,
          sheetsNote: sheetResult.ok
            ? 'Saved to Requests tab in Google Sheets'
            : sheetResult.error || 'Saved locally; Sheets sync pending',
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to submit maintenance request.';
        res.status(500).json({ error: message });
      }
    }
  );

  // 1b. Lease Agreement Upload & Static Serving
  app.post('/api/agreements/upload', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin']);
    if (!auth) return;

    try {
      const { fileName, mimeType, dataUrl } = req.body as {
        fileName?: string;
        mimeType?: string;
        dataUrl?: string;
      };
      if (!fileName || !dataUrl || !dataUrl.includes(',')) {
        res.status(400).json({ error: 'Invalid agreement payload.' });
        return;
      }
      await ensureDataDir();
      const safeBase = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storedName = `${Date.now()}-${safeBase}`;
      const base64Data = dataUrl.split(',')[1];
      await fs.writeFile(
        path.join(AGREEMENTS_DIR, storedName),
        Buffer.from(base64Data, 'base64')
      );
      res.json({
        ok: true,
        url: `/api/agreements/${encodeURIComponent(storedName)}`,
        mimeType: mimeType || 'application/octet-stream',
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to store lease agreement';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/agreements/:filename', async (req: Request, res: Response) => {
    try {
      const safeName = path.basename(req.params.filename);
      const filePath = path.join(AGREEMENTS_DIR, safeName);
      const data = await fs.readFile(filePath);
      const ext = path.extname(safeName).toLowerCase();
      const contentType =
        ext === '.pdf'
          ? 'application/pdf'
          : ext === '.png'
            ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
      res.send(data);
    } catch {
      res.status(404).json({ error: 'Agreement document not found' });
    }
  });

  // 2. Gemini Vision / OCR Extraction Endpoint (EB Bills & Water Meters)
  app.post('/api/ocr/extract', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin']);
    if (!auth) return;

    try {
      const { imageBase64, mimeType, mode } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        mode?: 'eb_bill' | 'water_meter' | 'common_eb';
      };

      if (!imageBase64 || !mimeType || !mode) {
        res.status(400).json({
          error: 'Missing imageBase64, mimeType, or extraction mode.',
        });
        return;
      }

      const ai = createGeminiClient();
      const cleanBase64 = imageBase64.includes(',')
        ? imageBase64.split(',')[1]
        : imageBase64;

      if (mode === 'water_meter') {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: cleanBase64,
                },
              },
              {
                text: 'Inspect this Indian water sub-meter photo (BWSSB / CMWSSB / analog or digital water meter). Extract the numeric cumulative meter reading shown on the main odometer drums/digits, any visible serial/RR number, and the unit (kL or Liters). Return accurate JSON only.',
              },
            ],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                meter_reading: {
                  type: Type.NUMBER,
                  description:
                    'Numeric water meter reading extracted from the display.',
                },
                rr_or_serial: {
                  type: Type.STRING,
                  description:
                    'Visible meter serial or RR number if readable, else empty string.',
                },
                unit_label: {
                  type: Type.STRING,
                  description: 'Detected unit such as kL, m3, or Liters.',
                },
                confidence: {
                  type: Type.STRING,
                  description: 'High, Medium, or Low confidence.',
                },
                notes: {
                  type: Type.STRING,
                  description: 'Brief reading verification note.',
                },
              },
              required: ['meter_reading', 'confidence', 'notes'],
            },
          },
        });

        const parsed = JSON.parse((response.text || '{}').trim());
        res.json({ ok: true, mode, extracted: parsed });
        return;
      }

      const promptText =
        mode === 'common_eb'
          ? 'Extract the total payable electricity bill amount (in INR) from this Indian common-area BESCOM / TNEB electricity bill screenshot or receipt, along with RR / Consumer Number, provider name, and billing period.'
          : 'Extract the total payable electricity bill amount (in INR) from this Indian BESCOM / TNEB electricity bill screenshot or photo, along with RR / Account ID / Consumer Number, utility provider, and billing month.';

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: cleanBase64,
              },
            },
            {
              text: promptText,
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              bill_amount: {
                type: Type.NUMBER,
                description: 'Total net payable electricity bill amount in INR.',
              },
              rr_number: {
                type: Type.STRING,
                description:
                  'Extracted BESCOM RR Number or TNEB Consumer Number if visible.',
              },
              provider: {
                type: Type.STRING,
                description: 'Utility provider e.g. BESCOM or TNEB.',
              },
              billing_period: {
                type: Type.STRING,
                description: 'Billing month/period shown on the bill.',
              },
              confidence: {
                type: Type.STRING,
                description: 'High, Medium, or Low confidence.',
              },
              notes: {
                type: Type.STRING,
                description: 'Short summary of extracted line items.',
              },
            },
            required: ['bill_amount', 'confidence', 'notes'],
          },
        },
      });

      const parsed = JSON.parse((response.text || '{}').trim());
      res.json({ ok: true, mode, extracted: parsed });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gemini OCR extraction failed';
      console.error('OCR error:', message);
      res.status(500).json({ error: message });
    }
  });

  // 3. Managed Google Sheets Service Account Sync Endpoints
  const ALLOWED_SHEET_TABS = new Set<string>(REQUIRED_SHEET_TABS);

  app.post('/api/sheets/sa-token', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin']);
    if (!auth) return;

    try {
      const { assertion } = req.body as { assertion?: string };
      if (!assertion || typeof assertion !== 'string' || assertion.split('.').length !== 3) {
        res.status(400).json({ error: 'Invalid signed JWT assertion payload.' });
        return;
      }

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
      });

      const data = await tokenRes.json().catch(() => ({}));
      res.status(tokenRes.status).json(data);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'OAuth2 token relay failed.',
      });
    }
  });

  app.get('/api/sheets/status', (_req: Request, res: Response) => {
    res.json(getSheetsConfigSummary());
  });

  app.post('/api/sheets/pull', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin', 'viewer']);
    if (!auth) return;

    const result = await pullAllFromSheetServer();
    if (result.ok && result.data) {
      // Import server-side user hashes & master pin into DB when present in Sheet
      let nextDataset = { ...auth.dataset };
      let dbChanged = false;

      if (Array.isArray(result.data.Users) && result.data.Users.length > 0) {
        const sheetUsers = result.data.Users.map((r) =>
          normalizeUserRecord(r)
        ).filter((u) => u.user_id && u.password_hash && u.password_salt);
        if (sheetUsers.length > 0) {
          const userMap = new Map<string, AppUserAccount>();
          (nextDataset.users || []).forEach((u) =>
            userMap.set(u.user_id.toLowerCase(), u)
          );
          sheetUsers.forEach((su) => userMap.set(su.user_id.toLowerCase(), su));
          nextDataset.users = Array.from(userMap.values());
          dbChanged = true;
        }
      }

      const appConfigRows = result.data.AppConfig || [];
      const pinRow = appConfigRows.find(
        (r) => String(r.key || '').trim() === 'master_admin_pin'
      );
      const sheetPin = String(pinRow?.value || '').trim().toUpperCase();
      if (MASTER_PIN_REGEX.test(sheetPin)) {
        nextDataset.settings = {
          ...nextDataset.settings,
          master_admin_pin: sheetPin,
        };
        dbChanged = true;
      }

      if (dbChanged) {
        await persistEstateDataset(nextDataset);
      }

      // Sanitize sensitive credentials from response payload based on role
      result.data.Users = (result.data.Users || []).map((u) => {
        const norm = normalizeUserRecord(u);
        return sanitizeUserForClient(norm) as unknown as Record<string, unknown>;
      });
      if (auth.user.access_type !== 'admin') {
        result.data.AppConfig = [];
      }
    }

    res.status(result.ok ? 200 : result.httpStatus || 500).json(result);
  });

  app.post('/api/sheets/push-all', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin']);
    if (!auth) return;

    const clientDataset = (req.body?.dataset || req.body || {}) as ServerDatasetPayload;
    const mergedPayload: ServerDatasetPayload = {
      ...clientDataset,
      users: auth.dataset.users || [],
      appConfig: buildAppConfigRows(auth.dataset),
    };
    const result = await pushAllTablesServer(mergedPayload);
    res.status(result.ok ? 200 : result.httpStatus || 500).json(result);
  });

  app.post('/api/sheets/sync-table', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin']);
    if (!auth) return;

    const { table, records } = req.body as {
      table?: string;
      records?: unknown[];
    };
    if (!table || !ALLOWED_SHEET_TABS.has(table) || !Array.isArray(records)) {
      res.status(400).json({ ok: false, error: 'Invalid table or records payload.' });
      return;
    }

    const effectiveRecords =
      table === 'Users'
        ? auth.dataset.users || []
        : table === 'AppConfig'
          ? buildAppConfigRows(auth.dataset)
          : records;

    const result = await syncTableServer(table as SyncTable, effectiveRecords);
    res.status(result.ok ? 200 : result.httpStatus || 500).json(result);
  });

  app.post('/api/sheets/test-and-sync', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin']);
    if (!auth) return;

    const clientDataset = (req.body?.dataset || req.body || {}) as ServerDatasetPayload;
    const mergedPayload: ServerDatasetPayload = {
      ...clientDataset,
      users: auth.dataset.users || [],
      appConfig: buildAppConfigRows(auth.dataset),
    };
    const result = await testConnectionAndSyncServer(mergedPayload);
    if (result.pulledData) {
      result.pulledData.Users = (result.pulledData.Users || []).map((u) =>
        sanitizeUserForClient(normalizeUserRecord(u)) as unknown as Record<string, unknown>
      );
    }
    res.json(result);
  });

  app.get('/api/sheets/public-pull', async (req: Request, res: Response) => {
    const auth = await requireAuthSession(req, res, ['admin', 'viewer']);
    if (!auth) return;

    try {
      const tab = String(req.query.tab || '').trim();
      if (!ALLOWED_SHEET_TABS.has(tab) || tab === 'Users' || tab === 'AppConfig') {
        res.status(400).json({ error: 'Invalid or restricted sheet tab requested.' });
        return;
      }

      const gvizUrl = `https://docs.google.com/spreadsheets/d/${HARDCODED_SPREADSHEET_ID}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(
        tab
      )}`;
      const upstream = await fetch(gvizUrl, { redirect: 'follow' });
      const text = await upstream.text();

      if (!upstream.ok || !text.includes('google.visualization.Query.setResponse')) {
        res.status(upstream.ok ? 403 : upstream.status).json({
          httpStatus: upstream.status,
          error: `Sheet read failed (HTTP ${upstream.status}).`,
        });
        return;
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(text);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to read Google Sheet endpoint';
      res.status(502).json({ httpStatus: 502, error: message });
    }
  });

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  // 4. Mount Vite in development or serve built static files in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
      plugins: [
        {
          name: 'ai-studio-disable-hmr-ws',
          enforce: 'post',
          transform(code, id) {
            if (id.includes('vite/dist/client/client.mjs')) {
              const patched = code
                .replace(
                  'transport.connect(createHMRHandler(handleMessage));',
                  '/* HMR WebSocket disabled */'
                )
                .replace(
                  'send(payload) {\n\t\tthis.transport.send(payload).catch((err) => {\n\t\t\tthis.logger.error(err);\n\t\t});\n\t}',
                  'send(payload) {\n\t\tthis.transport.send(payload).catch((err) => {\n\t\t\tif (!(err instanceof SendBeforeConnectError)) this.logger.error(err);\n\t\t});\n\t}'
                );
              return {
                code: patched,
                map: null,
              };
            }
            if (id.includes('pwa-entry-point-loaded')) {
              return {
                code: 'export default function registerDevSW() {}',
                map: null,
              };
            }
          },
        },
      ],
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (
            base === 'index.html' ||
            base === 'sw.js' ||
            base === 'manifest.webmanifest' ||
            base.startsWith('workbox-')
          ) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (req: Request, res: Response) => {
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/assets/') ||
        Boolean(path.extname(req.path))
      ) {
        res.status(404).send('Not found');
        return;
      }
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SRKP Rental Tool full-stack server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
