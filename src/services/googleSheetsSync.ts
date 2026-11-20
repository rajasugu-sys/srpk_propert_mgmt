import { EstateDataset, SyncDiagnostics, TabSyncStatus } from '../types/estate';

export type SyncTable =
  | 'Properties'
  | 'Units'
  | 'Tenants'
  | 'BuildingMaintenance'
  | 'UtilityReadings'
  | 'Invoices'
  | 'Expenses'
  | 'Requests';

export const SPREADSHEET_ID = '1rV0SGO7fB5BB56xa3dmhL1eicYQF68hekT2rrSMswD0';
export const SPREADSHEET_URL =
  'https://docs.google.com/spreadsheets/d/1rV0SGO7fB5BB56xa3dmhL1eicYQF68hekT2rrSMswD0/edit?gid=669140785#gid=669140785';

const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SHEETS_API_BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

export const REQUIRED_SHEET_TABS: SyncTable[] = [
  'Properties',
  'Units',
  'Tenants',
  'BuildingMaintenance',
  'UtilityReadings',
  'Invoices',
  'Expenses',
  'Requests',
];

const TAB_HEADERS: Record<SyncTable, string[]> = {
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
    'upi_link',
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
};

export interface SheetsStatusResponse {
  spreadsheetId: string;
  secretConfigured: boolean;
}

export interface PullSheetsResult {
  ok: boolean;
  mode: 'service_account' | 'iam_impersonation' | 'none';
  httpStatus?: number;
  existingTabsCount: number;
  totalRowCount: number;
  tabStatuses: TabSyncStatus[];
  data?: Record<SyncTable, Record<string, unknown>[]>;
  diagnostics?: SyncDiagnostics;
  error?: string;
}

interface ClientTokenCache {
  accessToken: string;
  expiresAtMs: number;
}

let cachedClientToken: ClientTokenCache | null = null;
let verifiedClientTabs = new Set<string>();

function getClientEnvCredentials(): {
  configured: boolean;
  email: string;
  privateKey: string;
} {
  const email = (import.meta.env.VITE_GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const rawKey = (import.meta.env.VITE_GOOGLE_PRIVATE_KEY || '').trim();
  const privateKey = rawKey.replace(/\\n/g, '\n');

  const configured = Boolean(
    email &&
      privateKey &&
      privateKey.includes('BEGIN') &&
      privateKey.includes('PRIVATE KEY') &&
      typeof crypto !== 'undefined' &&
      Boolean(crypto.subtle)
  );

  return { configured, email, privateKey };
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(text: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(text));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const clean = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function signJwtWithWebCrypto(
  email: string,
  privateKeyPem: string
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: email,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URI,
    iat: nowSec - 30,
    exp: nowSec + 3570,
  };

  const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(
    JSON.stringify(payload)
  )}`;

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'SHA-256' },
    },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signatureBuffer))}`;
}

async function getClientBearerToken(forceRefresh = false): Promise<{
  ok: boolean;
  accessToken?: string;
  httpStatus: number;
  error?: string;
}> {
  const { configured, email, privateKey } = getClientEnvCredentials();
  if (!configured) {
    return {
      ok: false,
      httpStatus: 401,
      error: 'Client Web Crypto credentials are not configured.',
    };
  }

  if (
    !forceRefresh &&
    cachedClientToken &&
    cachedClientToken.expiresAtMs > Date.now() + 60_000
  ) {
    return {
      ok: true,
      accessToken: cachedClientToken.accessToken,
      httpStatus: 200,
    };
  }

  try {
    const assertion = await signJwtWithWebCrypto(email, privateKey);

    let tokenRes: Response | null = null;
    try {
      tokenRes = await fetch(GOOGLE_TOKEN_URI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
      });
    } catch {
      tokenRes = await fetch('/api/sheets/sa-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assertion }),
      });
    }

    const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !tokenJson.access_token) {
      return {
        ok: false,
        httpStatus: tokenRes.status || 401,
        error:
          tokenJson.error_description ||
          tokenJson.error ||
          `Google OAuth2 token exchange failed (HTTP ${tokenRes.status}).`,
      };
    }

    cachedClientToken = {
      accessToken: tokenJson.access_token,
      expiresAtMs: Date.now() + (tokenJson.expires_in || 3600) * 1000,
    };

    return {
      ok: true,
      accessToken: tokenJson.access_token,
      httpStatus: 200,
    };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 500,
      error:
        err instanceof Error
          ? err.message
          : 'Web Crypto JWT signing failed for Google Sheets.',
    };
  }
}

