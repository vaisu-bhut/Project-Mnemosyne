"use client";

import { useEffect } from "react";

/** Registers the PWA service worker once on the client. Renders nothing.
 * Makes the app installable and lays the groundwork for background Push. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("[pwa] service worker registration failed:", err);
      });
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
