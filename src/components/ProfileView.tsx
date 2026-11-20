import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Fingerprint,
  LogOut,
  QrCode,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { AUTO_LOCK_OPTIONS } from '../config/authConfig';
import {
  isBiometricEnrolledForUser,
  isPlatformBiometricSupported,
  registerPlatformBiometric,
  removeBiometricForUser,
} from '../services/biometricAuth';
import { SPREADSHEET_ID, SPREADSHEET_URL } from '../services/googleSheetsSync';
import {
  AppSettings,
  AuthSession,
  AutoLockTimerMode,
  SyncDiagnostics,
  SyncStatus,
} from '../types/estate';
import { MobileShellHeader } from './MobileShellHeader';

interface ProfileViewProps {
  session: AuthSession;
  settings: AppSettings;
  autoLockTimer: AutoLockTimerMode;
  secretConfigured: boolean;
  syncStatus: SyncStatus;
  diagnostics: SyncDiagnostics | null;
  isTestingConnection: boolean;
  isPulling: boolean;
  isPushingAll: boolean;
  onBack: () => void;
  onChangeAutoLockTimer: (mode: AutoLockTimerMode) => void;
  onTestConnection: () => void;
  onPullFromSheets: () => void;
  onPushAllToSheets: () => void;
  onOpenSettings: () => void;
  onOpenInstallModal: () => void;
  onLogout: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  session,
  settings,
  autoLockTimer,
  secretConfigured,
  syncStatus,
  diagnostics,
  isTestingConnection,
  isPulling,
  isPushingAll,
  onBack,
  onChangeAutoLockTimer,
  onTestConnection,
  onPullFromSheets,
  onPushAllToSheets,
  onOpenSettings,
  onOpenInstallModal,
  onLogout,
}) => {
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [bioMsg, setBioMsg] = useState<string | null>(null);

  useEffect(() => {
    setBiometricEnrolled(isBiometricEnrolledForUser(session.username));
    void isPlatformBiometricSupported().then(setBiometricSupported);
  }, [session.username]);

  const isConnected = Boolean(
    diagnostics?.connected || (secretConfigured && settings.last_synced_at)
  );

  const handleEnrollBiometric = async () => {
    setBioMsg(null);
    const res = await registerPlatformBiometric(session.username);
    if (res.ok) {
      setBiometricEnrolled(true);
      setBioMsg('Face ID / Fingerprint quick login enabled on this device.');
    } else {
      setBioMsg('error' in res ? res.error : 'Biometric enrollment failed.');
    }
  };

  const handleRemoveBiometric = () => {
    removeBiometricForUser(session.username);
    setBiometricEnrolled(false);
    setBioMsg('Removed biometric quick login on this device.');
  };

  return (
    <div className="min-h-full">
      <MobileShellHeader
        title="Owner Profile"
        subtitle="Account, Google Sheets sync & device security"
        onBack={onBack}
        rightSlot={
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FACC15] px-2.5 py-1 text-[11px] font-bold text-[#0f172a]">
            Owner
          </span>
        }
      >
        <div className="rounded-2xl bg-white/15 backdrop-blur-xs px-3.5 py-3 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#3E8E41] font-bold text-sm">
            {(session.accountLabel || 'OW').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-white truncate">
              {settings.merchant_name}
            </div>
            <div className="text-xs text-emerald-50/90 truncate">
              {session.accountLabel || 'Owner'} · {session.username}
            </div>
          </div>
        </div>
      </MobileShellHeader>

      <div className="bg-white rounded-t-[28px] -mt-5 pt-5 px-4 pb-24 min-h-[calc(100vh-170px)] space-y-4">
        {/* Google Sheets Sync Quick Card */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet className="w-4 h-4 text-[#489E44] shrink-0" />
              <span className="text-xs font-bold text-[#0f172a] truncate">
                Google Sheets Sync
              </span>
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                syncStatus === 'Syncing...'
                  ? 'bg-amber-50 text-amber-700'
                  : isConnected
                    ? 'bg-emerald-50 text-[#3E8E41]'
                    : 'bg-gray-100 text-gray-600'
              }`}
            >
              {syncStatus === 'Syncing...' ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : isConnected ? (
                <CheckCircle2 className="w-3 h-3 text-[#489E44]" />
              ) : (
                <XCircle className="w-3 h-3 text-gray-500" />
              )}
              <span>
                {syncStatus === 'Syncing...'
                  ? 'Syncing'
                  : isConnected
                    ? 'Connected'
                    : 'Not Tested'}
              </span>
            </span>
          </div>

          <div className="text-[11px] font-mono text-gray-500 break-all">
            Sheet ID: {SPREADSHEET_ID}
          </div>

          <div className="text-[11px] text-gray-500">
            Last Synced:{' '}
            <strong className="text-[#0f172a]">
              {settings.last_synced_at
                ? new Date(settings.last_synced_at).toLocaleString()
                : 'Never'}
            </strong>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              onClick={onTestConnection}
              disabled={isTestingConnection}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-[#0f172a] px-2.5 py-2.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              <Activity className="w-3.5 h-3.5 text-[#489E44] shrink-0" />
              <span>{isTestingConnection ? 'Testing' : 'Test'}</span>
            </button>

            <button
              type="button"
              onClick={onPullFromSheets}
              disabled={isPulling}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-2.5 text-[11px] font-semibold text-[#3E8E41] hover:bg-emerald-100 disabled:opacity-50 cursor-pointer"
            >
              <ArrowDownToLine className="w-3.5 h-3.5 shrink-0" />
              <span>{isPulling ? 'Pulling' : 'Pull'}</span>
            </button>

            <button
              type="button"
              onClick={onPushAllToSheets}
              disabled={isPushingAll}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-[#489E44] px-2.5 py-2.5 text-[11px] font-semibold text-white hover:bg-[#3E8E41] disabled:opacity-50 cursor-pointer"
            >
              <ArrowUpToLine className="w-3.5 h-3.5 shrink-0" />
              <span>{isPushingAll ? 'Pushing' : 'Push All'}</span>
            </button>
          </div>

          <a
            href={SPREADSHEET_URL}
            target="_blank"
            rel="noreferrer"
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-[#0f172a] hover:bg-gray-100"
          >
            <span>Open Live Google Sheet</span>
            <ExternalLink className="w-3.5 h-3.5 text-[#489E44]" />
          </a>
        </section>

        {/* Biometric Security Card */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-[#489E44]" />
              <span className="text-xs font-bold text-[#0f172a]">
                Face ID / Fingerprint Login
              </span>
            </div>
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                biometricEnrolled
                  ? 'bg-emerald-50 text-[#3E8E41]'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {biometricEnrolled ? 'Enabled' : 'Not Enrolled'}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!biometricSupported}
              onClick={() => void handleEnrollBiometric()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#489E44] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#3E8E41] disabled:opacity-50 cursor-pointer"
            >
              <Fingerprint className="w-3.5 h-3.5" />
              <span>{biometricEnrolled ? 'Re-register' : 'Enable Biometric'}</span>
            </button>
            {biometricEnrolled && (
              <button
                type="button"
                onClick={handleRemoveBiometric}
                className="inline-flex items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            )}
          </div>

          {!biometricSupported && (
            <p className="text-[11px] text-gray-500">
              Open in HTTPS / mobile PWA to enroll Face ID or Fingerprint.
            </p>
          )}
          {bioMsg && <p className="text-[11px] font-semibold text-[#3E8E41]">{bioMsg}</p>}
        </section>

        {/* Auto-Lock Timer Card */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#489E44]" />
              <span className="text-xs font-bold text-[#0f172a]">
                Auto-Lock Timer
              </span>
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

          <div className="space-y-1.5" role="radiogroup" aria-label="Auto-Lock Timer">
            {AUTO_LOCK_OPTIONS.map((option) => {
              const selected = autoLockTimer === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChangeAutoLockTimer(option.value)}
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

        {/* Owner Settings & Install Actions */}
        <section className="rounded-2xl border border-gray-100 bg-white divide-y divide-gray-100 shadow-2xs overflow-hidden">
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-gray-50 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-[#489E44]">
                <Settings className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-[#0f172a]">
                  UPI, PINs &amp; Sync Settings
                </div>
                <div className="text-[11px] text-gray-500">
                  {settings.merchant_upi_id}
                </div>
              </div>
            </div>
            <ShieldCheck className="w-4 h-4 text-gray-400" />
          </button>

          <button
            type="button"
            onClick={onOpenInstallModal}
            className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-gray-50 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-[#489E44]">
                <QrCode className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-[#0f172a]">
                  Install Mobile App &amp; Share QR
                </div>
                <div className="text-[11px] text-gray-500">
                  Android, iOS Safari &amp; Desktop PWA
                </div>
              </div>
            </div>
          </button>
        </section>

        <button
          type="button"
          onClick={onLogout}
          className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-xs font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Lock &amp; Sign Out</span>
        </button>
      </div>
    </div>
  );
};
