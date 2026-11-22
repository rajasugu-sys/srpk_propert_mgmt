import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Eye,
  EyeOff,
  Fingerprint,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  resolveEffectiveCredentials,
  verifyOwnerLogin,
} from '../config/authConfig';
import {
  authenticateWithPlatformBiometric,
  getEnrolledBiometrics,
  isPlatformBiometricSupported,
  StoredBiometricCredential,
} from '../services/biometricAuth';
import { AuthSession, RoleCredentialsConfig } from '../types/estate';

interface LoginGateProps {
  settingsCredentials?: RoleCredentialsConfig;
  lockNotice?: string | null;
  onDismissNotice?: () => void;
  onAuthenticated: (session: AuthSession) => void;
}

export const LoginGate: React.FC<LoginGateProps> = ({
  settingsCredentials,
  lockNotice,
  onDismissNotice,
  onAuthenticated,
}) => {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [enrolledList, setEnrolledList] = useState<StoredBiometricCredential[]>([]);
  const [isBiometricPending, setIsBiometricPending] = useState(false);

  useEffect(() => {
    setEnrolledList(getEnrolledBiometrics());
    void isPlatformBiometricSupported().then((supported) => {
      setBiometricSupported(supported);
    });
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = verifyOwnerLogin({
      usernameInput: username,
      pinInput: pin,
      settingsCredentials,
    });

    if (!result.ok) {
      setError('error' in result ? result.error : 'Authentication failed.');
      return;
    }

    onAuthenticated(result.session);
  };

  const handleBiometricSignIn = async (targetUsername?: string) => {
    setError(null);
    setIsBiometricPending(true);
    const res = await authenticateWithPlatformBiometric(targetUsername);
    setIsBiometricPending(false);

    if (!res.ok) {
      setError('error' in res ? res.error : 'Biometric verification failed.');
      return;
    }

    const effective = resolveEffectiveCredentials(settingsCredentials);
    const isOwner2 =
      res.username.trim().toLowerCase() ===
      effective.Owner2.username.trim().toLowerCase();

    onAuthenticated({
      role: 'Owner',
      accountLabel: isOwner2 ? 'Owner 2' : 'Owner 1',
      username: res.username,
      loginMethod: 'biometric',
      authenticatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="min-h-screen w-full max-w-md mx-auto bg-gray-50 shadow-xl flex flex-col overflow-x-hidden">
      {/* Emerald Green Hero Header */}
      <header className="bg-gradient-to-b from-[#489E44] to-[#3E8E41] text-white px-5 pt-10 pb-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-[#3E8E41] font-extrabold text-base shadow-sm">
              SR
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">
                SRKP Rental Tool
              </h1>
              <p className="text-xs text-emerald-50/90 mt-0.5">
                Property, Tenant &amp; Utility Suite
              </p>
            </div>
          </div>
          <span className="rounded-full bg-[#FACC15] px-2.5 py-1 text-[11px] font-bold text-[#0f172a]">
            Owner
          </span>
        </div>

        <div className="mt-6 rounded-2xl bg-white/15 backdrop-blur-xs px-4 py-3 flex items-start gap-2.5 text-xs text-white">
          <ShieldCheck className="w-4 h-4 text-[#FACC15] shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold">Authorized Owners Only.</span> Sign in with your
            Owner credentials or device biometrics.
          </div>
        </div>
      </header>

      {/* Curved White Lower Sheet */}
      <main className="flex-1 bg-white rounded-t-[28px] -mt-5 px-5 pt-7 pb-8 space-y-5">
        {lockNotice && (
          <div
            role="status"
            className="flex items-center justify-between gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-[#3E8E41]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{lockNotice}</span>
            </div>
            {onDismissNotice && (
              <button
                type="button"
                onClick={onDismissNotice}
                className="p-1 rounded-lg hover:bg-emerald-100 cursor-pointer shrink-0"
                aria-label="Dismiss notice"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        <div>
          <h2 className="text-base font-bold text-[#0f172a]">Welcome Back</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Sign in to manage houses, tenants, meters &amp; invoices
          </p>
        </div>

        {/* Biometric Quick Login Button(s) when enrolled on device */}
        {enrolledList.length > 0 && (
          <div className="space-y-2.5">
            {enrolledList.map((cred) => (
              <button
                key={cred.username}
                type="button"
                disabled={isBiometricPending}
                onClick={() => void handleBiometricSignIn(cred.username)}
                className="w-full inline-flex items-center justify-center gap-2.5 rounded-2xl bg-[#489E44] px-4 py-3.5 text-sm font-semibold text-white hover:bg-[#3E8E41] disabled:opacity-60 cursor-pointer min-h-[48px] transition-colors shadow-xs"
              >
                <Fingerprint className="w-5 h-5 shrink-0" />
                <span className="truncate">
                  {isBiometricPending
                    ? 'Verifying Biometrics...'
                    : enrolledList.length > 1
                      ? `Sign in with Biometrics (${cred.username})`
                      : 'Sign in with Biometrics (Face ID / Fingerprint)'}
                </span>
              </button>
            ))}
            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-gray-200" />
              <span className="shrink mx-3 text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                or use Owner credentials
              </span>
              <div className="flex-grow border-t border-gray-200" />
            </div>
          </div>
        )}

        {enrolledList.length === 0 && biometricSupported && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 flex items-center gap-2.5 text-[11px] text-gray-600">
            <Fingerprint className="w-4 h-4 text-[#489E44] shrink-0" />
            <span>
              Sign in with your Owner PIN once to enable 1-tap{' '}
              <strong className="text-[#0f172a]">Biometrics (Face ID / Fingerprint)</strong>.
            </span>
          </div>
        )}

        {/* Email / Username + PIN Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="login-username"
              className="block text-xs font-semibold text-gray-700 mb-1.5"
            >
              Owner Email or Username
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Enter authorized Owner email"
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-sm text-[#0f172a] placeholder:text-gray-400 focus:border-[#489E44] focus:bg-white focus:outline-none min-h-[46px]"
              required
            />
          </div>

          <div>
            <label
              htmlFor="login-pin"
              className="block text-xs font-semibold text-gray-700 mb-1.5"
            >
              PIN / Password
            </label>
            <div className="relative">
              <input
                id="login-pin"
                type={showPin ? 'text' : 'password'}
                autoComplete="current-password"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Enter PIN or password"
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-3.5 pr-11 py-2.5 text-sm font-mono text-[#0f172a] placeholder:font-sans placeholder:text-gray-400 focus:border-[#489E44] focus:bg-white focus:outline-none min-h-[46px]"
                required
              />
              <button
                type="button"
                onClick={() => setShowPin((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer"
                aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-800"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#489E44] px-4 py-3.5 text-sm font-semibold text-white hover:bg-[#3E8E41] cursor-pointer min-h-[48px] transition-colors shadow-xs"
          >
            <Lock className="w-4 h-4" />
            <span>Sign in as Owner</span>
          </button>
        </form>

        <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-[#489E44]" />
            <span>SRKP Rental Management</span>
          </span>
          <span className="font-mono">Dual-Owner Access</span>
        </div>
      </main>
    </div>
  );
};
