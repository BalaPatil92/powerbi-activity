"""
============================================================
Power BI embed-token API (service principal / app-owns-data).

Flow that this API implements (matches the UI expectation):
  1. The Angular UI POSTs { reportId, groupId } to /api/powerbi/embed-token.
  2. This API authenticates to Azure AD using CLIENT_ID + CLIENT_SECRET
     (OAuth2 client-credentials grant) and receives an AAD access token.
  3. This API calls the Power BI REST API GenerateToken for that report
     and receives a short-lived EMBED token.
  4. This API returns { token, tokenType, embedUrl, expiry } to the UI,
     which embeds the report using the token.

SECURITY: CLIENT_ID / CLIENT_SECRET live ONLY on the server (in env vars).
They are never sent to the browser — only the short-lived embed token is.

Run:
  pip install -r requirements.txt
  cp .env.example .env    # then fill in the values
  uvicorn main:app --reload --port 8000
============================================================
"""

import os
import logging
from typing import Optional

import msal
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ------------------------------------------------------------
# Configuration (from environment / .env)
# ------------------------------------------------------------
# override=True ensures values in .env win over any stale variable already
# set in the shell environment (a common "I edited .env but it didn't take" trap).
load_dotenv(override=True)

TENANT_ID = os.getenv("TENANT_ID", "")
CLIENT_ID = os.getenv("CLIENT_ID", "")
CLIENT_SECRET = os.getenv("CLIENT_SECRET", "")

# Placeholder values shipped in .env.example — treated as "not configured".
_PLACEHOLDERS = {
    "00000000-0000-0000-0000-000000000000",
    "your-client-secret-value",
    "",
}

# Azure AD authority + the Power BI resource scope for client-credentials.
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPE = ["https://analysis.windows.net/powerbi/api/.default"]

# Power BI REST API base.
PBI_API = "https://api.powerbi.com/v1.0/myorg"

# CORS: the Angular dev server origins allowed to call this API.
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:4300,http://localhost:4200",
).split(",")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("powerbi-embed")


def _fingerprint(value: str) -> str:
    """Masked fingerprint for safe diagnostics (never logs the full secret)."""
    if not value:
        return "(empty)"
    if len(value) <= 6:
        return f"(len={len(value)}, too short)"
    return f"{value[:3]}…{value[-2:]} (len={len(value)})"


# Print, on every (re)start, WHICH config the server actually loaded. This makes
# "did my .env change take effect?" obvious. A genuine Azure secret Value is
# 40 chars — if len is not 40, it was mis-copied/truncated.
logger.info(
    "Config loaded → TENANT_ID=%s  CLIENT_ID=%s  CLIENT_SECRET=%s",
    TENANT_ID[:8] + "…" if TENANT_ID else "(empty)",
    CLIENT_ID[:8] + "…" if CLIENT_ID else "(empty)",
    _fingerprint(CLIENT_SECRET),
)

app = FastAPI(title="Power BI Embed Token API", version="1.0.0")

# Allow the SPA to call this API from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


# ------------------------------------------------------------
# Request / response models
# ------------------------------------------------------------
class EmbedTokenRequest(BaseModel):
    reportId: str
    groupId: str  # Power BI workspace id


class EmbedTokenResponse(BaseModel):
    token: str
    tokenType: str  # always "Embed" from this flow
    embedUrl: Optional[str] = None
    expiry: Optional[str] = None


# ------------------------------------------------------------
# Step 2: acquire an Azure AD access token via client credentials.
# ------------------------------------------------------------
def acquire_aad_token() -> str:
    """
    Uses MSAL's confidential client (client_id + client_secret) to get an
    app-only AAD token for the Power BI API. Raises HTTPException on failure.
    """
    # Clear, actionable error if any value is still empty or a placeholder,
    # instead of letting MSAL throw an OIDC-discovery stack trace.
    unset = [
        name
        for name, value in (
            ("TENANT_ID", TENANT_ID),
            ("CLIENT_ID", CLIENT_ID),
            ("CLIENT_SECRET", CLIENT_SECRET),
        )
        if value in _PLACEHOLDERS
    ]
    if unset:
        raise HTTPException(
            status_code=500,
            detail=(
                f"backend/.env not configured: {', '.join(unset)} is still "
                "empty or a placeholder. Set the real value(s) and save."
            ),
        )

    app_msal = msal.ConfidentialClientApplication(
        client_id=CLIENT_ID,
        authority=AUTHORITY,
        client_credential=CLIENT_SECRET,
    )

    # Try cache first, then acquire fresh.
    result = app_msal.acquire_token_silent(SCOPE, account=None)
    if not result:
        result = app_msal.acquire_token_for_client(scopes=SCOPE)

    if "access_token" not in result:
        # Surface AAD's error description for easier debugging.
        err = result.get("error_description", result.get("error", "unknown"))
        logger.error("AAD token acquisition failed: %s", err)
        raise HTTPException(status_code=502, detail=f"AAD auth failed: {err}")

    return result["access_token"]


# ------------------------------------------------------------
# Step 3: get the report (for its authoritative embedUrl + datasetId).
# ------------------------------------------------------------
def get_report(aad_token: str, group_id: str, report_id: str) -> dict:
    url = f"{PBI_API}/groups/{group_id}/reports/{report_id}"
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {aad_token}"},
        timeout=30,
    )
    if resp.status_code != 200:
        logger.error("Get report failed (%s): %s", resp.status_code, resp.text)
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Power BI get-report failed: {resp.text}",
        )
    return resp.json()


# ------------------------------------------------------------
# Step 4: generate the embed token for the report.
# ------------------------------------------------------------
def generate_embed_token(
    aad_token: str, group_id: str, report_id: str, dataset_id: Optional[str]
) -> dict:
    url = f"{PBI_API}/groups/{group_id}/reports/{report_id}/GenerateToken"

    # "View" access is enough to render. Include the dataset for good measure.
    body: dict = {"accessLevel": "View"}
    if dataset_id:
        body["datasets"] = [{"id": dataset_id}]

    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {aad_token}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=30,
    )
    if resp.status_code != 200:
        logger.error("GenerateToken failed (%s): %s", resp.status_code, resp.text)
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Power BI GenerateToken failed: {resp.text}",
        )
    return resp.json()


# ------------------------------------------------------------
# Endpoint
# ------------------------------------------------------------
@app.post("/api/powerbi/embed-token", response_model=EmbedTokenResponse)
def embed_token(req: EmbedTokenRequest) -> EmbedTokenResponse:
    """
    Full flow: AAD auth -> get report -> GenerateToken -> return embed token.
    """
    if not req.groupId:
        raise HTTPException(
            status_code=400,
            detail="groupId (workspace id) is required for embed-token generation.",
        )

    # Step 2: app-only AAD token.
    aad_token = acquire_aad_token()

    # Step 3: authoritative embedUrl + datasetId.
    report = get_report(aad_token, req.groupId, req.reportId)
    embed_url = report.get("embedUrl")
    dataset_id = report.get("datasetId")

    # Step 4: short-lived embed token.
    token_res = generate_embed_token(
        aad_token, req.groupId, req.reportId, dataset_id
    )

    return EmbedTokenResponse(
        token=token_res["token"],
        tokenType="Embed",
        embedUrl=embed_url,
        expiry=token_res.get("expiration"),
    )


@app.get("/health")
def health() -> dict:
    """Simple readiness probe."""
    return {"status": "ok"}
