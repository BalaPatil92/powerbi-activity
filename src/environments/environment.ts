/* ============================================================
   App environment config.

   `powerbiApiBaseUrl` points at the Python REST API that performs
   the service-principal (client_id + client_secret) authentication
   against Power BI and returns an embed token. See /backend.

   For local dev the Python API runs on http://localhost:8000.
   ============================================================ */

export const environment = {
  production: false,

  /** Base URL of the Python token API (adjust to your deployment). */
  powerbiApiBaseUrl: 'http://localhost:8000',

  /**
   * The embed-token endpoint on that API. The UI POSTs { reportId, groupId }
   * and receives { token, tokenType, embedUrl, expiry }.
   */
  embedTokenPath: '/api/powerbi/embed-token',
};
