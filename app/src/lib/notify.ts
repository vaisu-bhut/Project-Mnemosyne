"use client";

/**
 * Browser-notification helpers for the Phase-2 "it pings you" delivery channel.
 * These fire from an open tab via the Notifications API (no server Push yet —
 * the service worker has a `push` handler ready for that upgrade later).
 */

export type NotifyPermission = "default" | "granted" | "denied" | "unsupported";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notifyPermission(): NotifyPermission {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission as NotifyPermission;
}

/** Ask for permission once. Safe to call repeatedly — resolves immediately if
 * already decided. Returns the resulting permission. */
export async function ensureNotifyPermission(): Promise<NotifyPermission> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission as NotifyPermission;
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return Notification.permission as NotifyPermission;
  }
}

export interface NotifyOptions {
  body?: string;
  /** Dedup key — a later notification with the same tag replaces the earlier. */
  tag?: string;
  /** Where to go when clicked (focuses an existing tab if one is open). */
  url?: string;
}

/** Show a notification if permission is granted. No-ops otherwise. Prefers the
 * service-worker registration (persists, supports actions) and falls back to a
 * plain Notification for an open tab. */
export async function notify(title: string, opts: NotifyOptions = {}): Promise<void> {
  if (notifyPermission() !== "granted") return;
  const { body, tag, url = "/" } = opts;

  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body,
        tag,
        icon: "/icon.svg",
        badge: "/icon.svg",
        data: { url },
      });
      return;
    } catch {
      // fall through to the plain Notification path
    }
  }

  try {
    const n = new Notification(title, { body, tag, icon: "/icon.svg" });
    n.onclick = () => {
      window.focus();
      if (url) window.location.assign(url);
      n.close();
    };
  } catch {
    // ignore — environment without a usable Notification constructor
  }
}
