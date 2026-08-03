# Power BI Embed Token API (Python)

A tiny FastAPI service that implements the **service-principal / app-owns-data**
embed flow. The Angular UI calls this API; this API holds the secrets and hands
the browser only a short-lived embed token.

## The flow

```
Angular UI                Python API                 Azure AD / Power BI
   |  POST {reportId,groupId} |                              |
   |------------------------->|                              |
   |                          |  client_id + client_secret   |
   |                          |----------------------------->|  (client-credentials)
   |                          |<-----------------------------|  AAD access token
   |                          |  GET report (embedUrl,       |
   |                          |      datasetId)              |
   |                          |----------------------------->|
   |                          |  POST GenerateToken          |
   |                          |----------------------------->|
   |                          |<-----------------------------|  embed token
   |  { token, tokenType,     |                              |
   |    embedUrl, expiry }     |                              |
   |<-------------------------|                              |
   |  embed report with token |                              |
```

## Prerequisites (one-time Azure setup)

1. **Register an app** in Azure AD (Entra ID) → note the **Tenant ID**,
   **Client ID**, and create a **Client secret**.
2. In the **Power BI Admin portal** → *Tenant settings*, enable
   **"Allow service principals to use Power BI APIs"** and add your app (or its
   security group).
3. In the target **Power BI workspace** (the `groupId` in your embed URL), add
   the service principal as a **Member/Admin** so it can read the report.
4. The workspace must be backed by a capacity that permits embedding
   (Premium / Premium-Per-User / Embedded / Fabric) for app-owns-data.

## Run

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate   |   macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env      # then fill in TENANT_ID / CLIENT_ID / CLIENT_SECRET
uvicorn main:app --reload --port 8000
```

Health check: <http://localhost:8000/health> → `{"status":"ok"}`
API docs (Swagger): <http://localhost:8000/docs>

## Endpoint

`POST /api/powerbi/embed-token`

Request:

```json
{ "reportId": "f6bfd646-b718-44dc-a378-b73e6b528204",
  "groupId":  "be8908da-da25-452e-b220-163f52476cdd" }
```

Response:

```json
{ "token": "H4sI...", "tokenType": "Embed",
  "embedUrl": "https://app.powerbi.com/reportEmbed?reportId=...&groupId=...",
  "expiry": "2026-07-31T12:00:00Z" }
```

The Angular UI is already wired to this shape via
`environment.powerbiApiBaseUrl` + `environment.embedTokenPath`
(`src/environments/environment.ts`) and `PowerbiService.getEmbedToken()`.

## Notes

- **Embed tokens are short-lived** (~1 hour). The UI requests a fresh one each
  time it embeds. For long sessions you can add token-refresh on the client.
- Keep `.env` out of source control (already covered by `.gitignore`).
- This API returns only the embed token — the client secret never leaves the
  server.