class ClientSheetsApiError extends Error {
  httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = 'ClientSheetsApiError';
    this.httpStatus = httpStatus;
  }
}

async function fetchClientSheetsJson<T>(
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
    throw new ClientSheetsApiError(
      `Google Sheets API returned non-JSON (HTTP ${res.status}).`,
      res.status
    );
  }

  if (!res.ok) {
    const errObj = json as { error?: { message?: string } };
    throw new ClientSheetsApiError(
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
  const normalized = records.map((item) => {
    const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return table === 'Tenants' ? sanitizeTenantForSheet(rec) : rec;
  });

  normalized.forEach((rec) => {
    Object.keys(rec).forEach((k) => {
      if (!baseHeaders.includes(k)) baseHeaders.push(k);
    });
  });

  const matrix: (string | number | boolean)[][] = [baseHeaders];
  normalized.forEach((rec) => {
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

async function ensureRequiredTabsClient(accessToken: string): Promise<{
  existingTabs: string[];
  createdTabs: SyncTable[];
  httpStatus: number;
}> {
  const { data: meta, httpStatus } = await fetchClientSheetsJson<{
    sheets?: Array<{ properties?: { title?: string } }>;
  }>(`${SHEETS_API_BASE}?fields=sheets.properties.title`, accessToken);

  const existingTitles = (meta.sheets || [])
    .map((s) => s.properties?.title || '')
    .filter(Boolean);

  const missingTabs = REQUIRED_SHEET_TABS.filter((t) => !existingTitles.includes(t));

  if (missingTabs.length > 0) {
    await fetchClientSheetsJson(`${SHEETS_API_BASE}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        requests: missingTabs.map((title) => ({
          addSheet: {
            properties: { title, gridProperties: { frozenRowCount: 1 } },
          },
        })),
      }),
    });

    await fetchClientSheetsJson(`${SHEETS_API_BASE}/values:batchUpdate`, accessToken, {
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

  const allTabs = Array.from(new Set([...existingTitles, ...missingTabs]));
  verifiedClientTabs = new Set(allTabs);
  return { existingTabs: allTabs, createdTabs: missingTabs, httpStatus };
}

async function pullClientDirect(accessToken: string): Promise<PullSheetsResult> {
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
  };

  try {
    const { data: meta, httpStatus: metaStatus } = await fetchClientSheetsJson<{
      sheets?: Array<{ properties?: { title?: string } }>;
    }>(`${SHEETS_API_BASE}?fields=sheets.properties.title`, accessToken);

    const titles = (meta.sheets || [])
      .map((s) => s.properties?.title || '')
      .filter(Boolean);
    const present = REQUIRED_SHEET_TABS.filter((t) => titles.includes(t));

    if (present.length === 0) {
      const tabStatuses = REQUIRED_SHEET_TABS.map((tab) => ({
        tab,
        ok: false,
        httpStatus: 404,
        rows: 0,
        error: 'Tab not created yet',
      }));
      const msg = `Connected (HTTP ${metaStatus}), but none of the ${REQUIRED_SHEET_TABS.length} tabs exist yet. Click "Test Connection" to initialize.`;
      return {
        ok: false,
        mode: 'service_account',
        httpStatus: 404,
        existingTabsCount: 0,
        totalRowCount: 0,
        tabStatuses,
        error: msg,
        diagnostics: {
          connected: true,
          authMode: 'service_account',
          httpStatus: metaStatus,
          tokenStatus: 'Web Crypto Bearer Active',
          message: msg,
          testedAt,
          tabStatuses,
        },
      };
    }

    const rangesQuery = present
      .map((t) => `ranges=${encodeURIComponent(`${t}!A1:ZZ`)}`)
      .join('&');

    const { data: batchRes, httpStatus: batchStatus } = await fetchClientSheetsJson<{
      valueRanges?: Array<{ values?: unknown[][] }>;
    }>(
      `${SHEETS_API_BASE}/values:batchGet?${rangesQuery}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
      accessToken
    );

    let totalRowCount = 0;
    const statusMap = new Map<SyncTable, TabSyncStatus>();

    (batchRes.valueRanges || []).forEach((vr, idx) => {
      const tab = present[idx];
      const values = vr.values || [];
      if (values.length >= 2) {
        const headers = values[0].map((h) => String(h || '').trim());
        const objs = rowsToObjects(headers, values.slice(1));
        emptyTables[tab] = objs;
        totalRowCount += objs.length;
        statusMap.set(tab, {
          tab,
          ok: true,
          httpStatus: batchStatus,
          rows: objs.length,
        });
      } else {
        emptyTables[tab] = [];
        statusMap.set(tab, { tab, ok: true, httpStatus: batchStatus, rows: 0 });
      }
    });

    const tabStatuses: TabSyncStatus[] = REQUIRED_SHEET_TABS.map(
      (tab) =>
        statusMap.get(tab) || {
          tab,
          ok: false,
          httpStatus: 404,
          rows: 0,
          error: 'Tab missing',
        }
    );

    const msg = `Pulled ${totalRowCount} rows across ${present.length}/${REQUIRED_SHEET_TABS.length} tabs.`;
    return {
      ok: true,
      mode: 'service_account',
      httpStatus: batchStatus,
      existingTabsCount: present.length,
      totalRowCount,
      tabStatuses,
      data: emptyTables,
      diagnostics: {
        connected: true,
        authMode: 'service_account',
        httpStatus: batchStatus,
        tokenStatus: 'Web Crypto Bearer Active',
        message: msg,
        testedAt,
        tabStatuses,
      },
    };
  } catch (err) {
    const httpStatus = err instanceof ClientSheetsApiError ? err.httpStatus : 403;
    const msg = err instanceof Error ? err.message : 'Failed to pull from Google Sheet.';
    const tabStatuses = REQUIRED_SHEET_TABS.map((tab) => ({
      tab,
      ok: false,
      httpStatus,
    }));
    return {
      ok: false,
      mode: 'service_account',
      httpStatus,
      existingTabsCount: 0,
      totalRowCount: 0,
      tabStatuses,
      error: msg,
      diagnostics: {
        connected: false,
        authMode: 'service_account',
        httpStatus,
        tokenStatus: 'Sheet Access Error',
        message: msg,
        testedAt,
        tabStatuses,
      },
    };
  }
}

async function syncTableClientDirect(
  table: SyncTable,
  records: unknown[],
  accessToken: string
): Promise<{
  ok: boolean;
  httpStatus?: number;
  rows?: number;
  authMode?: 'service_account';
  tokenStatus?: string;
  error?: string;
}> {
  try {
    if (!verifiedClientTabs.has(table)) {
      await ensureRequiredTabsClient(accessToken);
    }

    const matrix = objectsToMatrix(table, records);
    const write = async () => {
      await fetchClientSheetsJson(
        `${SHEETS_API_BASE}/values/${encodeURIComponent(`${table}!A1:ZZ`)}:clear`,
        accessToken,
        { method: 'POST', body: JSON.stringify({}) }
      );
      return fetchClientSheetsJson(
        `${SHEETS_API_BASE}/values/${encodeURIComponent(`${table}!A1`)}?valueInputOption=RAW`,
        accessToken,
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

    const res = await write();
    return {
      ok: true,
      httpStatus: res.httpStatus,
      rows: records.length,
      authMode: 'service_account',
      tokenStatus: 'Web Crypto Bearer Active',
    };
  } catch (err) {
    const httpStatus = err instanceof ClientSheetsApiError ? err.httpStatus : 500;
    return {
      ok: false,
      httpStatus,
      authMode: 'service_account',
      tokenStatus: 'Write Error',
      error: err instanceof Error ? err.message : `Failed to sync ${table} to Google Sheet.`,
    };
  }
}

export async function fetchSheetsConfigStatus(): Promise<SheetsStatusResponse> {
  const clientEnv = getClientEnvCredentials();
  try {
    const res = await fetch('/api/sheets/status');
    if (res.ok) {
      const serverStatus = (await res.json()) as SheetsStatusResponse;
      return {
        spreadsheetId: serverStatus.spreadsheetId || SPREADSHEET_ID,
        secretConfigured: clientEnv.configured || serverStatus.secretConfigured,
      };
    }
  } catch {
    // ignore network fallback
  }
  return {
    spreadsheetId: SPREADSHEET_ID,
    secretConfigured: clientEnv.configured,
  };
}

export async function pullAllFromGoogleSheet(): Promise<PullSheetsResult> {
  const clientEnv = getClientEnvCredentials();
  if (clientEnv.configured) {
    const tokenRes = await getClientBearerToken();
    if (tokenRes.ok && tokenRes.accessToken) {
      return pullClientDirect(tokenRes.accessToken);
    }
  }

  try {
    const res = await fetch('/api/sheets/pull', { method: 'POST' });
    return (await res.json()) as PullSheetsResult;
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Unable to reach Google Sheets sync endpoint.';
    return {
      ok: false,
      mode: 'none',
      httpStatus: 502,
      existingTabsCount: 0,
      totalRowCount: 0,
      tabStatuses: REQUIRED_SHEET_TABS.map((tab) => ({
        tab,
        ok: false,
        httpStatus: 502,
      })),
      error: msg,
    };
  }
}

export async function syncTableToGoogleSheet(
  table: SyncTable,
  records: unknown[]
): Promise<{
  ok: boolean;
  httpStatus?: number;
  rows?: number;
  authMode?: 'service_account' | 'iam_impersonation' | 'none';
  tokenStatus?: string;
  error?: string;
}> {
  const clientEnv = getClientEnvCredentials();
  if (clientEnv.configured) {
    const tokenRes = await getClientBearerToken();
    if (tokenRes.ok && tokenRes.accessToken) {
      return syncTableClientDirect(table, records, tokenRes.accessToken);
    }
  }

  try {
    const res = await fetch('/api/sheets/sync-table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, records }),
    });
    return (await res.json()) as {
      ok: boolean;
      httpStatus?: number;
      rows?: number;
      authMode?: 'service_account' | 'iam_impersonation' | 'none';
      tokenStatus?: string;
      error?: string;
    };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 502,
      error: err instanceof Error ? err.message : `Failed to sync ${table} to Google Sheet.`,
    };
  }
}

export async function pushAllTablesToGoogleSheet(dataset: EstateDataset): Promise<{
  ok: boolean;
  httpStatus?: number;
  createdTabs: SyncTable[];
  tabStatuses: TabSyncStatus[];
  diagnostics?: SyncDiagnostics;
  error?: string;
}> {
  const clientEnv = getClientEnvCredentials();
  if (clientEnv.configured) {
    const tokenRes = await getClientBearerToken();
    if (tokenRes.ok && tokenRes.accessToken) {
      const testedAt = new Date().toISOString();
      try {
        const ensureRes = await ensureRequiredTabsClient(tokenRes.accessToken);
        const tableMap: Record<SyncTable, unknown[]> = {
          Properties: dataset.properties || [],
          Units: dataset.units || [],
          Tenants: dataset.tenants || [],
          BuildingMaintenance: dataset.houseMaintenanceBills || [],
          UtilityReadings: dataset.utilityReadings || [],
          Invoices: dataset.invoices || [],
          Expenses: dataset.expenses || [],
          Requests: dataset.requests || [],
        };

        const tabStatuses: TabSyncStatus[] = [];
        for (const tab of REQUIRED_SHEET_TABS) {
          const syncRes = await syncTableClientDirect(
            tab,
            tableMap[tab],
            tokenRes.accessToken
          );
          tabStatuses.push({
            tab,
            ok: syncRes.ok,
            httpStatus: syncRes.httpStatus,
            rows: tableMap[tab].length,
            created: ensureRes.createdTabs.includes(tab),
            error: syncRes.error,
          });
          if (!syncRes.ok) {
            return {
              ok: false,
              httpStatus: syncRes.httpStatus || 500,
              createdTabs: ensureRes.createdTabs,
              tabStatuses,
              error: syncRes.error,
              diagnostics: {
                connected: false,
                authMode: 'service_account',
                httpStatus: syncRes.httpStatus || 500,
                tokenStatus: 'Web Crypto Bearer Active',
                message: syncRes.error || `Failed pushing ${tab}.`,
                testedAt,
                tabStatuses,
              },
            };
          }
        }

        const msg = `Pushed all ${REQUIRED_SHEET_TABS.length} tables to Google Sheet (${SPREADSHEET_ID}).`;
        return {
          ok: true,
          httpStatus: 200,
          createdTabs: ensureRes.createdTabs,
          tabStatuses,
          diagnostics: {
            connected: true,
            authMode: 'service_account',
            httpStatus: 200,
            tokenStatus: 'Web Crypto Bearer Active',
            message: msg,
            testedAt,
            tabStatuses,
          },
        };
      } catch (err) {
        const httpStatus = err instanceof ClientSheetsApiError ? err.httpStatus : 500;
        const msg =
          err instanceof Error ? err.message : 'Failed to push tables to Google Sheet.';
        return {
          ok: false,
          httpStatus,
          createdTabs: [],
          tabStatuses: REQUIRED_SHEET_TABS.map((tab) => ({
            tab,
            ok: false,
            httpStatus,
          })),
          error: msg,
        };
      }
    }
  }

  try {
    const res = await fetch('/api/sheets/push-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataset }),
    });
    return (await res.json()) as {
      ok: boolean;
      httpStatus?: number;
      createdTabs: SyncTable[];
      tabStatuses: TabSyncStatus[];
      diagnostics?: SyncDiagnostics;
      error?: string;
    };
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Failed to push tables to Google Sheet.';
    return {
      ok: false,
      httpStatus: 502,
      createdTabs: [],
      tabStatuses: REQUIRED_SHEET_TABS.map((tab) => ({
        tab,
        ok: false,
        httpStatus: 502,
      })),
      error: msg,
    };
  }
}

export async function testConnectionAndSyncNow(dataset: EstateDataset): Promise<{
  diagnostics: SyncDiagnostics;
  action: 'pulled' | 'initialized_sheet' | 'failed';
  pulledData?: Record<SyncTable, Record<string, unknown>[]>;
}> {
  const testedAt = new Date().toISOString();
  const clientEnv = getClientEnvCredentials();

  if (clientEnv.configured) {
    const tokenRes = await getClientBearerToken(true);
    if (tokenRes.ok && tokenRes.accessToken) {
      try {
        const ensureRes = await ensureRequiredTabsClient(tokenRes.accessToken);
        const pullRes = await pullClientDirect(tokenRes.accessToken);
        if (!pullRes.ok || !pullRes.data) {
          return {
            action: 'failed',
            diagnostics: pullRes.diagnostics || {
              connected: false,
              authMode: 'service_account',
              httpStatus: pullRes.httpStatus,
              tokenStatus: 'Read Failed',
              message: pullRes.error || 'Could not inspect Google Sheet.',
              testedAt,
              tabStatuses: pullRes.tabStatuses,
            },
          };
        }

        if (pullRes.totalRowCount === 0) {
          const pushRes = await pushAllTablesToGoogleSheet(dataset);
          if (!pushRes.ok) {
            return {
              action: 'failed',
              diagnostics: pushRes.diagnostics || {
                connected: false,
                authMode: 'service_account',
                httpStatus: pushRes.httpStatus,
                tokenStatus: 'Write Failed',
                message: pushRes.error || 'Failed initializing Google Sheet.',
                testedAt,
                tabStatuses: pushRes.tabStatuses,
              },
            };
          }
          return {
            action: 'initialized_sheet',
            diagnostics: pushRes.diagnostics || {
              connected: true,
              authMode: 'service_account',
              httpStatus: 200,
              tokenStatus: 'Web Crypto Bearer Active',
              message: `Connected (HTTP 200). Initialized all ${REQUIRED_SHEET_TABS.length} sheet tabs.`,
              testedAt,
              tabStatuses: pushRes.tabStatuses,
            },
          };
        }

        return {
          action: 'pulled',
          pulledData: pullRes.data,
          diagnostics: {
            connected: true,
            authMode: 'service_account',
            httpStatus: pullRes.httpStatus,
            tokenStatus: 'Web Crypto Bearer Active',
            message: `Connected (HTTP ${pullRes.httpStatus}).${
              ensureRes.createdTabs.length > 0
                ? ` Auto-created missing tabs: ${ensureRes.createdTabs.join(', ')}.`
                : ''
            } Synced ${pullRes.totalRowCount} rows across ${pullRes.existingTabsCount}/${REQUIRED_SHEET_TABS.length} tabs.`,
            testedAt,
            tabStatuses: pullRes.tabStatuses,
          },
        };
      } catch (err) {
        const httpStatus = err instanceof ClientSheetsApiError ? err.httpStatus : 403;
        return {
          action: 'failed',
          diagnostics: {
            connected: false,
            authMode: 'service_account',
            httpStatus,
            tokenStatus: 'Connection Failed',
            message: err instanceof Error ? err.message : 'Google Sheets request failed.',
            testedAt,
            tabStatuses: REQUIRED_SHEET_TABS.map((tab) => ({
              tab,
              ok: false,
              httpStatus,
            })),
          },
        };
      }
    }
  }

  try {
    const res = await fetch('/api/sheets/test-and-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataset }),
    });
    return (await res.json()) as {
      diagnostics: SyncDiagnostics;
      action: 'pulled' | 'initialized_sheet' | 'failed';
      pulledData?: Record<SyncTable, Record<string, unknown>[]>;
    };
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : 'Unable to reach /api/sheets/test-and-sync endpoint.';
    return {
      action: 'failed',
      diagnostics: {
        connected: false,
        authMode: 'none',
        httpStatus: 502,
        tokenStatus: 'Server Unreachable',
        message: msg,
        testedAt,
        tabStatuses: REQUIRED_SHEET_TABS.map((tab) => ({
          tab,
          ok: false,
          httpStatus: 502,
        })),
      },
    };
  }
}
