# Power BI + AI Presentation POC (Angular 18)

A single-page Angular 18 proof-of-concept that:

1. Logs in with demo credentials (POC auth, **not real authentication**).
2. Embeds a Power BI report **by URL**.
3. Captures each user's activity **per report, page-by-page** (filters + slicer
   selections) into a swappable storage layer (localStorage now, Azure Redis
   later).
4. Previews all captured activity, then sends it to the **Anthropic Messages
   API** to generate a slide-by-slide PPT outline.

Built with **standalone components** (no NgModules), the `inject()` function,
**signals** for component state, `OnPush` change detection, and strict
TypeScript.

---

## Prerequisites

- Node.js 18.19+ (or 20+)
- npm 9+

## Install & run

```bash
npm install
npm start        # or: ng serve
```

Then open <http://localhost:4200>. The app compiles and runs **without** a real
Power BI URL or token — you'll get the login page and an empty report host.

## Demo credentials

| Username | Password   | User             |
| -------- | ---------- | ---------------- |
| `user1`  | `Demo@123` | Demo User One    |
| `user2`  | `Demo@123` | Demo User Two    |

They're also shown as clickable hint chips on the login page.

---

## How embed URL + token wiring works

1. Paste a `https://app.powerbi.com...` embed URL and click **Embed**.
2. The URL is validated (must be https + `app.powerbi.com`). A `reportId` is
   taken from the `reportId` query param (else a **stable hash** of the URL),
   and the `groupId` (workspace id) is extracted from the URL.
3. `PowerbiService.embedByUrl()` calls `getEmbedToken(reportId, groupId)`, which
   POSTs to the **Python service-principal API** and receives a short-lived
   **embed token**; the report is then embedded with `tokenType = Embed`.

### Token flow (service principal / app-owns-data)

```
Angular UI  --POST {reportId,groupId}-->  Python API  --client_id+secret-->  Azure AD
                                                       <--AAD token--
                                          Python API  --GenerateToken-->  Power BI
                                                       <--embed token--
Angular UI  <--{ token, tokenType, embedUrl, expiry }--  Python API
Angular UI  --embed report with token-->  Power BI
```

