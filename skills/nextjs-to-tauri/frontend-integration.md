# Frontend integration templates

Put every file below in **one `src/app/desktop/` folder**, not spread across `utils/` and
`hooks/`. Desktop-only code mixed into shared directories is easy to lose: in the reference
app a repo-sync script that mirrors `src/app/{hooks,utils,…}` in overwrite mode deleted
`useAutoUpdate.ts` and `useLanguagePreference.ts` outright, because they existed in the target
and not the source. One folder nothing else claims also keeps the whole desktop layer greppable
and deletable in one move.

Add only the pieces you need. JS deps:

```bash
yarn add @tauri-apps/plugin-opener@^2 @tauri-apps/plugin-updater@^2
```

The plugins pull in `@tauri-apps/api` transitively, so you don't need it as a direct dep — **unless you add your own `#[tauri::command]`s**, whose `invoke` comes from there. Then add it, and reach for it with a dynamic `await import("@tauri-apps/api/core")` at the call site: a static import loads fine in a plain browser (it only throws when `invoke` runs) and quietly ships the whole package in the web bundle.

All of this **no-ops outside a Tauri webview**, so it's safe to ship in the same bundle to the web. Rename the storage keys (`<app>_*`) per project.

---

## `desktop/externalLink.ts` — Tauri detection + system-browser links

