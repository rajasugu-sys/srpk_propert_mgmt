import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Fingerprint,
  KeyRound,
  RotateCcw,
  Save,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  AUTO_LOCK_OPTIONS,
  loadAutoLockTimerMode,
  persistCredentialsCache,
  resolveEffectiveCredentials,
  saveAutoLockTimerMode,
} from '../config/authConfig';
import {
  isBiometricEnrolledForUser,
  isPlatformBiometricSupported,
  registerPlatformBiometric,
  removeBiometricForUser,
} from '../services/biometricAuth';
import {
  REQUIRED_SHEET_TABS,
  SPREADSHEET_ID,
  SPREADSHEET_URL,
} from '../services/googleSheetsSync';
import {
  AppSettings,
  AuthSession,
  AutoLockTimerMode,
  SyncDiagnostics,
} from '../types/estate';
import { PWAInstallButton } from './PWAControls';

interface SettingsModalProps {
  isOpen: boolean;
  session: AuthSession;
  settings: AppSettings;
  secretConfigured: boolean;
  diagnostics: SyncDiagnostics | null;
  isTestingConnection: boolean;
  isPulling: boolean;
  isPushingAll: boolean;
  pullFeedback: string | null;
  onClose: () => void;
  onSaveSettings: (next: AppSettings) => void;
  onTestConnectionAndSync: () => void;
  onPullFromSheets: () => void;
  onPushAllToSheets: () => void;
  onResetBaseline: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  session,
  settings,
  secretConfigured,
  diagnostics,
  isTestingConnection,
  isPulling,
  isPushingAll,
  pullFeedback,
  onClose,
  onSaveSettings,
  onTestConnectionAndSync,
  onPullFromSheets,
  onPushAllToSheets,
  onResetBaseline,
}) => {
  const [upiId, setUpiId] = useState(settings.merchant_upi_id);
  const [merchantName, setMerchantName] = useState(settings.merchant_name);
  const [ownerPhone, setOwnerPhone] = useState(settings.owner_whatsapp_phone || '+91');

  const effectiveCreds = resolveEffectiveCredentials(settings.auth_credentials);
  const [owner1Username, setOwner1Username] = useState(effectiveCreds.Owner1.username);
  const [owner1Pin, setOwner1Pin] = useState(effectiveCreds.Owner1.pin);
  const [owner2Username, setOwner2Username] = useState(effectiveCreds.Owner2.username);
  const [owner2Pin, setOwner2Pin] = useState(effectiveCreds.Owner2.pin);
  const [autoLockTimer, setAutoLockTimer] = useState<AutoLockTimerMode>(
    settings.auto_lock_timer || loadAutoLockTimerMode()
  );

  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [confirmPushAll, setConfirmPushAll] = useState(false);

  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [biometricMsg, setBiometricMsg] = useState<string | null>(null);

  useEffect(() => {
    setUpiId(settings.merchant_upi_id);
    setMerchantName(settings.merchant_name);
    setOwnerPhone(settings.owner_whatsapp_phone || '+91');
    setAutoLockTimer(settings.auto_lock_timer || loadAutoLockTimerMode());
    const resolved = resolveEffectiveCredentials(settings.auth_credentials);
    setOwner1Username(resolved.Owner1.username);
    setOwner1Pin(resolved.Owner1.pin);
    setOwner2Username(resolved.Owner2.username);
    setOwner2Pin(resolved.Owner2.pin);
    setConfirmPushAll(false);
    setSavedNotice(null);
    setAccessError(null);
    setBiometricMsg(null);
    setBiometricEnrolled(isBiometricEnrolledForUser(session.username));
    void isPlatformBiometricSupported().then(setBiometricSupported);
  }, [settings, isOpen, session.username]);

  if (!isOpen) return null;

  const isConnected = Boolean(
    diagnostics?.connected || (secretConfigured && settings.last_synced_at)
  );
  const lastSyncedLabel = settings.last_synced_at
    ? new Date(settings.last_synced_at).toLocaleString()
    : 'Never synced';

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setAccessError(null);

    const trimmedOwner1User = owner1Username.trim();
    const trimmedOwner1Pin = owner1Pin.trim();
    const trimmedOwner2User = owner2Username.trim();
    const trimmedOwner2Pin = owner2Pin.trim();

    if (!trimmedOwner1User || !trimmedOwner2User) {
      setAccessError('Both Owner usernames/emails are required.');
      return;
    }
    if (trimmedOwner1User.toLowerCase() === trimmedOwner2User.toLowerCase()) {
      setAccessError('Owner 1 and Owner 2 must use distinct usernames/emails.');
      return;
    }
    if (trimmedOwner1Pin.length < 4 || trimmedOwner2Pin.length < 4) {
      setAccessError('PIN / password must be at least 4 characters for both Owners.');
      return;
    }

    const updatedCreds = {
      Owner1: { username: trimmedOwner1User, pin: trimmedOwner1Pin },
      Owner2: { username: trimmedOwner2User, pin: trimmedOwner2Pin },
    };

    persistCredentialsCache(updatedCreds);
    saveAutoLockTimerMode(autoLockTimer);

    onSaveSettings({
      ...settings,
      merchant_upi_id: upiId.trim() || settings.merchant_upi_id,
      merchant_name: merchantName.trim() || settings.merchant_name,
      owner_whatsapp_phone: ownerPhone.trim() || settings.owner_whatsapp_phone,
      auth_credentials: updatedCreds,
      auto_lock_timer: autoLockTimer,
    });
    setSavedNotice('Settings and Owner credentials saved.');
    setTimeout(() => setSavedNotice(null), 3000);
  };

  const handleEnrollBiometric = async () => {
    setBiometricMsg(null);
    const res = await registerPlatformBiometric(session.username);
    if (res.ok) {
      setBiometricEnrolled(true);
      setBiometricMsg(
        `Face ID / Fingerprint quick login enabled for ${session.username}.`
      );
    } else {
      setBiometricMsg('error' in res ? res.error : 'Biometric enrollment failed.');
    }
  };

  const handleRemoveBiometric = () => {
    removeBiometricForUser(session.username);
    setBiometricEnrolled(false);
    setBiometricMsg(`Removed biometric quick login for ${session.username} on this device.`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/60 backdrop-blur-xs p-2 sm:p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white p-4 sm:p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#10b981]">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="settings-modal-title"
                className="text-base sm:text-lg font-bold text-[#0f172a] leading-tight"
              >
                Google Sheets Sync &amp; Owner Settings
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Silent automated sync, UPI payment defaults, and Owner access PINs
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer shrink-0"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Connected Google Sheet Banner */}
        <section className="rounded-xl border border-[#e2e8f0] bg-[#f8f9ff] p-3.5 sm:p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Connected Google Sheet (API v4)
              </div>
              <div className="text-xs font-mono font-semibold text-[#0f172a] break-all">
                ID: {SPREADSHEET_ID}
              </div>
            </div>

            <a
              href={SPREADSHEET_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#3E8E41] hover:bg-emerald-50 shrink-0"
            >
              <span>Open Google Sheet</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {REQUIRED_SHEET_TABS.map((tab) => (
              <span
                key={tab}
                className="rounded-md border border-[#e2e8f0] bg-white px-2 py-0.5 text-[11px] font-mono text-slate-700"
              >
                {tab}
              </span>
            ))}
          </div>
        </section>

        {/* Clean Google Sheets Sync Status & Actions (Zero credentials exposed) */}
        <section className="rounded-xl border border-[#e2e8f0] bg-white p-3.5 sm:p-4 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${
                  isConnected
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                }`}
              >
                {isConnected ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#489E44]" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-slate-500" />
                )}
                <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-500">
              Last Synced: {lastSyncedLabel}
            </div>
          </div>

          {/* Direct Sync Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isTestingConnection}
              onClick={onTestConnectionAndSync}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0f172a] px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer min-h-[40px]"
            >
              <Activity
                className={`w-3.5 h-3.5 text-[#489E44] ${
                  isTestingConnection ? 'animate-pulse' : ''
                }`}
              />
              <span>
                {isTestingConnection ? 'Testing Connection...' : 'Test Connection'}
              </span>
            </button>

            <button
              type="button"
              onClick={onPullFromSheets}
              disabled={isPulling}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-[#0f172a] hover:bg-emerald-100 disabled:opacity-60 cursor-pointer min-h-[40px]"
            >
              <ArrowDownToLine
                className={`w-3.5 h-3.5 text-[#489E44] ${isPulling ? 'animate-bounce' : ''}`}
              />
              <span>{isPulling ? 'Pulling...' : 'Pull from Google Sheet'}</span>
            </button>

            <button
              type="button"
              disabled={isPushingAll}
              onClick={() => setConfirmPushAll(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#489E44] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#3E8E41] disabled:opacity-50 cursor-pointer min-h-[40px]"
            >
              <ArrowUpToLine className="w-3.5 h-3.5" />
              <span>{isPushingAll ? 'Pushing...' : 'Push All Tables'}</span>
            </button>
          </div>

          {confirmPushAll && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2 text-xs text-amber-900">
                <AlertTriangle className="w-4 h-4 text-[#f59e0b] shrink-0 mt-0.5" />
                <span>
                  Overwrite all 6 tabs in Google Sheet{' '}
                  <span className="font-mono font-bold break-all">{SPREADSHEET_ID}</span>{' '}
                  with current local data?
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmPushAll(false)}
                  className="rounded-md border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmPushAll(false);
                    onPushAllToSheets();
                  }}
                  className="rounded-md bg-[#489E44] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3E8E41] cursor-pointer"
                >
                  Confirm Overwrite
                </button>
              </div>
            </div>
          )}

          {/* Sync Verification Details */}
          <div className="rounded-xl border border-[#e2e8f0] bg-gray-50 p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-[#0f172a] flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-[#489E44]" />
                <span>Sync Verification</span>
              </div>

              {diagnostics ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-mono font-bold ${
                    diagnostics.connected
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  HTTP {diagnostics.httpStatus ?? '—'}
                </span>
              ) : (
                <span className="text-[11px] text-slate-500 font-medium">
                  Click Test Connection to verify
                </span>
              )}
            </div>

            {diagnostics ? (
              <>
                <div
                  className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                    diagnostics.connected
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-rose-200 bg-rose-50 text-rose-900'
                  }`}
                >
                  <div className="font-semibold break-words">{diagnostics.message}</div>
                  <div className="text-[10px] font-mono opacity-80 mt-0.5">
                    Checked: {new Date(diagnostics.testedAt).toLocaleTimeString()}
                  </div>
                </div>

                {diagnostics.tabStatuses.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {diagnostics.tabStatuses.map((ts) => (
                      <div
                        key={ts.tab}
                        className={`flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] bg-white ${
                          ts.ok ? 'border-emerald-200' : 'border-rose-200'
                        }`}
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          {ts.ok ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#489E44] shrink-0" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                          )}
                          <span className="font-mono font-semibold text-[#0f172a] truncate">
                            {ts.tab}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-slate-500 shrink-0">
                          {typeof ts.rows === 'number' ? `${ts.rows}r` : ts.httpStatus || 'err'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[11px] text-slate-500">
                Click <strong>Test Connection</strong> to verify live access, auto-create any
                missing tabs, and pull or initialize your spreadsheet rows.
              </p>
            )}
          </div>
        </section>

        {/* Biometric Device Quick Login */}
        <section className="rounded-xl border border-[#e2e8f0] bg-white p-3.5 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Fingerprint className="w-4 h-4 text-[#489E44] shrink-0" />
              <h3 className="text-xs font-bold text-[#0f172a] truncate">
                Biometric Quick Login ({session.username})
              </h3>
            </div>
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                biometricEnrolled
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {biometricEnrolled ? 'Enrolled on this device' : 'Not enrolled'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!biometricSupported}
              onClick={() => void handleEnrollBiometric()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#489E44] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#3E8E41] disabled:opacity-50 cursor-pointer min-h-[38px]"
            >
              <Fingerprint className="w-3.5 h-3.5" />
              <span>
                {biometricEnrolled
                  ? 'Re-register Face ID / Fingerprint'
                  : 'Enable Face ID / Fingerprint'}
              </span>
            </button>

            {biometricEnrolled && (
              <button
                type="button"
                onClick={handleRemoveBiometric}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer min-h-[38px]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove Device Biometric</span>
              </button>
            )}
          </div>

          {!biometricSupported && (
            <p className="text-[11px] text-slate-500">
              Platform biometrics are not exposed in this browser context. Open the app
              directly over HTTPS or mobile PWA install to enroll Face ID / Fingerprint.
            </p>
          )}

          {biometricMsg && (
            <p className="text-[11px] font-semibold text-slate-700">{biometricMsg}</p>
          )}
        </section>

        {/* Owner UPI + Dual-Owner Credentials Form */}
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Owner UPI ID (QR / Links)
              </label>
              <input
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm font-mono text-[#0f172a] min-h-[42px]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Owner / Estate Name
              </label>
              <input
                type="text"
                value={merchantName}
                onChange={(e) => setMerchantName(e.target.value)}
                className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm text-[#0f172a] min-h-[42px]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Owner WhatsApp (Tenure)
              </label>
              <input
                type="tel"
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value)}
                placeholder="+919845011223"
                className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm font-mono text-[#0f172a] min-h-[42px]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="settings-auto-lock-timer"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              Auto-Lock Timer
            </label>
            <select
              id="settings-auto-lock-timer"
              value={autoLockTimer}
              onChange={(e) => setAutoLockTimer(e.target.value as AutoLockTimerMode)}
              className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[42px]"
            >
              {AUTO_LOCK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Access & PIN Management (Both Owners) */}
          <div className="rounded-xl border border-[#e2e8f0] bg-[#f8f9ff] p-3.5 sm:p-4 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#0f172a]" />
              <h3 className="text-xs font-bold text-[#0f172a]">
                Access &amp; PIN Management (Both Co-Owners)
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Owner 1 Email / Username
                </label>
                <input
                  type="text"
                  value={owner1Username}
                  onChange={(e) => setOwner1Username(e.target.value)}
                  className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-[#0f172a] min-h-[40px]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Owner 1 PIN / Password
                </label>
                <input
                  type="password"
                  value={owner1Pin}
                  onChange={(e) => setOwner1Pin(e.target.value)}
                  className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-mono text-[#0f172a] min-h-[40px]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Owner 2 Email / Username
                </label>
                <input
                  type="text"
                  value={owner2Username}
                  onChange={(e) => setOwner2Username(e.target.value)}
                  className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-[#0f172a] min-h-[40px]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Owner 2 PIN / Password
                </label>
                <input
                  type="password"
                  value={owner2Pin}
                  onChange={(e) => setOwner2Pin(e.target.value)}
                  className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-mono text-[#0f172a] min-h-[40px]"
                />
              </div>
            </div>
          </div>

          {accessError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-800">
              {accessError}
            </div>
          )}

          {savedNotice && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800">
              <Check className="w-4 h-4 text-[#10b981] shrink-0" />
              <span>{savedNotice}</span>
            </div>
          )}

          {pullFeedback && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-800 break-words">
              {pullFeedback}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2563eb] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer min-h-[40px]"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Settings</span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <PWAInstallButton compact />
              <button
                type="button"
                onClick={onResetBaseline}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer min-h-[40px]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Demo Data</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
