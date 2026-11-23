import crypto from 'crypto';

export type SyncTable =
  | 'Properties'
  | 'Units'
  | 'Tenants'
  | 'BuildingMaintenance'
  | 'UtilityReadings'
  | 'Invoices'
  | 'Expenses'
  | 'Requests'
  | 'Users'
  | 'AppConfig';

export const HARDCODED_SPREADSHEET_ID = '1rV0SGO7fB5BB56xa3dmhL1eicYQF68hekT2rrSMswD0';
const SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() ||
  process.env.VITE_GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() ||
  'srkp-property-id@gen-lang-client-0777079345.iam.gserviceaccount.com';

const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SHEETS_API_BASE = `https://sheets.googleapis.com/v4/spreadsheets/${HARDCODED_SPREADSHEET_ID}`;

export const REQUIRED_SHEET_TABS: SyncTable[] = [
  'Properties',
  'Units',
  'Tenants',
  'BuildingMaintenance',
  'UtilityReadings',
  'Invoices',
  'Expenses',
  'Requests',
  'Users',
  'AppConfig',
];

export const TAB_HEADERS: Record<SyncTable, string[]> = {
  Properties: [
    'property_id',
    'property_name',
    'address',
    'total_floors',
    'common_eb_rr_number',
    'utility_provider',
  ],
  Units: [
    'unit_id',
    'property_id',
    'unit_name',
    'unit_type',
    'floor',
    'eb_rr_number',
    'water_rr_number',
    'water_rr_number2',
    'status',
    'current_tenant_id',
    'last_water_reading_1',
    'last_water_reading_2',
  ],
  Tenants: [
    'id',
    'property_id',
    'unit_id',
    'full_name',
    'whatsapp_phone',
    'move_in_date',
    'tenure_months',
    'lease_end_date',
    'move_out_date',
    'lease_type',
    'monthly_rent',
    'security_deposit',
    'lease_deposit',
    'monthly_maintenance_charge',
    'water_charge',
    'initial_water_reading_1',
    'initial_water_reading_2',
    'is_active',
    'agreement_file',
    'agreement_url',
    'deductions',
    'final_refundable_amount',
  ],
  BuildingMaintenance: [
    'id',
    'property_id',
    'billing_month',
    'common_eb_amount',
    'additional_charges',
    'total_house_maintenance',
    'updated_at',
  ],
  UtilityReadings: [
    'id',
    'property_id',
    'unit_id',
    'billing_month',
    'eb_bill_amount',
    'eb_paid_to_owner',
    'prev_reading_1',
    'curr_reading_1',
    'prev_reading_2',
    'curr_reading_2',
    'net_consumption',
    'water_rate',
    'water_bill_amount',
    'captured_at',
  ],
  Invoices: [
    'id',
    'property_id',
    'property_name',
    'unit_id',
    'tenant_id',
    'billing_month',
    'unit_name',
    'unit_type',
    'floor',
    'tenant_name',
    'whatsapp_phone',
    'lease_type',
    'rent_amount',
    'tenant_cleaning_fee',
    'building_maintenance_total',
    'building_unit_count',
    'building_maintenance_share',
    'building_maintenance_items',
    'eb_amount',
    'eb_paid_to_owner',
    'water_prev_1',
    'water_curr_1',
    'water_prev_2',
    'water_curr_2',
    'water_net_units',
    'water_rate',
    'water_amount',
    'carried_forward_balance',
    'total_bill_value',
    'total_payable_to_owner',
    'amount_paid',
    'balance_due',
    'payment_status',
    'is_locked',
    'keb_account_id',
    'water_reference',
    'motor_bill_amount',
    'others_amount',
    'due_date',
    'generated_at',
    'paid_at',
    'closed_at',
  ],
  Expenses: [
    'id',
    'date',
    'month',
    'house_id',
    'house_name',
    'category',
    'description',
    'amount',
    'created_by',
  ],
  Requests: [
    'id',
    'property_id',
    'property_name',
    'unit_id',
    'unit_name',
    'tenant_id',
    'tenant_name',
    'category',
    'title',
    'description',
    'status',
    'reported_by',
    'created_at',
    'updated_at',
    'resolved_at',
    'resolution_note',
  ],
  Users: [
    'user_id',
    'full_name',
    'email',
    'mobile_number',
    'access_type',
    'access_status',
    'password_salt',
    'password_hash',
    'created_at',
    'updated_at',
  ],
  AppConfig: ['key', 'value', 'updated_at'],
};

