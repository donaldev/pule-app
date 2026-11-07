# Pule production Netlify/PWA readiness — 7 November 2026

Local preparation only. No deployment, hosted Auth configuration, migration or real sporting-data write is included.

## First deployment

1. Choose the permanent Netlify site name (or custom domain) before configuring Auth. Keep HTTPS enabled. This checkout is not linked to a Netlify site; no site URL is assumed here.
2. In Netlify's production **build environment**, set:
   - `VITE_SUPABASE_URL=https://pgljdmevusgvvlplaedt.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY=<the project's public publishable key, or its legacy anon key>`
   The application does not read `VITE_SUPABASE_ANON_KEY`. Never supply a service-role/secret key or commit an `.env` file. These two browser values are public and embedded at build time.
3. Deploy this project using a Git-connected Netlify build, or build locally with the intended public configuration and upload the complete `dist` directory. Existing `netlify.toml` specifies `npm run build`, `dist`, and Node 22. Use `npm ci` for reproducible installation. A local production-target check is `NETLIFY=true npm run build`.
4. Configure Auth as below, then perform the phone smoke checks before retiring the ngrok origin. Deployment and hosted settings require separate approval.

The Netlify build rejects missing keys, server keys and a Supabase project other than the specified production target. A normal local build also supports localhost Supabase. Netlify's SPA fallback serves `index.html`; existing canonical routes remain hash URLs such as `https://SITE.netlify.app/#/matches/personal` and `/#/session/UUID`, so refresh retains them. HTML/root and `sw.js` do not have long-lived HTTP caching; hashed `/assets/*` files are immutable. Confirm actual response headers after the first hosted deployment.

## Exact Auth settings once the origin is chosen

Let `ORIGIN` be `https://YOUR-CHOSEN-SITE.netlify.app` (no trailing slash), or the final custom-domain origin.

**Supabase project `pgljdmevusgvvlplaedt` → Authentication → URL Configuration:**

- Site URL: `ORIGIN/`
- Redirect URLs: add exactly `ORIGIN/`
- Keep localhost/ngrok entries only while deliberately supporting them. Do not allow all Netlify sites or arbitrary deploy-preview wildcards.

**Google Cloud → existing OAuth 2.0 Web application client:**

- Authorized JavaScript origins: `ORIGIN` (no path or trailing slash).
- Authorized redirect URI: `https://pgljdmevusgvvlplaedt.supabase.co/auth/v1/callback`
- Keep the same Google client ID/secret configured in Supabase's Google provider; no secret belongs in Netlify's `VITE_` variables. Preserve existing manual identity linking if Connect Google is in use. Consent-screen publishing/test-user settings must permit the intended users.

Google returns to Supabase, which returns a PKCE code to the application's root origin. Existing initialization exchanges it once, removes callback parameters and restores the allowlisted account/home/play/claim hash from session storage. Invitation claims remain `ORIGIN/#/claim/TOKEN`; do not replace Google’s callback with that claim URL. Email confirmation/resend also target `ORIGIN/`. No native Android OAuth client is required for this web flow.

References: [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls), [Supabase Google provider](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

## Install and updates

Manifest: Pule / Pule, root start and scope, standalone display, dark theme/background. PNG 192/512, maskable 512 and Apple 180 icons are exports of the existing SVG mark; maskable artwork is inset on its existing solid green background. No new identity was designed. Viewport includes `viewport-fit=cover`; existing bottom safe-area clearance remains, with top inset support in standalone mode.

`vite-plugin-pwa` 2.0.0 generates a Workbox static precache. There is no runtime data cache, background-sync queue, automatic reload, skip-waiting request or client claiming. Supabase/Auth/API requests are not cached. App updates appear discreetly in Account while a worker waits. Finish scoring/resolve pending actions, close **all** Pule tabs/windows, then reopen. Closing only one of several windows does not intentionally activate an update. An old open window deliberately stays on its coherent old shell until it is safe to replace it. Browser-managed activation after all old clients close preserves IndexedDB/localStorage, including recovery UUIDs/payloads.

The static shell can open offline after installation. This is **not offline scoring**: known-offline new writes are rejected before UUID/journal creation; retry dispatch is also blocked offline. Network failures while apparently online still use the existing uncertainty/receipt recovery flow. No stored request is cleared by the service worker.

Browser storage is origin-scoped. The Netlify origin does **not** inherit ngrok login, active drafts, PKCE state or recovery intents. Finish or resolve outstanding actions on the old origin before switching. Saved server matches remain with the same Supabase accounts/player identities; sign in again on Netlify. Do not erase old-origin browser data as a migration shortcut.

## Hosted/physical checks still required

- Inspect manifest, icons, headers and SPA refresh on the final HTTPS site.
- Install from Android Chrome as Pule; verify standalone launch, notch/system-nav clearance and scrolling.
- Test Google sign-in, email confirmation and Connect Google (if enabled) from the installed app; callback must finish in a context with the original PKCE verifier. Cross-browser/app handoff remains a physical-device check.
- Verify account/player association and use separately approved disposable matches for scoring/correction smoke tests.
- Stage an app update while another Pule window and a pending action remain open; confirm no forced reload, resolve the action, close all windows and reopen.
- Offline: shell may render; saves must be blocked. First visit still requires network. No hosted or physical-device success is claimed by local tests.

## Local verification checkpoint

- 68 focused tests passed: manifest/PNG dimensions, public build configuration, conservative update notification/registration, Netlify-origin OAuth, existing authentication, scoring controls, operation IDs/receipts and recovery.
- ESLint and `NETLIFY=true npm run build` passed using the existing public configuration. Netlify TOML parses and the built manifest/icons are valid.
- Isolated Chrome, temporary normal profile and a local production-build server: no installability errors; static shell loads offline; Auth/API responses and RPC POSTs stay out of caches; callback query strings stay out of cache keys; update waits while a second window remains open; no forced page reload; close/reopen loads the replacement shell and preserves synthetic localStorage/IndexedDB recovery UUID/payload. This uses synthetic records only, not a real signed-in account.
- Mocked app-shell checks at 320/375/390/430px passed for navigation, bottom clearance with emulated safe-area insets and overflow. Installed standalone OS integration and real Android OAuth remain physical-device checks; Chrome's ordinary-page media emulation did not enter standalone display mode.
- Runtime-only npm advisory check found zero vulnerabilities. npm reports 15 advisories in the dev-inclusive dependency tree; no unrelated dependency-upgrade sweep was performed.

Reproduce focused checks:

```sh
node --test scripts/frontend/pwa.test.mjs scripts/frontend/auth.test.mjs scripts/frontend/operations.test.mjs scripts/frontend/startupRecovery.test.mjs scripts/frontend/frameEntry.test.mjs
npm run lint
NETLIFY=true npm run build
```
