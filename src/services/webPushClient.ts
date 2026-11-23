import { getAuthFetchHeaders } from '../config/authConfig';

export interface WebPushEnableResult {
  ok: boolean;
  permission: NotificationPermission | 'unsupported';
  subscriptionCount?: number;
  message: string;
}

export interface WebPushTestResult {
  ok: boolean;
  sentCount?: number;
  removedCount?: number;
  message: string;
}

export interface WebPushStatusResult {
  ok: boolean;
  subscriptionCount: number;
  vapidConfigured: boolean;
}

export function isWebPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existingRegs = await navigator.serviceWorker.getRegistrations();
  const activeRootReg = existingRegs.find((reg) => {
    const scriptUrl =
      reg.active?.scriptURL ||
      reg.waiting?.scriptURL ||
      reg.installing?.scriptURL ||
      '';
    return scriptUrl.endsWith('/pwa-sw.js') || scriptUrl.endsWith('/sw.js');
  });

  if (activeRootReg) {
    return activeRootReg;
  }

  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    const target = regs.find((reg) => {
      const scriptUrl =
        reg.active?.scriptURL ||
        reg.waiting?.scriptURL ||
        reg.installing?.scriptURL ||
        '';
      return scriptUrl.endsWith('/pwa-sw.js') || scriptUrl.endsWith('/sw.js');
    });
    if (!target) return null;
    return await target.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function fetchPushSubscriptionStatus(
  authToken?: string
): Promise<WebPushStatusResult> {
  if (!authToken) {
    return { ok: false, subscriptionCount: 0, vapidConfigured: false };
  }
  try {
    const res = await fetch('/api/push/status', {
      headers: getAuthFetchHeaders(authToken),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<WebPushStatusResult>;
    if (!res.ok || !data.ok) {
      return { ok: false, subscriptionCount: 0, vapidConfigured: false };
    }
    return {
      ok: true,
      subscriptionCount: Number(data.subscriptionCount || 0),
      vapidConfigured: Boolean(data.vapidConfigured),
    };
  } catch {
    return { ok: false, subscriptionCount: 0, vapidConfigured: false };
  }
}

export async function enablePhonePushNotifications(
  authToken?: string
): Promise<WebPushEnableResult> {
  if (!isWebPushSupported()) {
    return {
      ok: false,
      permission: 'unsupported',
      message:
        'Web Push notifications require a modern browser (Chrome, Edge, or iOS 16.4+ Safari Home Screen app).',
    };
  }

  if (!authToken) {
    return {
      ok: false,
      permission: Notification.permission,
      message: 'Please sign in as an Admin to enable push notifications.',
    };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        ok: false,
        permission,
        message:
          permission === 'denied'
            ? 'Notification permission was denied in browser settings. Please allow notifications for this site.'
            : 'Notification permission prompt was dismissed.',
      };
    }

    const keyRes = await fetch('/api/push/vapid-public-key', {
      headers: getAuthFetchHeaders(authToken),
    });
    const keyData = (await keyRes.json().catch(() => ({}))) as {
      ok?: boolean;
      publicKey?: string;
      error?: string;
    };
    if (!keyRes.ok || !keyData.ok || !keyData.publicKey) {
      return {
        ok: false,
        permission,
        message: keyData.error || 'Could not retrieve server VAPID public key.',
      };
    }

    const registration = await registerPushServiceWorker();
    const applicationServerKey = urlBase64ToUint8Array(keyData.publicKey);

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as unknown as BufferSource,
      });
    }

    const subJson = subscription.toJSON();
    const subRes = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: getAuthFetchHeaders(authToken, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        subscription: subJson,
      }),
    });

    const subData = (await subRes.json().catch(() => ({}))) as {
      ok?: boolean;
      subscriptionCount?: number;
      error?: string;
      message?: string;
    };

    if (!subRes.ok || !subData.ok) {
      return {
        ok: false,
        permission,
        message: subData.error || 'Failed saving push subscription on server.',
      };
    }

    return {
      ok: true,
      permission,
      subscriptionCount: Number(subData.subscriptionCount || 1),
      message:
        subData.message ||
        'Phone Push Notifications enabled on this device!',
    };
  } catch (err) {
    return {
      ok: false,
      permission:
        typeof window !== 'undefined' && 'Notification' in window
          ? Notification.permission
          : 'unsupported',
      message:
        err instanceof Error
          ? err.message
          : 'Failed enabling Web Push notifications.',
    };
  }
}

export async function sendTestPhonePush(
  authToken?: string
): Promise<WebPushTestResult> {
  if (!authToken) {
    return {
      ok: false,
      message: 'Admin sign-in is required to send a test push notification.',
    };
  }
  try {
    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: getAuthFetchHeaders(authToken, {
        'Content-Type': 'application/json',
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      sentCount?: number;
      removedCount?: number;
      message?: string;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        message:
          data.error ||
          data.message ||
          'Failed to send test push notification.',
      };
    }
    return {
      ok: true,
      sentCount: data.sentCount ?? 0,
      removedCount: data.removedCount ?? 0,
      message:
        data.message ||
        `Test push delivered to ${data.sentCount ?? 0} subscribed device(s).`,
    };
  } catch {
    return {
      ok: false,
      message: 'Unable to reach push notification server.',
    };
  }
}
