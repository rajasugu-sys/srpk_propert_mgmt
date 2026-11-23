import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  BellRing,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings,
  Smartphone,
  X,
  XCircle,
} from 'lucide-react';
import {
  AUTO_LOCK_OPTIONS,
  fetchMasterAdminPin,
  loadAutoLockTimerMode,
  saveAutoLockTimerMode,
  updateMasterAdminPin,
} from '../config/authConfig';
import {
  REQUIRED_SHEET_TABS,
  SPREADSHEET_ID,
  SPREADSHEET_URL,
} from '../services/googleSheetsSync';
import type {
  AppSettings,
  AuthSession,
  AutoLockTimerMode,
  SyncDiagnostics,
  SyncStatus,
} from '../types/estate';
import { PWAInstallButton } from './PWAControls';

interface SettingsModalProps {
  isOpen: boolean;
  session: AuthSession;
  settings: AppSettings;
  autoLockTimer?: AutoLockTimerMode;
  secretConfigured: boolean;
  syncStatus?: SyncStatus;
  diagnostics: SyncDiagnostics | null;
  isTestingConnection: boolean;
  isPulling: boolean;
  isPushingAll: boolean;
  pullFeedback: string | null;
  notificationPermission?: NotificationPermission | 'unsupported';
  pushBusy?: boolean;
  pushSubscribed?: boolean;
  pushDeviceCount?: number;
  pushFeedback?: { ok: boolean; message: string } | null;
  onEnablePhonePush?: () => void;
  onSendTestPush?: () => void;
  onClose: () => void;
  onSaveSettings: (next: AppSettings) => void;
  onChangeAutoLockTimer?: (mode: AutoLockTimerMode) => void;
  onTestConnectionAndSync: () => void;
  onPullFromSheets: () => void;
  onPushAllToSheets: () => void;
  onOpenInstallModal: () => void;
  onResetBaseline: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  session,
  settings,
  autoLockTimer: propAutoLockTimer,
  secretConfigured,
  syncStatus,
  diagnostics,
  isTestingConnection,
  isPulling,
  isPushingAll,
  pullFeedback,
  notificationPermission = 'default',
  pushBusy = false,
  pushSubscribed = false,
  pushDeviceCount = 0,
  pushFeedback = null,
  onEnablePhonePush,
  onSendTestPush,
  onClose,
  onSaveSettings,
  onChangeAutoLockTimer,
  onTestConnectionAndSync,
  onPullFromSheets,
  onPushAllToSheets,
  onOpenInstallModal,
  onResetBaseline,
}) => {
  const [merchantName, setMerchantName] = useState(settings.merchant_name);
  const [ownerPhone, setOwnerPhone] = useState(settings.owner_whatsapp_phone || '+91');
  const [autoLockTimer, setAutoLockTimer] = useState<AutoLockTimerMode>(
    propAutoLockTimer || settings.auto_lock_timer || loadAutoLockTimerMode()
  );

  // Admin-Only 12-Char Master Admin PIN State
  const [masterPin, setMasterPin] = useState(settings.master_admin_pin || '');
  const [customMasterPinInput, setCustomMasterPinInput] = useState('');
  const [showMasterPin, setShowMasterPin] = useState(false);
  const [copiedMasterPin, setCopiedMasterPin] = useState(false);
  const [masterPinBusy, setMasterPinBusy] = useState(false);
  const [masterPinStatus, setMasterPinStatus] = useState<string | null>(null);

  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [confirmPushAll, setConfirmPushAll] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMerchantName(settings.merchant_name);
    setOwnerPhone(settings.owner_whatsapp_phone || '+91');
    setAutoLockTimer(
      propAutoLockTimer || settings.auto_lock_timer || loadAutoLockTimerMode()
    );
    setMasterPin(settings.master_admin_pin || '');
    setCustomMasterPinInput(settings.master_admin_pin || '');
    setConfirmPushAll(false);
    setSavedNotice(null);
    setAccessError(null);
    setMasterPinStatus(null);

    if (session.accessType === 'admin' && session.authToken) {
      void fetchMasterAdminPin(session.authToken).then((res) => {
        if (res.ok) {
          setMasterPin(res.masterAdminPin);
          setCustomMasterPinInput(res.masterAdminPin);
        }
      });
    }
  }, [settings, isOpen, propAutoLockTimer, session.accessType, session.authToken]);

  // Strict Admin-Only Guard
  if (!isOpen || session.accessType !== 'admin') return null;

  const isConnected = Boolean(
    diagnostics?.connected || (secretConfigured && settings.last_synced_at)
  );
  const lastSyncedLabel = settings.last_synced_at
    ? new Date(settings.last_synced_at).toLocaleString()
    : 'Never synced';

  const handleCopyMasterPin = async () => {
    if (!masterPin) return;
    try {
      await navigator.clipboard.writeText(masterPin);
      setCopiedMasterPin(true);
      setTimeout(() => setCopiedMasterPin(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleGenerateMasterPin = async () => {
    if (!session.authToken) return;
    setMasterPinBusy(true);
    setMasterPinStatus(null);
    setAccessError(null);
    const res = await updateMasterAdminPin(session.authToken, { mode: 'generate' });
    setMasterPinBusy(false);
    if (!res.ok) {
      setAccessError('error' in res ? res.error : 'Could not rotate Master Admin PIN.');
      return;
    }
    setMasterPin(res.masterAdminPin);
    setCustomMasterPinInput(res.masterAdminPin);
    setMasterPinStatus('New 12-character Master Admin PIN generated & synced to Sheets.');
    onSaveSettings({ ...settings, master_admin_pin: res.masterAdminPin });
  };

  const handleSaveCustomMasterPin = async () => {
    if (!session.authToken) return;
    const clean = customMasterPinInput.trim().toUpperCase();
    if (!/^[A-Za-z0-9]{12}$/.test(clean)) {
      setAccessError(
        'Master Admin PIN must be exactly 12 alphanumeric characters (A-Z, 0-9).'
      );
      return;
    }
    setMasterPinBusy(true);
    setMasterPinStatus(null);
    setAccessError(null);
    const res = await updateMasterAdminPin(session.authToken, {
      mode: 'custom',
      customPin: clean,
    });
    setMasterPinBusy(false);
    if (!res.ok) {
      setAccessError('error' in res ? res.error : 'Could not save Master Admin PIN.');
      return;
    }
    setMasterPin(res.masterAdminPin);
    setCustomMasterPinInput(res.masterAdminPin);
    setMasterPinStatus('Master Admin PIN updated & synced to Sheets.');
    onSaveSettings({ ...settings, master_admin_pin: res.masterAdminPin });
  };

  const handleSelectAutoLock = (mode: AutoLockTimerMode) => {
    setAutoLockTimer(mode);
    saveAutoLockTimerMode(mode);
    onChangeAutoLockTimer?.(mode);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setAccessError(null);
    saveAutoLockTimerMode(autoLockTimer);

    onSaveSettings({
      ...settings,
      merchant_name: merchantName.trim() || settings.merchant_name,
      owner_whatsapp_phone: ownerPhone.trim() || settings.owner_whatsapp_phone,
      auto_lock_timer: autoLockTimer,
      master_admin_pin: masterPin || settings.master_admin_pin,
    });
    setSavedNotice('Settings saved.');
    setTimeout(() => setSavedNotice(null), 3000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/60 backdrop-blur-xs p-2 sm:p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
        {/* Emerald Green Modal Header */}
        <div className="bg-gradient-to-b from-[#489E44] to-[#3E8E41] text-white px-4 sm:px-6 py-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
              <Settings className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="settings-modal-title"
                className="text-base sm:text-lg font-bold text-white leading-tight"
              >
                Admin Settings &amp; System Config
              </h2>
              <p className="text-xs text-emerald-50/90 mt-0.5">
                Auto-Lock, Owner details, Master Admin PIN, Google Sheets &amp; App Link
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-white/80 hover:bg-white/15 hover:text-white cursor-pointer shrink-0"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5 bg-white">
          {/* 1. Google Sheets Sync Settings */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3.5 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-[#489E44] shrink-0" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#0f172a]">
                    Google Sheets Sync Settings
                  </h3>
                </div>
                <div className="text-xs font-mono text-gray-600 break-all">
                  Sheet ID: {SPREADSHEET_ID}
                </div>
              </div>

              <a
                href={SPREADSHEET_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-[#3E8E41] hover:bg-emerald-100 shrink-0"
              >
                <span>Open Live Google Sheet</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {REQUIRED_SHEET_TABS.map((tab) => (
                <span
                  key={tab}
                  className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-mono text-gray-700"
                >
                  {tab}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-y border-gray-100">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${
                    syncStatus === 'Syncing...'
                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                      : isConnected
                        ? 'bg-emerald-50 text-[#3E8E41] border border-emerald-200'
                        : 'bg-gray-100 text-gray-700 border border-gray-200'
                  }`}
                >
                  {syncStatus === 'Syncing...' ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
                  ) : isConnected ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#489E44]" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-gray-500" />
                  )}
                  <span>
                    {syncStatus === 'Syncing...'
                      ? 'Syncing...'
                      : isConnected
                        ? 'Connected'
                        : 'Disconnected'}
                  </span>
                </span>
              </div>
              <div className="text-[11px] font-mono text-gray-500">
                Last Synced: {lastSyncedLabel}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isTestingConnection}
                onClick={onTestConnectionAndSync}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0f172a] px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer min-h-[40px]"
              >
                <Activity
                  className={`w-3.5 h-3.5 text-[#489E44] ${
                    isTestingConnection ? 'animate-pulse' : ''
                  }`}
                />
                <span>{isTestingConnection ? 'Testing...' : 'Test Connection'}</span>
              </button>

              <button
                type="button"
                onClick={onPullFromSheets}
                disabled={isPulling}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-[#3E8E41] hover:bg-emerald-100 disabled:opacity-60 cursor-pointer min-h-[40px]"
              >
                <ArrowDownToLine
                  className={`w-3.5 h-3.5 ${isPulling ? 'animate-bounce' : ''}`}
                />
                <span>{isPulling ? 'Pulling...' : 'Pull from Sheet'}</span>
              </button>

              <button
                type="button"
                disabled={isPushingAll}
                onClick={() => setConfirmPushAll(true)}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#489E44] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#3E8E41] disabled:opacity-50 cursor-pointer min-h-[40px]"
              >
                <ArrowUpToLine className="w-3.5 h-3.5" />
                <span>{isPushingAll ? 'Pushing...' : 'Push All Tables'}</span>
              </button>
            </div>

            {confirmPushAll && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    Overwrite all {REQUIRED_SHEET_TABS.length} tabs in Google Sheet{' '}
                    <span className="font-mono font-bold break-all">{SPREADSHEET_ID}</span>{' '}
                    with current local data?
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirmPushAll(false)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmPushAll(false);
                      onPushAllToSheets();
                    }}
                    className="rounded-lg bg-[#489E44] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3E8E41] cursor-pointer"
                  >
                    Confirm Overwrite
                  </button>
                </div>
              </div>
            )}

            {/* Sync Verification Details */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
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
                  <span className="text-[11px] text-gray-500 font-medium">
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
                          <span className="font-mono text-[10px] text-gray-500 shrink-0">
                            {typeof ts.rows === 'number' ? `${ts.rows}r` : ts.httpStatus || 'err'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-gray-500">
                  Click <strong>Test Connection</strong> to verify live access, auto-create any
                  missing tabs, and sync your spreadsheet rows.
                </p>
              )}
            </div>
          </section>

          {/* 2. Master Admin PIN Management (Admins Only) */}
          <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-700" />
                <h3 className="text-xs font-bold text-[#0f172a]">
                  Master Admin PIN (12-Char Alphanumeric)
                </h3>
              </div>
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                Admins Only
              </span>
            </div>

            <p className="text-[11px] text-gray-600 leading-relaxed">
              Required when new users sign up with <strong>Admin</strong> access. Viewers never see this PIN.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[180px] flex items-center justify-between rounded-xl border border-amber-300 bg-white px-3 py-2">
                <span className="font-mono text-sm font-bold tracking-widest text-[#0f172a]">
                  {showMasterPin ? masterPin || '••••••••••••' : '••••••••••••'}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowMasterPin((v) => !v)}
                    className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 cursor-pointer"
                    aria-label={showMasterPin ? 'Hide Master PIN' : 'Show Master PIN'}
                  >
                    {showMasterPin ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyMasterPin()}
                    className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 cursor-pointer"
                    aria-label="Copy Master Admin PIN"
                  >
                    {copiedMasterPin ? (
                      <Check className="w-4 h-4 text-[#489E44]" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="button"
                disabled={masterPinBusy}
                onClick={() => void handleGenerateMasterPin()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#0f172a] px-3 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer min-h-[40px]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${masterPinBusy ? 'animate-spin' : ''}`} />
                <span>Generate New PIN</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                maxLength={12}
                value={customMasterPinInput}
                onChange={(e) =>
                  setCustomMasterPinInput(
                    e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
                  )
                }
                placeholder="Set custom 12-char alphanumeric PIN"
                className="flex-1 min-w-[200px] rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-mono uppercase tracking-wider text-[#0f172a] min-h-[40px]"
              />
              <button
                type="button"
                disabled={masterPinBusy}
                onClick={() => void handleSaveCustomMasterPin()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50 cursor-pointer min-h-[40px]"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save PIN</span>
              </button>
            </div>

            {masterPinStatus && (
              <div className="text-[11px] font-semibold text-[#3E8E41]">
                {masterPinStatus}
              </div>
            )}
          </section>

          {/* 3. Auto-Lock Timer & Owner Details Form */}
          <form onSubmit={handleSave} className="space-y-4">
            {/* Owner & Estate Details */}
            <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#0f172a]">
                Owner &amp; Estate Details
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Estate / Management Name
                  </label>
                  <input
                    type="text"
                    value={merchantName}
                    onChange={(e) => setMerchantName(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-[#0f172a] min-h-[42px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    WhatsApp Phone (Alerts)
                  </label>
                  <input
                    type="tel"
                    value={ownerPhone}
                    onChange={(e) => setOwnerPhone(e.target.value)}
                    placeholder="+919845011223"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-[#0f172a] min-h-[42px]"
                  />
                </div>
              </div>
            </section>

            {/* Auto-Lock Timer */}
            <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#489E44]" />
                  <h3 className="text-xs font-bold text-[#0f172a]">
                    Auto-Lock Timer
                  </h3>
                </div>
                <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-[#3E8E41]">
                  {autoLockTimer === 'immediate'
                    ? 'Immediate'
                    : autoLockTimer === '5m'
                      ? '5 min'
                      : autoLockTimer === '30m'
                        ? '30 min'
                        : '15 min'}
                </span>
              </div>

              <p className="text-[11px] text-gray-500 leading-relaxed">
                Automatically locks the app when idle or after leaving the app in the background.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Auto-Lock Timer">
                {AUTO_LOCK_OPTIONS.map((option) => {
                  const selected = autoLockTimer === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => handleSelectAutoLock(option.value)}
                      className={`w-full flex items-center justify-between gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#489E44] bg-emerald-50/70'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <div
                          className={`text-xs font-semibold ${
                            selected ? 'text-[#3E8E41]' : 'text-[#0f172a]'
                          }`}
                        >
                          {option.label}
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          {option.description}
                        </div>
                      </div>
                      <div
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          selected
                            ? 'border-[#489E44] bg-[#489E44] text-white'
                            : 'border-gray-300 bg-white'
                        }`}
                      >
                        {selected && <Check className="w-3 h-3" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {accessError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-800">
                {accessError}
              </div>
            )}

            {savedNotice && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-[#3E8E41]">
                <Check className="w-4 h-4 text-[#489E44] shrink-0" />
                <span>{savedNotice}</span>
              </div>
            )}

            {pullFeedback && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-[#3E8E41] break-words">
                {pullFeedback}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#489E44] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#3E8E41] cursor-pointer min-h-[42px]"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Settings</span>
              </button>

              <button
                type="button"
                onClick={onResetBaseline}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 cursor-pointer min-h-[40px]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Demo Data</span>
              </button>
            </div>
          </form>

          {/* 4. Phone Push Notifications (Self-Hosted W3C Web Push) */}
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BellRing className="w-4 h-4 text-[#489E44]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#0f172a]">
                  Phone Push Notifications (Web Push)
                </h3>
              </div>
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                  pushSubscribed || pushDeviceCount > 0
                    ? 'bg-emerald-100 text-[#3E8E41]'
                    : notificationPermission === 'denied'
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-gray-100 text-gray-700'
                }`}
              >
                {pushDeviceCount > 0
                  ? `${pushDeviceCount} Device${pushDeviceCount === 1 ? '' : 's'} Subscribed`
                  : notificationPermission === 'denied'
                    ? 'Blocked in Browser'
                    : 'Not Subscribed'}
              </span>
            </div>

            <p className="text-[11px] text-gray-600 leading-relaxed">
              Receive real background alerts on mobile and desktop every <strong>1st of the month (9:00 AM IST)</strong> for monthly bill generation and 4-month lease expiry countdowns — even when the app is closed.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pushBusy || notificationPermission === 'unsupported'}
                onClick={onEnablePhonePush}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#489E44] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#3E8E41] disabled:opacity-50 cursor-pointer min-h-[40px]"
              >
                <BellRing className="w-3.5 h-3.5" />
                <span>
                  {pushBusy
                    ? 'Configuring...'
                    : pushSubscribed
                      ? 'Refresh Phone Push Notifications'
                      : 'Enable Phone Push Notifications'}
                </span>
              </button>

              <button
                type="button"
                disabled={pushBusy || notificationPermission === 'unsupported'}
                onClick={onSendTestPush}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3.5 py-2 text-xs font-bold text-[#0f172a] hover:bg-emerald-50 disabled:opacity-50 cursor-pointer min-h-[40px]"
              >
                <Send className="w-3.5 h-3.5 text-[#489E44]" />
                <span>Send Test Push Notification</span>
              </button>
            </div>

            {pushFeedback && (
              <div
                className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                  pushFeedback.ok
                    ? 'border-emerald-200 bg-emerald-50 text-[#3E8E41]'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
              >
                {pushFeedback.message}
              </div>
            )}
          </section>

          {/* 5. Install Mobile App & Share Link */}
          <section className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#489E44]">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#0f172a]">
                  Install Mobile App &amp; Share Link
                </div>
                <div className="text-[11px] text-gray-500">
                  Android, iPhone / iPad Safari &amp; Laptop Desktop PWA
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <PWAInstallButton compact onOpenModal={onOpenInstallModal} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