export interface ServerTabStatus {
  tab: string;
  ok: boolean;
  httpStatus?: number;
  rows?: number;
  created?: boolean;
  error?: string;
}

export interface ServerSyncDiagnostics {
  connected: boolean;
  authMode: 'service_account' | 'iam_impersonation' | 'none';
  httpStatus?: number;
  tokenStatus?: string;
  message: string;
  testedAt: string;
  tabStatuses: ServerTabStatus[];
}

interface TokenCacheEntry {
  accessToken: string;
  expiresAtMs: number;
  authMode: 'service_account' | 'iam_impersonation';
  tokenStatus: string;
}

let cachedServerToken: TokenCacheEntry | null = null;
let verifiedTabsInSession = new Set<string>();

class SheetsServerError extends Error {
  httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = 'SheetsServerError';
    this.httpStatus = httpStatus;
  }
}

interface ParsedSaCreds {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
}

function normalizePemPrivateKey(raw: string): string {
  let cleaned = raw.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
}

function getEnvServiceAccountCreds(): {
  configured: boolean;
  creds?: ParsedSaCreds;
  error?: string;
} {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const rawPrivateKey = (
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.VITE_GOOGLE_PRIVATE_KEY ||
    ''
  ).trim();

  const tryParseJsonCreds = (jsonText: string): {
    configured: boolean;
    creds?: ParsedSaCreds;
    error?: string;
  } => {
    try {
      const parsed = JSON.parse(jsonText) as Partial<ParsedSaCreds>;
      if (!parsed.private_key || !parsed.private_key.includes('PRIVATE KEY')) {
        return {
          configured: false,
          error: 'Server Google Sheets credentials are missing a valid private key.',
        };
      }
      return {
        configured: true,
        creds: {
          client_email: (parsed.client_email || SERVICE_ACCOUNT_EMAIL).trim(),
          private_key: normalizePemPrivateKey(parsed.private_key),
          private_key_id: parsed.private_key_id,
          token_uri: parsed.token_uri || DEFAULT_TOKEN_URI,
        },
      };
    } catch {
      return {
        configured: false,
        error: 'Server Google Sheets JSON credential is malformed.',
      };
    }
  };

  if (rawJson) {
    return tryParseJsonCreds(rawJson);
  }

  if (rawPrivateKey) {
    if (rawPrivateKey.startsWith('{')) {
      return tryParseJsonCreds(rawPrivateKey);
    }
    const normalizedKey = normalizePemPrivateKey(rawPrivateKey);
    if (normalizedKey.includes('PRIVATE KEY')) {
      return {
        configured: true,
        creds: {
          client_email: SERVICE_ACCOUNT_EMAIL,
          private_key: normalizedKey,
          token_uri: DEFAULT_TOKEN_URI,
        },
      };
    }
  }

  return { configured: false };
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function mintTokenViaServiceAccountKey(creds: ParsedSaCreds): Promise<{
  ok: boolean;
  accessToken?: string;
  httpStatus: number;
  tokenStatus: string;
  error?: string;
}> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (creds.private_key_id) header.kid = creds.private_key_id;

  const payload = {
    iss: creds.client_email,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: creds.token_uri || DEFAULT_TOKEN_URI,
    iat: nowSec - 30,
    exp: nowSec + 3570,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(creds.private_key);
  const assertion = `${signingInput}.${base64UrlEncode(signature)}`;

  const tokenRes = await fetch(creds.token_uri || DEFAULT_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  const data = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !data.access_token) {
    return {
      ok: false,
      httpStatus: tokenRes.status,
      tokenStatus: 'Secret JWT Exchange Failed',
      error:
        data.error_description ||
        data.error ||
        `Google OAuth2 token endpoint returned HTTP ${tokenRes.status}.`,
    };
  }

  const expiresIn = data.expires_in || 3600;
  cachedServerToken = {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + expiresIn * 1000,
    authMode: 'service_account',
    tokenStatus: 'Service Account Bearer Active',
  };

  return {
    ok: true,
    accessToken: data.access_token,
    httpStatus: tokenRes.status,
    tokenStatus: cachedServerToken.tokenStatus,
  };
}

async function mintTokenViaIamImpersonation(): Promise<{
  ok: boolean;
  accessToken?: string;
  httpStatus: number;
  tokenStatus: string;
  error?: string;
}> {
  try {
    const metaRes = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } }
    );
    if (!metaRes.ok) {
      return {
        ok: false,
        httpStatus: 401,
        tokenStatus: 'Credentials Not Configured',
        error: 'Google Sheets service account credentials are not configured in environment variables.',
      };
    }

    const metaData = (await metaRes.json()) as { access_token?: string };
    if (!metaData.access_token) {
      return {
        ok: false,
        httpStatus: 401,
        tokenStatus: 'Credentials Not Configured',
        error: 'Google Sheets service account credentials are not configured in environment variables.',
      };
    }

    const impRes = await fetch(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(
        SERVICE_ACCOUNT_EMAIL
      )}:generateAccessToken`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${metaData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope: [GOOGLE_SHEETS_SCOPE],
        }),
      }
    );

    const impData = (await impRes.json().catch(() => ({}))) as {
      accessToken?: string;
      expireTime?: string;
    };

    if (!impRes.ok || !impData.accessToken) {
      return {
        ok: false,
        httpStatus: impRes.status,
        tokenStatus: 'Credentials Required',
        error: 'Google Sheets sync requires service account key environment variables (VITE_GOOGLE_PRIVATE_KEY or GOOGLE_SERVICE_ACCOUNT_JSON) to be set.',
      };
    }

    const expiresAtMs = impData.expireTime
      ? Date.parse(impData.expireTime)
      : Date.now() + 3000_000;

    cachedServerToken = {
      accessToken: impData.accessToken,
      expiresAtMs,
      authMode: 'iam_impersonation',
      tokenStatus: 'IAM Token Active',
    };

    return {
      ok: true,
      accessToken: impData.accessToken,
      httpStatus: impRes.status,
      tokenStatus: cachedServerToken.tokenStatus,
    };
  } catch {
    return {
      ok: false,
      httpStatus: 401,
      tokenStatus: 'Credentials Not Configured',
      error: 'Google Sheets service account credentials are not configured in environment variables.',
    };
  }
}

export async function getGoogleSheetsAccessToken(forceRefresh = false): Promise<{
  ok: boolean;
  accessToken?: string;
  authMode: 'service_account' | 'iam_impersonation' | 'none';
  httpStatus: number;
  tokenStatus: string;
  error?: string;
}> {
  if (
    !forceRefresh &&
    cachedServerToken &&
    cachedServerToken.expiresAtMs > Date.now() + 60_000
  ) {
    return {
      ok: true,
      accessToken: cachedServerToken.accessToken,
      authMode: cachedServerToken.authMode,
      httpStatus: 200,
      tokenStatus: cachedServerToken.tokenStatus,
    };
  }

  const envCreds = getEnvServiceAccountCreds();
  if (envCreds.error) {
    return {
      ok: false,
      authMode: 'none',
      httpStatus: 500,
      tokenStatus: 'Invalid Credentials',
      error: envCreds.error,
    };
  }

  if (envCreds.configured && envCreds.creds) {
    const res = await mintTokenViaServiceAccountKey(envCreds.creds);
    return {
      ok: res.ok,
      accessToken: res.accessToken,
      authMode: res.ok ? 'service_account' : 'none',
      httpStatus: res.httpStatus,
      tokenStatus: res.tokenStatus,
      error: res.error,
    };
  }

  const impRes = await mintTokenViaIamImpersonation();
  return {
    ok: impRes.ok,
    accessToken: impRes.accessToken,
    authMode: impRes.ok ? 'iam_impersonation' : 'none',
    httpStatus: impRes.httpStatus,
    tokenStatus: impRes.tokenStatus,
    error: impRes.error,
  };
}

export function getSheetsConfigSummary(): {
  spreadsheetId: string;
  secretConfigured: boolean;
} {
  const envCreds = getEnvServiceAccountCreds();
  return {
    spreadsheetId: HARDCODED_SPREADSHEET_ID,
    secretConfigured: envCreds.configured,
  };
}

async function fetchSheetsApiJson<T>(
  url: string,
  accessToken: string,
  init?: RequestInit
): Promise<{ data: T; httpStatus: number }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new SheetsServerError(
      `Google Sheets API returned non-JSON (HTTP ${res.status}).`,
      res.status
    );
  }

  if (!res.ok) {
    const errObj = json as { error?: { message?: string; status?: string } };
    throw new SheetsServerError(
      errObj?.error?.message || `Google Sheets API error (HTTP ${res.status})`,
      res.status
    );
  }

  return { data: json as T, httpStatus: res.status };
}

function serializeCellValue(val: unknown): string | number | boolean {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean' || typeof val === 'number') return val;
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function sanitizeTenantForSheet(tenant: Record<string, unknown>): Record<string, unknown> {
  const { agreement_file, ...rest } = tenant;
  if (!agreement_file || typeof agreement_file !== 'object') {
    return { ...rest, agreement_file: '' };
  }
  const af = agreement_file as Record<string, unknown>;
  return {
    ...rest,
    agreement_file: {
      name: af.name || '',
      mime_type: af.mime_type || '',
      size_bytes: af.size_bytes || 0,
      server_url: af.server_url || '',
      uploaded_at: af.uploaded_at || '',
    },
  };
}

function objectsToMatrix(
  table: SyncTable,
  records: unknown[]
): (string | number | boolean)[][] {
  const baseHeaders = [...TAB_HEADERS[table]];
  const normalizedRecords = records.map((item) => {
    const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return table === 'Tenants' ? sanitizeTenantForSheet(rec) : rec;
  });

  normalizedRecords.forEach((rec) => {
    Object.keys(rec).forEach((k) => {
      if (!baseHeaders.includes(k)) {
        baseHeaders.push(k);
      }
    });
  });

  const matrix: (string | number | boolean)[][] = [baseHeaders];
  normalizedRecords.forEach((rec) => {
    matrix.push(baseHeaders.map((h) => serializeCellValue(rec[h])));
  });
  return matrix;
}

function normalizeParsedCell(header: string, rawVal: unknown): unknown {
  if (rawVal === null || rawVal === undefined || rawVal === '') return '';

  if (typeof rawVal === 'string') {
    const trimmed = rawVal.trim();
    const gvizDateMatch = /^Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})(?:,.*)?\)$/.exec(
      trimmed
    );
    if (gvizDateMatch) {
      const y = gvizDateMatch[1];
      const m = String(Number(gvizDateMatch[2]) + 1).padStart(2, '0');
      const d = String(Number(gvizDateMatch[3])).padStart(2, '0');
      return header === 'billing_month' || header === 'month' ? `${y}-${m}` : `${y}-${m}-${d}`;
    }

    if ((header === 'billing_month' || header === 'month') && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 7);
    }

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }
    if (trimmed === 'TRUE' || trimmed === 'true') return true;
    if (trimmed === 'FALSE' || trimmed === 'false') return false;
    return trimmed;
  }

  return rawVal;
}

function rowsToObjects(headers: string[], dataRows: unknown[][]): Record<string, unknown>[] {
  const cleanHeaders = headers.map((h) => String(h || '').trim());
  return dataRows
    .filter(
      (row) =>
        Array.isArray(row) &&
        row.some((cell) => cell !== '' && cell !== null && cell !== undefined)
    )
    .map((row) => {
      const obj: Record<string, unknown> = {};
      cleanHeaders.forEach((h, idx) => {
        if (!h) return;
        obj[h] = normalizeParsedCell(h, row[idx]);
      });
      return obj;
    });
}

export async function ensureRequiredSheetTabs(accessToken: string): Promise<{
  existingTabs: string[];
  createdTabs: SyncTable[];
  httpStatus: number;
}> {
  const { data: meta, httpStatus } = await fetchSheetsApiJson<{
    sheets?: Array<{ properties?: { title?: string; sheetId?: number } }>;
  }>(`${SHEETS_API_BASE}?fields=sheets.properties(title,sheetId)`, accessToken);

  const existingTitles = (meta.sheets || [])
    .map((s) => s.properties?.title || '')
    .filter(Boolean);

  const missingTabs = REQUIRED_SHEET_TABS.filter((tab) => !existingTitles.includes(tab));

  if (missingTabs.length > 0) {
    await fetchSheetsApiJson(`${SHEETS_API_BASE}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        requests: missingTabs.map((title) => ({
          addSheet: {
            properties: {
              title,
              gridProperties: { frozenRowCount: 1 },
            },
          },
        })),
      }),
    });

    await fetchSheetsApiJson(`${SHEETS_API_BASE}/values:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: missingTabs.map((tab) => ({
          range: `${tab}!A1`,
          majorDimension: 'ROWS',
          values: [TAB_HEADERS[tab]],
        })),
      }),
    });
  }

  const allExisting = Array.from(new Set([...existingTitles, ...missingTabs]));
  verifiedTabsInSession = new Set(allExisting);

  return { existingTabs: allExisting, createdTabs: missingTabs, httpStatus };
}

export async function syncTableServer(
  table: SyncTable,
  records: unknown[],
  providedAccessToken?: string
): Promise<{
  ok: boolean;
  httpStatus?: number;
  rows?: number;
  authMode?: 'service_account' | 'iam_impersonation' | 'none';
  tokenStatus?: string;
  error?: string;
}> {
  let accessToken = providedAccessToken;
  let authMode: 'service_account' | 'iam_impersonation' | 'none' = 'service_account';
  let tokenStatus = 'Active';

  if (!accessToken) {
    const tokenRes = await getGoogleSheetsAccessToken();
    authMode = tokenRes.authMode;
    tokenStatus = tokenRes.tokenStatus;
    if (!tokenRes.ok || !tokenRes.accessToken) {
      return {
        ok: false,
        httpStatus: tokenRes.httpStatus,
        authMode,
        tokenStatus,
        error: tokenRes.error,
      };
    }
    accessToken = tokenRes.accessToken;
  }

  try {
    if (!verifiedTabsInSession.has(table)) {
      await ensureRequiredSheetTabs(accessToken);
    }

    const matrix = objectsToMatrix(table, records);
    const writeSnapshot = async () => {
      await fetchSheetsApiJson(
        `${SHEETS_API_BASE}/values/${encodeURIComponent(`${table}!A1:ZZ`)}:clear`,
        accessToken!,
        { method: 'POST', body: JSON.stringify({}) }
      );

      return fetchSheetsApiJson(
        `${SHEETS_API_BASE}/values/${encodeURIComponent(`${table}!A1`)}?valueInputOption=RAW`,
        accessToken!,
        {
          method: 'PUT',
          body: JSON.stringify({
            range: `${table}!A1`,
            majorDimension: 'ROWS',
            values: matrix,
          }),
        }
      );
    };

    let writeRes;
    try {
      writeRes = await writeSnapshot();
    } catch (firstErr) {
      if (firstErr instanceof SheetsServerError && firstErr.httpStatus === 400) {
        verifiedTabsInSession.delete(table);
        await ensureRequiredSheetTabs(accessToken);
        writeRes = await writeSnapshot();
      } else {
        throw firstErr;
      }
    }

    return {
      ok: true,
      httpStatus: writeRes.httpStatus,
      rows: records.length,
      authMode,
      tokenStatus,
    };
  } catch (err) {
    const httpStatus = err instanceof SheetsServerError ? err.httpStatus : 500;
    return {
      ok: false,
      httpStatus,
      authMode,
      tokenStatus,
      error: err instanceof Error ? err.message : `Failed to sync ${table} to Google Sheet.`,
    };
  }
}

export interface ServerDatasetPayload {
  properties: unknown[];
  units: unknown[];
  tenants: unknown[];
  houseMaintenanceBills: unknown[];
  utilityReadings: unknown[];
  invoices: unknown[];
  expenses?: unknown[];
  requests?: unknown[];
  users?: unknown[];
  appConfig?: unknown[];
}

export async function pushAllTablesServer(
  dataset: ServerDatasetPayload,
  providedTokenInfo?: {
    accessToken: string;
    authMode: 'service_account' | 'iam_impersonation';
    tokenStatus: string;
  }
): Promise<{
  ok: boolean;
  httpStatus: number;
  createdTabs: SyncTable[];
  tabStatuses: ServerTabStatus[];
  diagnostics: ServerSyncDiagnostics;
  error?: string;
}> {
  const testedAt = new Date().toISOString();
  let tokenInfo = providedTokenInfo;

  if (!tokenInfo) {
    const tokenRes = await getGoogleSheetsAccessToken();
    if (!tokenRes.ok || !tokenRes.accessToken || tokenRes.authMode === 'none') {
      const msg = tokenRes.error || 'Google Sheets authentication failed.';
      return {
        ok: false,
        httpStatus: tokenRes.httpStatus,
        createdTabs: [],
        tabStatuses: REQUIRED_SHEET_TABS.map((tab) => ({
          tab,
          ok: false,
          httpStatus: tokenRes.httpStatus,
        })),
        error: msg,
        diagnostics: {
          connected: false,
          authMode: 'none',
          httpStatus: tokenRes.httpStatus,
          tokenStatus: tokenRes.tokenStatus,
          message: msg,
          testedAt,
          tabStatuses: REQUIRED_SHEET_TABS.map((tab) => ({
            tab,
            ok: false,
            httpStatus: tokenRes.httpStatus,
          })),
        },
      };
    }
    tokenInfo = {
      accessToken: tokenRes.accessToken,
      authMode: tokenRes.authMode,
      tokenStatus: tokenRes.tokenStatus,
    };
  }

  const tabStatuses: ServerTabStatus[] = [];
  let createdTabs: SyncTable[] = [];

  try {
    const ensureRes = await ensureRequiredSheetTabs(tokenInfo.accessToken);
    createdTabs = ensureRes.createdTabs;

    const tableMap: Record<SyncTable, unknown[]> = {
      Properties: dataset.properties || [],
      Units: dataset.units || [],
      Tenants: dataset.tenants || [],
      BuildingMaintenance: dataset.houseMaintenanceBills || [],
      UtilityReadings: dataset.utilityReadings || [],
      Invoices: dataset.invoices || [],
      Expenses: dataset.expenses || [],
      Requests: dataset.requests || [],
      Users: dataset.users || [],
      AppConfig: dataset.appConfig || [],
    };

    for (const tab of REQUIRED_SHEET_TABS) {
      const res = await syncTableServer(tab, tableMap[tab], tokenInfo.accessToken);
      tabStatuses.push({
        tab,
        ok: res.ok,
        httpStatus: res.httpStatus,
        rows: tableMap[tab].length,
        created: createdTabs.includes(tab),
        error: res.error,
      });

      if (!res.ok) {
        const msg = res.error || `Failed pushing ${tab}.`;
        return {
          ok: false,
          httpStatus: res.httpStatus || 500,
          createdTabs,
          tabStatuses,
          error: msg,
          diagnostics: {
            connected: false,
            authMode: tokenInfo.authMode,
            httpStatus: res.httpStatus || 500,
            tokenStatus: tokenInfo.tokenStatus,
            message: msg,
            testedAt,
            tabStatuses,
          },
        };
      }
    }

    const successMsg = `Pushed all ${REQUIRED_SHEET_TABS.length} tables to Google Sheet (${HARDCODED_SPREADSHEET_ID})${
      createdTabs.length > 0 ? ` and auto-created: ${createdTabs.join(', ')}` : ''
    }.`;

    return {
      ok: true,
      httpStatus: 200,
      createdTabs,
      tabStatuses,
      diagnostics: {
        connected: true,
        authMode: tokenInfo.authMode,
        httpStatus: 200,
        tokenStatus: tokenInfo.tokenStatus,
        message: successMsg,
        testedAt,
        tabStatuses,
      },
    };
  } catch (err) {
    const httpStatus = err instanceof SheetsServerError ? err.httpStatus : 500;
    const rawMsg = err instanceof Error ? err.message : 'Failed to push tables to Google Sheet.';
    const msg =
      httpStatus === 403 || httpStatus === 404
        ? `${rawMsg} — Verify Editor access on Google Sheet ${HARDCODED_SPREADSHEET_ID}.`
        : rawMsg;

    return {
      ok: false,
      httpStatus,
      createdTabs,
      tabStatuses,
      error: msg,
      diagnostics: {
        connected: false,
        authMode: tokenInfo.authMode,
        httpStatus,
        tokenStatus: tokenInfo.tokenStatus,
        message: msg,
        testedAt,
        tabStatuses:
          tabStatuses.length > 0
            ? tabStatuses
            : REQUIRED_SHEET_TABS.map((tab) => ({ tab, ok: false, httpStatus })),
      },
    };
  }
}

export async function pullAllFromSheetServer(): Promise<{
  ok: boolean;
  mode: 'service_account' | 'iam_impersonation' | 'none';
  httpStatus: number;
  existingTabsCount: number;
  totalRowCount: number;
  tabStatuses: ServerTabStatus[];
  data?: Record<SyncTable, Record<string, unknown>[]>;
  diagnostics: ServerSyncDiagnostics;
  error?: string;
}> {
  const testedAt = new Date().toISOString();
  const emptyTables: Record<SyncTable, Record<string, unknown>[]> = {
    Properties: [],
    Units: [],
    Tenants: [],
    BuildingMaintenance: [],
    UtilityReadings: [],
    Invoices: [],
    Expenses: [],
    Requests: [],
    Users: [],
    AppConfig: [],
  };

  const tokenRes = await getGoogleSheetsAccessToken();
  if (!tokenRes.ok || !tokenRes.accessToken || tokenRes.authMode === 'none') {
    const msg = tokenRes.error || 'Google Sheets authentication not configured.';
    const tabStatuses = REQUIRED_SHEET_TABS.map((tab) => ({
      tab,
      ok: false,
      httpStatus: tokenRes.httpStatus,
    }));
    return {
      ok: false,
      mode: 'none',
      httpStatus: tokenRes.httpStatus,
      existingTabsCount: 0,
      totalRowCount: 0,
      tabStatuses,
      error: msg,
      diagnostics: {
        connected: false,
        authMode: 'none',
        httpStatus: tokenRes.httpStatus,
        tokenStatus: tokenRes.tokenStatus,
        message: msg,
        testedAt,
        tabStatuses,
      },
    };
  }

  try {
    const { data: meta, httpStatus: metaStatus } = await fetchSheetsApiJson<{
      sheets?: Array<{ properties?: { title?: string } }>;
    }>(`${SHEETS_API_BASE}?fields=sheets.properties.title`, tokenRes.accessToken);

    const sheetTitles = (meta.sheets || [])
      .map((s) => s.properties?.title || '')
      .filter(Boolean);

    const presentRequiredTabs = REQUIRED_SHEET_TABS.filter((t) =>
      sheetTitles.includes(t)
    );

    if (presentRequiredTabs.length === 0) {
      const tabStatuses = REQUIRED_SHEET_TABS.map((tab) => ({
        tab,
        ok: false,
        httpStatus: 404,
        rows: 0,
        error: 'Tab not created yet',
      }));
      const msg = `Connected (HTTP ${metaStatus}), but none of the ${REQUIRED_SHEET_TABS.length} tabs exist yet. Click "Test Connection" to auto-create them.`;
      return {
        ok: false,
        mode: tokenRes.authMode,
        httpStatus: 404,
        existingTabsCount: 0,
        totalRowCount: 0,
        tabStatuses,
        error: msg,
        diagnostics: {
          connected: true,
          authMode: tokenRes.authMode,
          httpStatus: metaStatus,
          tokenStatus: tokenRes.tokenStatus,
          message: msg,
          testedAt,
          tabStatuses,
        },
      };
    }

    const rangesQuery = presentRequiredTabs
      .map((t) => `ranges=${encodeURIComponent(`${t}!A1:ZZ`)}`)
      .join('&');

    const { data: batchRes, httpStatus: batchStatus } = await fetchSheetsApiJson<{
      valueRanges?: Array<{ range?: string; values?: unknown[][] }>;
    }>(
      `${SHEETS_API_BASE}/values:batchGet?${rangesQuery}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
      tokenRes.accessToken
    );

    let totalRowCount = 0;
    const tabStatusMap = new Map<SyncTable, ServerTabStatus>();

    (batchRes.valueRanges || []).forEach((vr, index) => {
      const tab = presentRequiredTabs[index];
      const values = vr.values || [];
      if (values.length >= 2) {
        const headers = values[0].map((h) => String(h || '').trim());
        const objs = rowsToObjects(headers, values.slice(1));
        emptyTables[tab] = objs;
        totalRowCount += objs.length;
        tabStatusMap.set(tab, {
          tab,
          ok: true,
          httpStatus: batchStatus,
          rows: objs.length,
        });
      } else {
        emptyTables[tab] = [];
        tabStatusMap.set(tab, {
          tab,
          ok: true,
          httpStatus: batchStatus,
          rows: 0,
        });
      }
    });

    const tabStatuses: ServerTabStatus[] = REQUIRED_SHEET_TABS.map(
      (tab) =>
        tabStatusMap.get(tab) || {
          tab,
          ok: false,
          httpStatus: 404,
          rows: 0,
          error: 'Tab missing',
        }
    );

    const msg = `Pulled ${totalRowCount} rows across ${presentRequiredTabs.length}/${REQUIRED_SHEET_TABS.length} tabs.`;

    return {
      ok: true,
      mode: tokenRes.authMode,
      httpStatus: batchStatus,
      existingTabsCount: presentRequiredTabs.length,
      totalRowCount,
      tabStatuses,
      data: emptyTables,
      diagnostics: {
        connected: true,
        authMode: tokenRes.authMode,
        httpStatus: batchStatus,
        tokenStatus: tokenRes.tokenStatus,
        message: msg,
        testedAt,
        tabStatuses,
      },
    };
  } catch (err) {
    const httpStatus = err instanceof SheetsServerError ? err.httpStatus : 403;
    const rawMsg =
      err instanceof Error ? err.message : 'Failed to read Google Sheet via API v4.';
    const msg =
      httpStatus === 403 || httpStatus === 404
        ? `${rawMsg} — Confirm Editor access on Sheet ${HARDCODED_SPREADSHEET_ID}.`
        : rawMsg;
    const tabStatuses = REQUIRED_SHEET_TABS.map((tab) => ({
      tab,
      ok: false,
      httpStatus,
    }));

    return {
      ok: false,
      mode: tokenRes.authMode,
      httpStatus,
      existingTabsCount: 0,
      totalRowCount: 0,
      tabStatuses,
      error: msg,
      diagnostics: {
        connected: false,
        authMode: tokenRes.authMode,
        httpStatus,
        tokenStatus: tokenRes.tokenStatus,
        message: msg,
        testedAt,
        tabStatuses,
      },
    };
  }
}

