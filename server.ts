import 'dotenv/config';
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
  EstateDataset,
  MaintenanceRequest,
  RequestCategory,
} from './src/types/estate.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const AGREEMENTS_DIR = path.join(DATA_DIR, 'agreements');
const DB_FILE = path.join(DATA_DIR, 'estate-db.json');

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

async function readOrSeedEstateDataset(): Promise<EstateDataset> {
  try {
    const raw = await fs.readFile(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<EstateDataset>;
    if (Array.isArray(parsed.properties) && Array.isArray(parsed.units)) {
      return {
        ...INITIAL_ESTATE_DATASET,
        ...parsed,
        expenses: Array.isArray(parsed.expenses)
          ? parsed.expenses
          : INITIAL_ESTATE_DATASET.expenses,
        requests: Array.isArray(parsed.requests)
          ? parsed.requests
          : INITIAL_ESTATE_DATASET.requests,
        settings: {
          ...INITIAL_ESTATE_DATASET.settings,
          ...(parsed.settings || {}),
        },
      };
    }
  } catch {
    // fallback to initial seed
  }
  return {
    ...INITIAL_ESTATE_DATASET,
    requests: [...(INITIAL_ESTATE_DATASET.requests || [])],
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // 1. Full-Stack Persistence Endpoints
  app.get('/api/estate', async (_req: Request, res: Response) => {
    try {
      const raw = await fs.readFile(DB_FILE, 'utf-8');
      res.json({ exists: true, data: JSON.parse(raw) });
    } catch {
      res.json({ exists: false, data: null });
    }
  });

  app.put('/api/estate', async (req: Request, res: Response) => {
    try {
      await ensureDataDir();
      await fs.writeFile(DB_FILE, JSON.stringify(req.body, null, 2), 'utf-8');
      res.json({ ok: true, savedAt: new Date().toISOString() });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to persist estate data';
      res.status(500).json({ error: message });
    }
  });

  // 1a. No-Login Shareable Tenant Portal Read & Maintenance Request Submission
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

        await ensureDataDir();
        await fs.writeFile(DB_FILE, JSON.stringify(nextDataset, null, 2), 'utf-8');

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
                  description: 'Numeric water meter reading extracted from the display.',
                },
                rr_or_serial: {
                  type: Type.STRING,
                  description: 'Visible meter serial or RR number if readable, else empty string.',
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

      // EB Bill or Common Area EB Bill (BESCOM / TNEB)
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
                description: 'Extracted BESCOM RR Number or TNEB Consumer Number if visible.',
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

  // Assertion-only CORS relay for browser Web Crypto RS256 (private key never leaves client)
  app.post('/api/sheets/sa-token', async (req: Request, res: Response) => {
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

  app.post('/api/sheets/pull', async (_req: Request, res: Response) => {
    const result = await pullAllFromSheetServer();
    res.status(result.ok ? 200 : result.httpStatus || 500).json(result);
  });

  app.post('/api/sheets/push-all', async (req: Request, res: Response) => {
    const dataset = (req.body?.dataset || req.body || {}) as ServerDatasetPayload;
    const result = await pushAllTablesServer(dataset);
    res.status(result.ok ? 200 : result.httpStatus || 500).json(result);
  });

  app.post('/api/sheets/sync-table', async (req: Request, res: Response) => {
    const { table, records } = req.body as {
      table?: string;
      records?: unknown[];
    };
    if (!table || !ALLOWED_SHEET_TABS.has(table) || !Array.isArray(records)) {
      res.status(400).json({ ok: false, error: 'Invalid table or records payload.' });
      return;
    }
    const result = await syncTableServer(table as SyncTable, records);
    res.status(result.ok ? 200 : result.httpStatus || 500).json(result);
  });

  app.post('/api/sheets/test-and-sync', async (req: Request, res: Response) => {
    const dataset = (req.body?.dataset || req.body || {}) as ServerDatasetPayload;
    const result = await testConnectionAndSyncServer(dataset);
    res.json(result);
  });

  app.get('/api/sheets/public-pull', async (req: Request, res: Response) => {
    try {
      const tab = String(req.query.tab || '').trim();
      if (!ALLOWED_SHEET_TABS.has(tab)) {
        res.status(400).json({ error: 'Invalid sheet tab requested.' });
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
