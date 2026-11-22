import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Laptop,
  MessageSquare,
  QrCode,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const SHARED_MOBILE_APP_URL =
  'https://ais-pre-bxggii7rwagv3ulrp7ryb3-69900431065.us-east1.run.app';
export const DEV_PORTAL_URL =
  'https://ais-dev-bxggii7rwagv3ulrp7ryb3-69900431065.us-east1.run.app';

export const InstallAppModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [platformTab, setPlatformTab] = useState<'android' | 'ios' | 'laptop'>(
    isIOS ? 'ios' : 'android'
  );
  const currentOrigin =
    typeof window !== 'undefined' ? window.location.origin : SHARED_MOBILE_APP_URL;
  const isPublishedCloudRun =
    !currentOrigin.includes('ais-dev-') && !currentOrigin.includes('ais-pre-');
  const [urlTarget, setUrlTarget] = useState<'shared' | 'dev'>('shared');
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (!isOpen) return null;

  const isInIframe =
    typeof window !== 'undefined' && window.self !== window.top;

  const activeUrl =
    urlTarget === 'shared'
      ? isPublishedCloudRun
        ? currentOrigin
        : SHARED_MOBILE_APP_URL
      : DEV_PORTAL_URL;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(activeUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const waShareHref = `https://wa.me/?text=${encodeURIComponent(
    `SRKP Rental Management App — Open in Chrome/Safari:\n${activeUrl}`
  )}`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0f172a]/60 backdrop-blur-xs p-2 sm:p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-modal-title"
    >
      <div className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white p-4 sm:p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-[#2563eb]">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="install-modal-title"
                className="text-lg font-bold text-[#0f172a]"
              >
                Install Mobile App & Laptop Web Portal
              </h2>
              <p className="text-xs text-slate-500">
                Install SRKP Rental Tool on Android, iPhone, or Laptop Desktop (PWA)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
            aria-label="Close install options"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Helpful guidance when Chrome reports "Could not install" */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-950 space-y-1.5">
          <div className="font-bold">
            If Android Chrome says &ldquo;Could not install&rdquo;:
          </div>
          <ul className="list-disc list-inside space-y-1 text-amber-900">
            {isInIframe && (
              <li>
                You are viewing the app inside the AI Studio preview frame.{' '}
                <a
                  href={activeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold underline text-[#2563eb]"
                >
                  Open in a standalone Chrome tab first
                </a>
                .
              </li>
            )}
            <li>
              AI Studio preview URLs (<span className="font-mono">ais-pre-...</span> /{' '}
              <span className="font-mono">ais-dev-...</span>) redirect icon requests through a Google cookie check (<span className="font-mono">302</span>), which blocks Android&apos;s WebAPK installer.
            </li>
            <li>
              <strong>Best fix:</strong> Use your <strong>Published Cloud Run URL</strong> (from AI Studio <strong>Publish / Deploy</strong>, with unauthenticated access allowed—your Owner Login Gate still protects the app) to install cleanly as a native PWA.
            </li>
            <li>
              <strong>Quick workaround on <span className="font-mono">ais-pre-...</span>:</strong> In Chrome tap{' '}
              <strong>⋮ → Add to Home screen → Create shortcut</strong> (instead of <em>Install</em>).
            </li>
          </ul>
        </div>

        {/* One-click native prompt if browser fired beforeinstallprompt */}
        {isInstallable && !isInstalled && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-[#0f172a]">
                Ready for 1-Tap Install on this Device
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                Your browser supports direct PWA installation with offline caching.
              </div>
            </div>
            <button
              type="button"
              onClick={install}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>Install App Now</span>
            </button>
          </div>
        )}

        {/* QR Code + Share Link Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center rounded-xl border border-[#e2e8f0] bg-[#f8f9ff] p-4">
          <div className="md:col-span-5 flex flex-col items-center justify-center space-y-2.5">
            <div className="rounded-xl bg-white p-3 border border-[#e2e8f0]">
              <QRCodeSVG
                value={activeUrl}
                size={148}
                bgColor="#ffffff"
                fgColor="#0f172a"
              />
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600">
              <QrCode className="w-3.5 h-3.5 text-[#2563eb]" />
              <span>Scan with Phone Camera</span>
            </span>
          </div>

          <div className="md:col-span-7 space-y-3">
            <div>
              <div className="text-xs font-bold text-[#0f172a]">
                Portal & Mobile URL
              </div>
              <div className="mt-1.5 flex flex-wrap rounded-lg bg-slate-200/70 p-0.5 text-[11px] font-semibold gap-0.5">
                <button
                  type="button"
                  onClick={() => setUrlTarget('shared')}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${
                    urlTarget === 'shared'
                      ? 'bg-white text-[#0f172a] shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Shared Mobile URL
                </button>
                <button
                  type="button"
                  onClick={() => setUrlTarget('dev')}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${
                    urlTarget === 'dev'
                      ? 'bg-white text-[#0f172a] shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Owner Dev Portal
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-[11px] font-mono text-slate-700 break-all">
              {activeUrl}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopyUrl}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] hover:bg-slate-50 cursor-pointer"
              >
                {copiedUrl ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#10b981]" />
                    <span>Link Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy App Link</span>
                  </>
                )}
              </button>

              <a
                href={waShareHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#10b981] px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Send Link on WhatsApp</span>
              </a>
            </div>
          </div>
        </div>

        {/* Platform Installation Steps */}
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 border border-[#e2e8f0]">
            <button
              type="button"
              onClick={() => setPlatformTab('android')}
              className={`inline-flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold cursor-pointer ${
                platformTab === 'android'
                  ? 'bg-white text-[#0f172a] shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 text-[#10b981]" />
              <span>Android Phone</span>
            </button>
            <button
              type="button"
              onClick={() => setPlatformTab('ios')}
              className={`inline-flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold cursor-pointer ${
                platformTab === 'ios'
                  ? 'bg-white text-[#0f172a] shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 text-[#2563eb]" />
              <span>iPhone / iPad</span>
            </button>
            <button
              type="button"
              onClick={() => setPlatformTab('laptop')}
              className={`inline-flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold cursor-pointer ${
                platformTab === 'laptop'
                  ? 'bg-white text-[#0f172a] shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              <Laptop className="w-3.5 h-3.5 text-[#0f172a]" />
              <span>Laptop Web Portal</span>
            </button>
          </div>

          {platformTab === 'android' && (
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 space-y-2 text-xs text-slate-700">
              <div className="font-bold text-[#0f172a]">
                Install on Android (Chrome / Edge / Samsung Internet)
              </div>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>
                  Scan the QR code above or open the <strong>Shared Mobile URL</strong> directly in{' '}
                  <strong>Google Chrome</strong> (not inside an in-app browser).
                </li>
                <li>
                  Tap <strong>Install App</strong> in the top header, or tap the Chrome{' '}
                  <strong>⋮ menu → Add to Home screen → Install</strong>.
                </li>
                <li>
                  The <strong>SRKP Rental Tool</strong> icon appears on your home screen and runs full-screen with offline support.
                </li>
              </ol>
            </div>
          )}

          {platformTab === 'ios' && (
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 space-y-2 text-xs text-slate-700">
              <div className="font-bold text-[#0f172a]">
                Install on iPhone / iPad (iOS Safari)
              </div>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>
                  Open the <strong>Shared Mobile URL</strong> in <strong>Apple Safari</strong>.
                </li>
                <li>
                  Tap the <strong>Share</strong> icon in the Safari toolbar.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>, then tap{' '}
                  <strong>Add</strong>.
                </li>
              </ol>
            </div>
          )}

          {platformTab === 'laptop' && (
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 space-y-2 text-xs text-slate-700">
              <div className="font-bold text-[#0f172a]">
                Use or Install Laptop Web Portal (Windows / Mac / Linux)
              </div>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>
                  Bookmark or open the Portal URL in Chrome or Edge on your laptop for the wide{' '}
                  <strong>Laptop Ledger Table</strong>, keyboard-friendly forms, and 1-click CSV export.
                </li>
                <li>
                  To pin it as a standalone desktop app: click the{' '}
                  <strong>Install (monitor + arrow)</strong> icon in Chrome/Edge&apos;s address bar, or open Chrome{' '}
                  <strong>⋮ → Cast, save, and share → Install SRKP Rental Tool</strong>.
                </li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const PWAInstallButton: React.FC<{
  compact?: boolean;
  onOpenModal?: () => void;
}> = ({ compact = false, onOpenModal }) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [internalOpen, setInternalOpen] = useState(false);

  const openInstallHub = () => {
    if (onOpenModal) onOpenModal();
    else setInternalOpen(true);
  };

  if (isInstalled) {
    return (
      <>
        <button
          type="button"
          onClick={openInstallHub}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer min-h-[36px]"
          title="Share Mobile App QR & Portal Links"
        >
          <QrCode className="w-3.5 h-3.5 text-[#2563eb]" />
          <span className="hidden sm:inline">Share App</span>
        </button>
        {!onOpenModal && (
          <InstallAppModal
            isOpen={internalOpen}
            onClose={() => setInternalOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        {isInstallable && (
          <button
            type="button"
            onClick={install}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2563eb] text-white font-semibold hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              compact
                ? 'px-3 py-1.5 text-xs min-h-[36px]'
                : 'px-4 py-2 text-sm min-h-[40px]'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install App</span>
          </button>
        )}

        <button
          type="button"
          onClick={openInstallHub}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white text-[#0f172a] font-semibold hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            compact
              ? 'px-2 sm:px-2.5 py-1.5 text-xs min-h-[34px] sm:min-h-[36px]'
              : 'px-3.5 py-2 text-sm min-h-[40px]'
          }`}
          title="Mobile Install Options, QR Code & Laptop Portal"
        >
          <Smartphone className="w-3.5 h-3.5 text-[#2563eb] shrink-0" />
          <span className={isInstallable ? 'hidden xl:inline' : 'hidden sm:inline'}>
            {isInstallable ? 'Mobile QR' : 'Install Mobile App'}
          </span>
        </button>
      </div>

      {!onOpenModal && (
        <InstallAppModal
          isOpen={internalOpen}
          onClose={() => setInternalOpen(false)}
        />
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 shadow-md print:hidden whitespace-nowrap">
      <WifiOff className="w-3.5 h-3.5 text-[#f59e0b]" />
      <span>Offline Mode — Changes saved locally</span>
    </div>
  );
};