- The **`client_id` / `client_secret` live only on the server** (in the Python
  API's env). The browser only ever receives the short-lived embed token.
- The Python API lives in [`backend/`](backend/README.md) (FastAPI). Run it on
  `http://localhost:8000`.
- The UI's API base URL + path are configured in
  [`src/environments/environment.ts`](src/environments/environment.ts)
  (`powerbiApiBaseUrl`, `embedTokenPath`).

**Optional token override (no backend needed):** the dashboard has an optional
token field. Paste an AAD user token or an embed token there to render a report
without running the Python API — handy for quick tests. Leave it blank to use
the normal backend flow.

### Context capture (page-wise)

- On the report `rendered` event (debounced **800 ms** via an RxJS
  `Subject` + `debounceTime`), the service captures: report filters, active page
  name/displayName, page filters, and every `slicer` visual's state.
- On `pageChanged`, the newly active page's state is captured too.
- Everything is stored under `ctx_<userId>_<reportId>` as a **page-wise** map:

  ```jsonc
  {
    "userId": "u001",
    "reportId": "…",
    "embedUrl": "…",
    "reportFilters": [ /* … */ ],
    "lastActivePage": "ReportSection2",
    "savedAt": "2026-07-31T10:00:00.000Z",
    "pages": {
      "ReportSection1": { "pageFilters": [], "slicerStates": [], "lastVisited": "…" },
      "ReportSection2": { "pageFilters": [], "slicerStates": [], "lastVisited": "…" }
    }
  }
  ```

- Writes are wrapped in try/catch. On `QuotaExceededError`, the **oldest**
  context (by `savedAt`) is evicted and the write is retried once.

### Context restore

- On the report `loaded` event, saved context is re-applied: `setPage(last
  active page)`, `updateFilters(Replace, reportFilters)`, and
  `setSlicerState(...)` per saved slicer on the active page. If nothing is saved,
  the report loads with its defaults.

### Send To AI

- **Send To AI** first opens the **Activity Preview** modal showing everything
  that will be sent (grouped by report → page-wise), with a human summary and an
  expandable pretty-printed JSON view.
- **Confirm & Send** builds the payload and makes **one** Anthropic API call
  (model `claude-sonnet-4-6`). The response is parsed defensively (```json
  fences stripped) into a typed `SlideDeckOutline` and rendered as slide cards.
- **Copy JSON** copies the outline for a future PPT-generation service.

---

## Swapping localStorage → Azure Redis Cache

Storage is behind the `STORAGE_PROVIDER` injection token and the async
`StorageService` interface (`getItem`, `setItem`, `removeItem`,
`getKeysByPrefix` — all `Promise`-based). Every caller depends only on the
interface.

1. Uncomment `RedisStorageService` in
   [`src/app/services/storage.service.ts`](src/app/services/storage.service.ts)
   (a ready skeleton calling `/api/cache/{key}` via `HttpClient`).
2. Change **one line** in [`src/main.ts`](src/main.ts):

   ```ts
   // From:
   { provide: STORAGE_PROVIDER, useClass: LocalStorageService }
   // To:
   { provide: STORAGE_PROVIDER, useClass: RedisStorageService }
   ```

No caller changes are needed — the async interface already matches a
network-backed store.

---

## ⚠️ Security notes (read before production)

- **Demo auth is NOT real authentication.** Credentials are hardcoded and the
  "session" is a localStorage blob. Replace with a real IdP / token flow (e.g.
  Azure AD / Entra ID).
- **The Anthropic API call runs in the browser** with a client-side key
  placeholder. This **exposes your API key** to anyone using the app. Before
  production, **move the call behind a backend proxy**: your server holds the
  key and the browser calls your server. Remove
  `anthropic-dangerous-direct-browser-access` and the client-side key once the
  proxy exists.
- **Never generate Power BI embed tokens in the browser.** Use a backend +
  service principal.

---

## Project structure

```
src/
├── main.ts                       bootstrapApplication + provideRouter + provideHttpClient + STORAGE_PROVIDER
├── app/
│   ├── app.component.*           shell: top bar (user + logout) + router-outlet
│   ├── app.routes.ts             /login, /dashboard (authGuard), redirects
│   ├── guards/auth.guard.ts      authGuard + loginGuard (functional CanActivateFn)
│   ├── models/context.model.ts   PageContext, SlicerStateEntry, ActivityPreview, ChatPayload, SlideOutline, DemoUser, …
│   ├── services/
│   │   ├── auth.service.ts        demo login/logout, current user signal
│   │   ├── storage.service.ts     async localStorage wrapper + Redis skeleton + STORAGE_PROVIDER token
│   │   ├── powerbi.service.ts      embed / reset / capture (debounced) / restore
│   │   └── chatbot.service.ts      gather contexts, build payload, call Anthropic, parse outline
│   └── components/
│       ├── login/                 reactive-forms login + credential hints
│       ├── dashboard/             embed URL + Embed + report host + history chips + Send To AI
│       ├── activity-preview/      modal previewing all captured activity
│       ├── chat-panel/            slide-outline cards + Copy JSON + retry/loading
│       ├── gallery/               showcase gallery for pre-built report templates
│       └── documentation/         reports catalog & developer integration reference
```

---

## Documented Reports Catalog

The application includes a built-in Documentation page (`/documentation`) featuring the following registered Power BI reports:

- **Human Resource**: `https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/07043f0b-ea7f-4dcd-8223-c4b571dcbeac/ReportSection?experience=power-bi`
- **Sales & Return Sample**: `https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/c013bf6e-24eb-4793-85ec-424ccaa8d024/ReportSectiond8ab5d035cceb8586528?experience=power-bi`
- **Store Sales**: `https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/e52d3dc7-ba1b-4333-a9b8-299a0f1ac1e3/5b4ba98b5ad7f12a9ec0?experience=power-bi`
- **Supplychain**: `https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/37eb681d-d48e-4d44-90f4-95abac3618b3/ReportSection?experience=power-bi`

