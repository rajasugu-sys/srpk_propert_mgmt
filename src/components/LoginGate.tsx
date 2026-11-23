import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Lock,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import {
  loginWithCredentials,
  resetPasswordWithIdentifier,
  resolveBiometricLogin,
  signUpAccount,
} from '../config/authConfig';
import {
  authenticateWithPlatformBiometric,
  hasAnyBiometricEnrolled,
  isPlatformBiometricSupported,
} from '../services/biometricAuth';
import type { AccessType, AuthSession } from '../types/estate';

type AuthScreenMode = 'login' | 'signup' | 'reset';

interface LoginGateProps {
  lockNotice?: string | null;
  onDismissNotice?: () => void;
  onAuthenticated: (session: AuthSession) => void;
}

export const LoginGate: React.FC<LoginGateProps> = ({
  lockNotice,
  onDismissNotice,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<AuthScreenMode>('login');

  // Sign In State
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Sign Up State (Admin & Viewer only)
  const [signupUserId, setSignupUserId] = useState('');
  const [signupFullName, setSignupFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupMobile, setSignupMobile] = useState('');
  const [signupAccessType, setSignupAccessType] = useState<AccessType>('viewer');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupMasterPin, setSignupMasterPin] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  // Reset Password State
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');

  // Shared UI Feedback
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [isBiometricPending, setIsBiometricPending] = useState(false);

  useEffect(() => {
    setBiometricEnrolled(hasAnyBiometricEnrolled());
    void isPlatformBiometricSupported().then((supported) => {
      setBiometricSupported(supported);
    });
  }, []);

  const switchMode = (nextMode: AuthScreenMode) => {
    setMode(nextMode);
    setError(null);
    setSuccessMsg(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    const res = await loginWithCredentials(identifier, password);
    setIsSubmitting(false);

    if (!res.ok) {
      setError('error' in res ? res.error : 'Authentication failed.');
      return;
    }

    onAuthenticated(res.session);
  };

  const handleBiometricSignIn = async () => {
    setError(null);
    setSuccessMsg(null);
    if (!biometricEnrolled) {
      setError(
        'No biometric passkey is enrolled on this device yet. Sign in with your password first and enable Biometrics in Profile.'
      );
      return;
    }

    setIsBiometricPending(true);
    const webauthnRes = await authenticateWithPlatformBiometric();
    if (!webauthnRes.ok) {
      setIsBiometricPending(false);
      setError(
        'error' in webauthnRes ? webauthnRes.error : 'Biometric verification failed.'
      );
      return;
    }

    const sessionRes = await resolveBiometricLogin(webauthnRes.username);
    setIsBiometricPending(false);

    if (!sessionRes.ok) {
      setError(
        'error' in sessionRes ? sessionRes.error : 'Biometric sign-in rejected.'
      );
      return;
    }

    onAuthenticated(sessionRes.session);
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (signupAccessType === 'admin' && signupMasterPin.trim().length !== 12) {
      setError('Enter the valid 12-character alphanumeric Master Admin PIN.');
      return;
    }

    setIsSubmitting(true);
    const res = await signUpAccount({
      userId: signupUserId,
      fullName: signupFullName,
      email: signupEmail,
      mobileNumber: signupMobile,
      accessType: signupAccessType,
      password: signupPassword,
      masterAdminPin: signupAccessType === 'admin' ? signupMasterPin : undefined,
    });
    setIsSubmitting(false);

    if (!res.ok) {
      setError('error' in res ? res.error : 'Could not complete registration.');
      return;
    }

    onAuthenticated(res.session);
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (resetNewPassword.trim().length < 4) {
      setError('New password must be at least 4 characters.');
      return;
    }
    if (resetNewPassword.trim() !== resetConfirmPassword.trim()) {
      setError('New password and confirmation do not match.');
      return;
    }

    setIsSubmitting(true);
    const res = await resetPasswordWithIdentifier({
      identifier: resetIdentifier,
      newPassword: resetNewPassword,
    });
    setIsSubmitting(false);

    if (!res.ok) {
      setError('error' in res ? res.error : 'Password reset failed.');
      return;
    }

    setSuccessMsg(res.message);
    setIdentifier(resetIdentifier.trim());
    setPassword('');
    setResetNewPassword('');
    setResetConfirmPassword('');
    setMode('login');
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
                Property, Tenant &amp; Utility Portal
              </p>
            </div>
          </div>
          <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold text-white">
            Secure Sign In
          </span>
        </div>

        <div className="mt-6 rounded-2xl bg-white/15 backdrop-blur-xs px-4 py-3 flex items-start gap-2.5 text-xs text-white">
          <ShieldCheck className="w-4 h-4 text-[#FACC15] shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            {mode === 'login' && (
              <>
                Sign in with your <span className="font-bold">User ID, Mobile Number, or Email</span> to access your account.
              </>
            )}
            {mode === 'signup' && (
              <>
                Create an <span className="font-bold">Admin</span> or <span className="font-bold">Viewer</span> account to manage properties, meters, and invoices.
              </>
            )}
            {mode === 'reset' && (
              <>
                Reset your account password using your registered <span className="font-bold">User ID or Mobile Number</span>.
              </>
            )}
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

        {successMsg && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-[#3E8E41]"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{successMsg}</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-800"
          >
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {/* MODE 1: UNIFIED LOGIN */}
        {mode === 'login' && (
          <>
            <div>
              <h2 className="text-base font-bold text-[#0f172a]">Welcome Back</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Enter your credentials to continue
              </p>
            </div>

            <form onSubmit={(e) => void handleLoginSubmit(e)} className="space-y-4">
              <div>
                <label
                  htmlFor="login-identifier"
                  className="block text-xs font-semibold text-gray-700 mb-1.5"
                >
                  User ID / Mobile Number / Email
                </label>
                <input
                  id="login-identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Enter User ID, 10-digit mobile, or email"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-sm text-[#0f172a] placeholder:text-gray-400 focus:border-[#489E44] focus:bg-white focus:outline-none min-h-[46px]"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-semibold text-gray-700 mb-1.5"
                >
                  Password / PIN
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Enter password or PIN"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-3.5 pr-11 py-2.5 text-sm font-mono text-[#0f172a] placeholder:font-sans placeholder:text-gray-400 focus:border-[#489E44] focus:bg-white focus:outline-none min-h-[46px]"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#489E44] px-4 py-3.5 text-sm font-semibold text-white hover:bg-[#3E8E41] disabled:opacity-60 cursor-pointer min-h-[48px] transition-colors shadow-xs"
              >
                <Lock className="w-4 h-4" />
                <span>{isSubmitting ? 'Signing In...' : 'Sign In'}</span>
              </button>
            </form>

            {(biometricEnrolled || biometricSupported) && (
              <div className="space-y-3">
                <div className="relative flex items-center">
                  <div className="flex-grow border-t border-gray-200" />
                  <span className="shrink mx-3 text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                    or
                  </span>
                  <div className="flex-grow border-t border-gray-200" />
                </div>

                <button
                  type="button"
                  disabled={isBiometricPending}
                  onClick={() => void handleBiometricSignIn()}
                  className="w-full inline-flex items-center justify-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm font-semibold text-[#3E8E41] hover:bg-emerald-100 disabled:opacity-60 cursor-pointer min-h-[48px] transition-colors"
                >
                  <Fingerprint className="w-5 h-5 shrink-0" />
                  <span>
                    {isBiometricPending
                      ? 'Verifying Biometrics...'
                      : 'Sign in with Face ID / Fingerprint'}
                  </span>
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 text-xs font-semibold">
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="inline-flex items-center gap-1.5 text-[#3E8E41] hover:underline py-2 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Sign Up</span>
              </button>
              <button
                type="button"
                onClick={() => switchMode('reset')}
                className="inline-flex items-center gap-1.5 text-gray-600 hover:text-[#0f172a] hover:underline py-2 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Reset Password</span>
              </button>
            </div>
          </>
        )}

        {/* MODE 2: SIGN UP (ADMIN & VIEWER ONLY) */}
        {mode === 'signup' && (
          <>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer"
                aria-label="Back to sign in"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-base font-bold text-[#0f172a]">Create Account</h2>
                <p className="text-xs text-gray-500">
                  Register as Admin or Viewer
                </p>
              </div>
            </div>

            <form onSubmit={(e) => void handleSignupSubmit(e)} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    User ID
                  </label>
                  <input
                    type="text"
                    value={signupUserId}
                    onChange={(e) => setSignupUserId(e.target.value)}
                    placeholder="e.g., karthik01"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#489E44] focus:bg-white focus:outline-none min-h-[44px]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={signupFullName}
                    onChange={(e) => setSignupFullName(e.target.value)}
                    placeholder="Your name"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#489E44] focus:bg-white focus:outline-none min-h-[44px]"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-sm text-[#0f172a] focus:border-[#489E44] focus:bg-white focus:outline-none min-h-[44px]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Mobile Number
                </label>
                <input
                  type="tel"
                  value={signupMobile}
                  onChange={(e) => setSignupMobile(e.target.value)}
                  placeholder="10-digit mobile number"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-sm text-[#0f172a] focus:border-[#489E44] focus:bg-white focus:outline-none min-h-[44px]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Access Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSignupAccessType('viewer')}
                    className={`rounded-xl px-3 py-2.5 text-xs font-bold border transition-colors cursor-pointer min-h-[44px] ${
                      signupAccessType === 'viewer'
                        ? 'border-[#489E44] bg-emerald-50 text-[#3E8E41]'
                        : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    Viewer (Read-Only)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSignupAccessType('admin')}
                    className={`rounded-xl px-3 py-2.5 text-xs font-bold border transition-colors cursor-pointer min-h-[44px] ${
                      signupAccessType === 'admin'
                        ? 'border-[#489E44] bg-emerald-50 text-[#3E8E41]'
                        : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    Admin (Full Control)
                  </button>
                </div>
              </div>

              {signupAccessType === 'admin' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-1.5">
                  <label className="block text-xs font-bold text-amber-900">
                    12-Char Master Admin PIN (Required for Admin)
                  </label>
                  <input
                    type="text"
                    maxLength={12}
                    value={signupMasterPin}
                    onChange={(e) =>
                      setSignupMasterPin(
                        e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
                      )
                    }
                    placeholder="Enter 12-char alphanumeric PIN"
                    className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-mono uppercase tracking-wider text-[#0f172a] focus:border-[#489E44] focus:outline-none min-h-[44px]"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Password / PIN
                </label>
                <div className="relative">
                  <input
                    type={showSignupPassword ? 'text' : 'password'}
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="Minimum 4 characters"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-3.5 pr-11 py-2.5 text-sm font-mono text-[#0f172a] focus:border-[#489E44] focus:bg-white focus:outline-none min-h-[44px]"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignupPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer"
                  >
                    {showSignupPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#489E44] px-4 py-3.5 text-sm font-semibold text-white hover:bg-[#3E8E41] disabled:opacity-60 cursor-pointer min-h-[48px]"
              >
                <UserPlus className="w-4 h-4" />
                <span>{isSubmitting ? 'Creating Account...' : 'Create Account'}</span>
              </button>
            </form>
          </>
        )}

        {/* MODE 3: RESET PASSWORD */}
        {mode === 'reset' && (
          <>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer"
                aria-label="Back to sign in"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-base font-bold text-[#0f172a]">Reset Password</h2>
                <p className="text-xs text-gray-500">
                  Update password using your User ID or Mobile Number
                </p>
              </div>
            </div>

            <form onSubmit={(e) => void handleResetSubmit(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Registered User ID or Mobile Number
                </label>
                <input
                  type="text"
                  value={resetIdentifier}
                  onChange={(e) => setResetIdentifier(e.target.value)}
                  placeholder="Enter your User ID or 10-digit mobile"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-sm text-[#0f172a] focus:border-[#489E44] focus:bg-white focus:outline-none min-h-[46px]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  New Password / PIN
                </label>
                <input
                  type="password"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  placeholder="Minimum 4 characters"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-sm font-mono text-[#0f172a] focus:border-[#489E44] focus:bg-white focus:outline-none min-h-[46px]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Confirm New Password / PIN
                </label>
                <input
                  type="password"
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-sm font-mono text-[#0f172a] focus:border-[#489E44] focus:bg-white focus:outline-none min-h-[46px]"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#489E44] px-4 py-3.5 text-sm font-semibold text-white hover:bg-[#3E8E41] disabled:opacity-60 cursor-pointer min-h-[48px]"
              >
                <KeyRound className="w-4 h-4" />
                <span>{isSubmitting ? 'Updating...' : 'Reset Password'}</span>
              </button>
            </form>
          </>
        )}

        <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-[#489E44]" />
            <span>SRKP Rental Management</span>
          </span>
          <span className="font-mono">SRKP Rental Tool</span>
        </div>
      </main>
    </div>
  );
};