A plain `.ts` (no JSX). `isTauriRuntime` is **synchronous** so click handlers can branch without awaiting (gotcha #4). Opening uses `@tauri-apps/plugin-opener` — the dedicated Tauri 2 plugin for opening URLs (the shell plugin is for spawning processes).

```ts
declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

// Detect via runtime globals/UA only — NEVER by importing @tauri-apps/api (it loads
// fine in a browser; invoke only throws at call time). Sync so click handlers can use it.
export const isTauriRuntime = (): boolean => {
  if (typeof window === "undefined") return false;
  if (window.__TAURI_INTERNALS__) return true; // v2
  if (window.__TAURI__) return true; // v1
  if (typeof navigator !== "undefined" && navigator.userAgent.includes("Tauri")) return true;
  return false;
};

export const isTauri = async (): Promise<boolean> => isTauriRuntime();

export const openExternalLink = async (url: string) => {
  if (isTauriRuntime()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch (e) {
      console.error("opener failed:", e);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
};
```

> Don't bother writing an `<ExternalLink>` wrapper component — you'd have to find and convert every link. The global click delegate below catches them all (gotcha #10).

---

## `desktop/updater.ts` — check + download (defer install)

> **What this does on the user's machine:** the app contacts the update endpoint from
> `tauri.conf.json` (`plugins.updater.endpoints`) on startup (after `startupDelay`, 3 s by
> default) and then once every `checkInterval` (24 h by default). When a newer release
> exists it **downloads the update before the user answers** — the dialog asks only
> whether to *install* an update that was already downloaded. Drop the hook (and the
> `updater` plugin block) and the app makes no such request at all.

```ts
"use client";
import { isTauri } from "./externalLink";

export interface UpdateCheckResult {
  hasUpdate: boolean;
  version?: string;
  downloaded?: boolean;
  install?: () => Promise<void>;
  error?: string;
}

export const checkForUpdates = async (skippedVersion = ""): Promise<UpdateCheckResult> => {
  if (!(await isTauri())) return { hasUpdate: false, error: "Not in Tauri" };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { hasUpdate: false };
    if (update.version === skippedVersion) {
      await update.close();
      return { hasUpdate: false };
    }
    await update.download(); // auto-download, install on confirm
    return { hasUpdate: true, version: update.version, downloaded: true, install: () => update.install() };
  } catch (error) {
    return { hasUpdate: false, error: String(error) };
  }
};
```

---

## `desktop/useAutoUpdate.ts` — startup + interval check, confirm-to-install, skip-version

```ts
"use client";
import { useEffect, useRef, useCallback } from "react";
import { App } from "antd"; // swap for your UI lib's dialog/toast
import { checkForUpdates, UpdateCheckResult } from "./updater";
import { isTauri } from "./externalLink";

const SKIPPED_KEY = "<app>_skipped_version";

export const useAutoUpdate = ({ startupDelay = 3000, checkInterval = 24 * 60 * 60 * 1000 } = {}) => {
  // App.useApp(), not the static `Modal`/`message` imports: antd v5's static methods sit
  // outside React context, so they miss the app's theme and locale (and antd warns about it).
  const { modal, message } = App.useApp();
  const checkedStartup = useRef(false);
  const lastCheck = useRef(0);

  const confirm = useCallback((r: UpdateCheckResult) => {
    modal.confirm({
      title: "Update Available",
      content: `Version ${r.version} downloaded. Install now and restart?`,
      okText: "Install Now",
      cancelText: "Skip This Version",
      // install() relaunches the app, so a resolved promise normally never returns. Catch it
      // anyway: on the portable exe (gotcha #8) and other install-layout failures it REJECTS,
      // and an uncaught rejection here leaves the user staring at a dialog that did nothing.
      onOk: async () => {
        message.loading({ content: "Installing update…", key: "installing", duration: 0 });
        try {
          await r.install?.();
        } catch (e) {
          console.error("Install failed:", e);
          message.destroy("installing");
          message.error("Installation failed. Please download the latest version manually.");
        }
      },
      onCancel: () => { try { localStorage.setItem(SKIPPED_KEY, r.version!); } catch {} },
    });
  }, [modal, message]);

  const run = useCallback(async () => {
    if (!(await isTauri())) return;
    const now = Date.now();
    if (now - lastCheck.current < 60 * 60 * 1000) return; // throttle 1h
    lastCheck.current = now;
    let skipped = ""; try { skipped = localStorage.getItem(SKIPPED_KEY) || ""; } catch {}
    const r = await checkForUpdates(skipped);
    if (r.hasUpdate && r.downloaded && r.version) {
      confirm(r);
    }
  }, [confirm]);

  useEffect(() => {
    if (checkedStartup.current) return;
    const t = setTimeout(() => { checkedStartup.current = true; run(); }, startupDelay);
    return () => clearTimeout(t);
  }, [run, startupDelay]);

  useEffect(() => {
    const id = setInterval(run, checkInterval);
    return () => clearInterval(id);
  }, [run, checkInterval]);
};
```

---

## next-intl i18n — switching, and (optionally) remembering the language

**Switch locales with plain soft navigation (`router.push`).** It's client-side RSC
routing that never touches the webview's asset protocol, so it just works in Tauri —
exactly as on the web. **Do NOT hard-navigate** (`window.location`) for a switch: a hard
reload remounts the `[locale]` layout subtree, which resets `useRef` guards and re-fires
any startup redirect — the bounce that makes switching look broken (gotcha #11).

**The language is the user's to choose.** The app opens in the **configured default
locale** — `DEFAULT_LOCALE` below, and the window's entry `url` in `tauri.conf.json` must
point at the same locale. It never guesses the language from the OS and never stores a
detected locale: the only locale it remembers is the one the user **explicitly picked**
in the switcher, and the user can change that at any time. If you want to *offer* the
system language, call `detectSystemLocale(valid)` from a UI that asks first ("Start in
your system language?") and apply it only when the user accepts.

Remembering the language across launches is **optional**. If you add it, two rules keep
the launch-time redirect from fighting the switcher:

1. The "redirect once per session" guard must be a **MODULE-LEVEL variable, not a
   `useRef`** — a locale switch remounts the hook's host, resetting a ref and re-running
   the redirect every switch.
2. Persist the preference in the **switcher** (explicit user action), NOT in a navigation
   effect — an effect races the startup redirect and can save the entry locale over the
   saved one.

`desktop/useLanguagePreference.ts` (self-contained; Tauri-only so the web build is untouched):

```ts
"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isTauriRuntime } from "./externalLink";

const KEY = "<app>_preferred_language";

// The locale the app starts in when the user has not chosen one. This is a configuration
// value, not a guess: set it to your app's default ("en", "zh", …) and keep it in sync
// with the window's entry URL in tauri.conf.json (app.windows[].url).
export const DEFAULT_LOCALE = "en";

// The locale the USER picked in the language switcher. Nothing else writes this key.
export const setPreferredLanguage = (l: string) => { try { localStorage.setItem(KEY, l); } catch {} };
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const localeOf = (p: string) => p.match(/^\/([a-z]{2}(-[a-z]+)?)/i)?.[1] ?? null;

// Optional: detect the OS language to OFFER it. It is never applied or stored on its
// own — call it from a UI that asks ("Start in your system language?"), and it returns
// null for any locale you do not ship.
export const detectSystemLocale = (valid: string[]): string | null => {
  const s = (typeof navigator !== "undefined" && navigator.language) || "";
  const guess = s.startsWith("zh") ? (/TW|HK|Hant/i.test(s) ? "zh-hant" : "zh") : s.split("-")[0];
  return valid.includes(guess) ? guess : null;
};

// MODULE-level, not a ref: survives the [locale] layout remount a switch triggers, so
// the redirect runs exactly once per app launch and never bounces a switch (gotcha #11).
let sessionRedirectDone = false;

export function useLanguagePreference(valid: string[]) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (sessionRedirectDone || !isTauriRuntime()) return;
    const cur = localeOf(pathname);
    if (!cur) return;
    sessionRedirectDone = true;
    // Only an EXPLICIT choice is honoured. With no stored choice the app falls back to
    // the configured DEFAULT_LOCALE — which is the window's entry URL, so it stays where
    // it opened. The OS language is never guessed here, and nothing is written to
    // storage on this path.
    const pref = read() ?? DEFAULT_LOCALE;
    if (valid.includes(pref) && pref !== cur) {
      router.replace(pathname.replace(/^\/[a-z]{2}(-[a-z]+)?/i, `/${pref}`)); // SOFT redirect, once
    }
  }, [pathname, router, valid]);
}
```

**Language switcher** — plain soft nav, and save the choice here (not in an effect):

```ts
import { setPreferredLanguage } from "@/app/desktop/useLanguagePreference";
import { isTauriRuntime } from "@/app/desktop/externalLink";

const onPick = (locale: string) => {
  if (isTauriRuntime()) setPreferredLanguage(locale);      // remember the explicit choice — the user's, and changeable at any time
  const next = pathname.replace(/^\/[a-z]{2}(-[a-z]+)?/, `/${locale}`);
  router.push(`${next}${window.location.search}${window.location.hash}`); // SOFT nav — works in Tauri
};
```

> Skip the whole hook if you don't need cross-launch memory — plain `router.push` in the
> switcher is all switching itself requires.

---

## Mount point — one client component inside your providers

Render inside `NextIntlClientProvider` (for `useLocale`/router) and your UI lib's context provider (antd `<App>` for `message`/`Modal`). A server-component layout can render this client child directly. This also installs the **global external-link interceptor** (gotcha #10): one capture-phase delegate sends every external link to the system browser — no per-link wrapping.

```tsx
"use client";
import { useEffect } from "react";
import { useAutoUpdate } from "./useAutoUpdate";
import { useLanguagePreference } from "./useLanguagePreference";
import { isTauriRuntime, openExternalLink } from "./externalLink";
import { routing } from "@/i18n/routing"; // next-intl only — no next-intl? delete this import…

export default function TauriIntegration() {
  useAutoUpdate();
  useLanguagePreference([...routing.locales]); // …and this line; the app opens in DEFAULT_LOCALE (or the locale the user picked) — language persistence is a next-intl feature

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const href = (e.target as Element | null)?.closest?.("a")?.getAttribute("href");
      if (!href) return;
      let url: URL;
      try { url = new URL(href, window.location.href); } catch { return; }
      const external = (url.protocol === "http:" || url.protocol === "https:") && url.origin !== window.location.origin;
      if (!external && url.protocol !== "mailto:" && url.protocol !== "tel:") return; // internal → let the router handle it
      e.preventDefault();
      e.stopPropagation();
      openExternalLink(url.href);
    };
    document.addEventListener("click", onClick, true); // capture phase
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
```
