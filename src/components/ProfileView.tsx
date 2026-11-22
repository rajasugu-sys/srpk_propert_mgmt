import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { changeAccountPassword } from '../config/authConfig';
import {
  isBiometricEnrolledForUser,
  isPlatformBiometricSupported,
  registerPlatformBiometric,
  removeBiometricForUser,
} from '../services/biometricAuth';
import type { AuthSession } from '../types/estate';
import { MobileShellHeader } from './MobileShellHeader';

interface ProfileViewProps {
  session: AuthSession;
  onBack: () => void;
  onLogout: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  session,
  onBack,
  onLogout,
}) => {
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [bioMsg, setBioMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [pwdFeedback, setPwdFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [isUpdatingPwd, setIsUpdatingPwd] = useState(false);

  useEffect(() => {
    setBiometricEnrolled(isBiometricEnrolledForUser(session.userId));
    void isPlatformBiometricSupported().then(setBiometricSupported);
  }, [session.userId]);

  const handleEnrollBiometric = async () => {
    setBioMsg(null);
    setBiometricBusy(true);
    const res = await registerPlatformBiometric(session.userId, session.fullName);
    setBiometricBusy(false);
    if (res.ok) {
      setBiometricEnrolled(true);
      setBioMsg({
        type: 'ok',
        text: 'Face ID / Fingerprint quick login enabled on this device.',
      });
    } else {
      setBioMsg({
        type: 'err',
        text: 'error' in res ? res.error : 'Biometric enrollment failed.',
      });
    }
  };

  const handleRemoveBiometric = () => {
    removeBiometricForUser(session.userId);
    setBiometricEnrolled(false);
    setBioMsg({
      type: 'ok',
      text: 'Biometric quick login disabled on this device.',
    });
  };

  const handleToggleBiometric = () => {
    if (biometricEnrolled) {
      handleRemoveBiometric();
    } else {
      void handleEnrollBiometric();
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdFeedback(null);
    if (newPwd.trim().length < 4) {
      setPwdFeedback({ type: 'err', text: 'New password must be at least 4 characters.' });
      return;
    }
    if (newPwd.trim() !== confirmPwd.trim()) {
      setPwdFeedback({ type: 'err', text: 'New password and confirmation do not match.' });
      return;
    }
    if (!session.authToken) {
      setPwdFeedback({ type: 'err', text: 'Session expired. Sign in again.' });
      return;
    }
    setIsUpdatingPwd(true);
    const res = await changeAccountPassword(
      session.authToken,
      currentPwd.trim(),
      newPwd.trim()
    );
    setIsUpdatingPwd(false);
    if (!res.ok) {
      setPwdFeedback({
        type: 'err',
        text: 'error' in res ? res.error : 'Failed changing password.',
      });
      return;
    }
    setCurrentPwd('');
    setNewPwd('');
    setConfirmPwd('');
    setPwdFeedback({ type: 'ok', text: res.message });
  };

  const displayName = session.fullName || session.username || session.userId;
  const displayInitials = displayName.trim().slice(0, 2).toUpperCase();
  const roleLabel = session.accessType === 'admin' ? 'Admin' : 'Viewer';

  return (
    <div className="min-h-full">
      <MobileShellHeader
        title="My Profile"
        subtitle="Personal account & security"
        onBack={onBack}
        rightSlot={
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FACC15] px-2.5 py-1 text-[11px] font-bold text-[#0f172a]">
            {roleLabel}
          </span>
        }
      >
        <div className="rounded-2xl bg-white/15 backdrop-blur-xs px-3.5 py-3 flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-[#3E8E41] font-extrabold text-sm shadow-xs">
            {displayInitials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-white truncate">{displayName}</div>
            <div className="text-xs text-emerald-50/90 truncate font-mono">
              @{session.userId}
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold text-white shrink-0">
            <ShieldCheck className="w-3 h-3" />
            <span>{roleLabel}</span>
          </span>
        </div>
      </MobileShellHeader>

      <div className="bg-white rounded-t-[28px] -mt-5 pt-5 px-4 pb-24 min-h-[calc(100vh-170px)] space-y-4">
        {/* Personal Account Information Card */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-[#489E44]" />
              <span className="text-xs font-bold text-[#0f172a]">
                Account Information
              </span>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                session.accessType === 'admin'
                  ? 'bg-emerald-50 text-[#3E8E41]'
                  : 'bg-amber-50 text-amber-800'
              }`}
            >
              {roleLabel} Access
            </span>
          </div>

          <div className="divide-y divide-gray-100 text-xs">
            <div className="py-2 flex items-center justify-between gap-3">
              <span className="text-gray-500">Full Name</span>
              <span className="font-semibold text-[#0f172a] text-right truncate">
                {displayName}
              </span>
            </div>
            <div className="py-2 flex items-center justify-between gap-3">
              <span className="text-gray-500">User ID</span>
              <span className="font-mono font-semibold text-[#0f172a] text-right truncate">
                {session.userId}
              </span>
            </div>
            <div className="py-2 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-gray-500">
                <Mail className="w-3.5 h-3.5 text-gray-400" />
                <span>Email</span>
              </span>
              <span className="font-medium text-[#0f172a] text-right truncate">
                {session.email || 'Not set'}
              </span>
            </div>
            <div className="py-2 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-gray-500">
                <Phone className="w-3.5 h-3.5 text-gray-400" />
                <span>Mobile Number</span>
              </span>
              <span className="font-mono font-semibold text-[#0f172a] text-right truncate">
                {session.mobileNumber || 'Not set'}
              </span>
            </div>
          </div>
        </section>

        {/* Change Account Password Card */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#489E44]" />
              <span className="text-xs font-bold text-[#0f172a]">
                Change Password / PIN
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="text-gray-400 hover:text-gray-700 cursor-pointer"
              aria-label={showPwd ? 'Hide password inputs' : 'Show password inputs'}
            >
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {pwdFeedback && (
            <div
              className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${
                pwdFeedback.type === 'ok'
                  ? 'bg-emerald-50 text-[#3E8E41]'
                  : 'bg-rose-50 text-rose-700'
              }`}
            >
              {pwdFeedback.type === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{pwdFeedback.text}</span>
            </div>
          )}

          <form onSubmit={(e) => void handleChangePassword(e)} className="space-y-2">
            <input
              type={showPwd ? 'text' : 'password'}
              value={currentPwd}
              onChange={(e) => setCurrentPwd(e.target.value)}
              placeholder="Current Password / PIN"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-[#0f172a] min-h-[40px]"
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type={showPwd ? 'text' : 'password'}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="New Password"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-[#0f172a] min-h-[40px]"
                required
              />
              <input
                type={showPwd ? 'text' : 'password'}
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Confirm Password"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-[#0f172a] min-h-[40px]"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isUpdatingPwd}
              className="w-full rounded-xl bg-[#489E44] px-3 py-2 text-xs font-bold text-white hover:bg-[#3E8E41] disabled:opacity-50 cursor-pointer min-h-[42px]"
            >
              {isUpdatingPwd ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </section>

        {/* Biometric Quick Login Card (Face ID / Fingerprint) */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Fingerprint className="w-4 h-4 text-[#489E44] shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#0f172a]">
                  Biometric Quick Login
                </div>
                <div className="text-[11px] text-gray-500">
                  Face ID / Fingerprint on this device
                </div>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={biometricEnrolled}
              aria-label="Toggle Biometric Quick Login"
              disabled={(!biometricSupported && !biometricEnrolled) || biometricBusy}
              onClick={handleToggleBiometric}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                biometricEnrolled ? 'bg-[#489E44]' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow-xs transition-transform ${
                  biometricEnrolled ? 'translate-x-5.5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!biometricSupported || biometricBusy}
              onClick={() => void handleEnrollBiometric()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#489E44] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#3E8E41] disabled:opacity-50 cursor-pointer"
            >
              <Fingerprint className="w-3.5 h-3.5" />
              <span>
                {biometricBusy
                  ? 'Enrolling...'
                  : biometricEnrolled
                    ? 'Re-register Biometric'
                    : 'Enroll Face ID / Fingerprint'}
              </span>
            </button>
            {biometricEnrolled && (
              <button
                type="button"
                onClick={handleRemoveBiometric}
                className="inline-flex items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Disable</span>
              </button>
            )}
          </div>

          {!biometricSupported && (
            <p className="text-[11px] text-gray-500">
              Open in HTTPS / mobile PWA to enroll Face ID or Fingerprint.
            </p>
          )}
          {bioMsg && (
            <p
              className={`text-[11px] font-semibold ${
                bioMsg.type === 'ok' ? 'text-[#3E8E41]' : 'text-rose-700'
              }`}
            >
              {bioMsg.text}
            </p>
          )}
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