export async function testConnectionAndSyncServer(
  dataset: ServerDatasetPayload
): Promise<{
  action: 'pulled' | 'initialized_sheet' | 'failed';
  pulledData?: Record<SyncTable, Record<string, unknown>[]>;
  diagnostics: ServerSyncDiagnostics;
}> {
  const testedAt = new Date().toISOString();
  const tokenRes = await getGoogleSheetsAccessToken(true);

  if (!tokenRes.ok || !tokenRes.accessToken || tokenRes.authMode === 'none') {
    const msg = tokenRes.error || 'Could not authenticate with Google Sheets.';
    return {
      action: 'failed',
      diagnostics: {
        connected: false,
        authMode: 'none',
        httpStatus: tokenRes.httpStatus,
        tokenStatus: tokenRes.tokenStatus,
        message: msg,
        testedAt,
        tabStatuses: REQUIRED_SHEET_TABS.map((tab) => ({
          tab,
          ok: false,
          httpStatus: tokenRes.httpStatus,
        })),
      },
    };
  }

  try {
    const ensureRes = await ensureRequiredSheetTabs(tokenRes.accessToken);
    const pullRes = await pullAllFromSheetServer();

    if (!pullRes.ok || !pullRes.data) {
      return {
        action: 'failed',
        diagnostics: pullRes.diagnostics,
      };
    }

    if (pullRes.totalRowCount === 0) {
      const pushRes = await pushAllTablesServer(dataset, {
        accessToken: tokenRes.accessToken,
        authMode: tokenRes.authMode,
        tokenStatus: tokenRes.tokenStatus,
      });

      if (!pushRes.ok) {
        return { action: 'failed', diagnostics: pushRes.diagnostics };
      }

      const initMsg = `Connected (HTTP 200).${
        ensureRes.createdTabs.length > 0
          ? ` Auto-created tabs: ${ensureRes.createdTabs.join(', ')}.`
          : ''
      } Initialized all ${REQUIRED_SHEET_TABS.length} sheet tabs with your current estate data.`;

      return {
        action: 'initialized_sheet',
        diagnostics: {
          ...pushRes.diagnostics,
          message: initMsg,
        },
      };
    }

    const mergedStatuses = pullRes.tabStatuses.map((st) => ({
      ...st,
      created: ensureRes.createdTabs.includes(st.tab as SyncTable),
    }));

    return {
      action: 'pulled',
      pulledData: pullRes.data,
      diagnostics: {
        connected: true,
        authMode: tokenRes.authMode,
        httpStatus: pullRes.httpStatus,
        tokenStatus: tokenRes.tokenStatus,
        message: `Connected (HTTP ${pullRes.httpStatus}).${
          ensureRes.createdTabs.length > 0
            ? ` Auto-created missing tabs: ${ensureRes.createdTabs.join(', ')}.`
            : ''
        } Synced ${pullRes.totalRowCount} rows across ${pullRes.existingTabsCount}/${REQUIRED_SHEET_TABS.length} tabs.`,
        testedAt,
        tabStatuses: mergedStatuses,
      },
    };
  } catch (err) {
    const httpStatus = err instanceof SheetsServerError ? err.httpStatus : 403;
    const rawMsg = err instanceof Error ? err.message : 'Google Sheets API request failed.';
    const msg =
      httpStatus === 403 || httpStatus === 404
        ? `${rawMsg} — Confirm Editor access on Google Sheet ${HARDCODED_SPREADSHEET_ID}.`
        : rawMsg;

    return {
      action: 'failed',
      diagnostics: {
        connected: false,
        authMode: tokenRes.authMode,
        httpStatus,
        tokenStatus: tokenRes.tokenStatus,
        message: msg,
        testedAt,
        tabStatuses: REQUIRED_SHEET_TABS.map((tab) => ({
          tab,
          ok: false,
          httpStatus,
          created: false,
        })),
      },
    };
  }
}
