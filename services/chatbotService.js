/**
 * chatbotService.js
 * ---------------------------------------------------------------------------
 * Collects ALL saved page contexts for the current user and sends them to the
 * Anthropic Messages API to produce a slide-by-slide PPT outline.
 *
 * SECURITY NOTE:
 *   Calling the Anthropic API directly from the browser exposes your API key
 *   and requires the anthropic-dangerous-direct-browser-access header. For a
 *   POC this is acceptable, but for production you MUST proxy this call through
 *   your backend (e.g. POST /api/ppt-agent) so the key never reaches the client.
 *   See PROXY sketch at the bottom of this file.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  angular
    .module('biApp')
    .factory('ChatbotService', ChatbotService);

  ChatbotService.$inject = ['$http', '$q', 'StorageService', 'UserService', 'AI_CONFIG'];

  function ChatbotService($http, $q, StorageService, UserService, AI_CONFIG) {
    // System prompt for the presentation-building agent (verbatim per spec).
    var SYSTEM_PROMPT =
      'You are a presentation-building agent. You receive a user\'s Power BI ' +
      'dashboard filter contexts as JSON. Produce a slide-by-slide PPT outline: ' +
      'for each report context generate a slide with title, key filter selections ' +
      'in bullet form, and suggested chart/visual to include. Return STRICT JSON ' +
      'only: { slides: [ { title, bullets: [], suggestedVisual } ] } with no markdown fences.';

    var service = {
      collectContexts: collectContexts,
      buildPayload: buildPayload,
      generateOutline: generateOutline
    };
    return service;

    // -----------------------------------------------------------------------
    // collectContexts: iterate all localStorage keys with prefix ctx_<userId>_
    // and return the parsed context JSON objects.
    // -----------------------------------------------------------------------
    function collectContexts() {
      var user = UserService.getUser();
      var prefix = 'ctx_' + user.userId + '_';

      return StorageService.getKeysByPrefix(prefix).then(function (keys) {
        var reads = keys.map(function (k) { return StorageService.getItem(k); });
        return $q.all(reads).then(function (contexts) {
          // Filter out any nulls (corrupt/missing) defensively.
          return contexts.filter(function (c) { return !!c; });
        });
      });
    }

    // -----------------------------------------------------------------------
    // buildPayload: assemble the { user, collectedAt, pageContexts } object.
    // -----------------------------------------------------------------------
    function buildPayload() {
      var user = UserService.getUser();
      return collectContexts().then(function (contexts) {
        return {
          user: { userId: user.userId, name: user.name },
          collectedAt: new Date().toISOString(),
          pageContexts: contexts
        };
      });
    }

    // -----------------------------------------------------------------------
    // generateOutline: build payload, call Anthropic ONCE, parse strict JSON.
    //   userRequest - the free-text request the user typed
    // Resolves with { slides: [...] }; rejects with a friendly error object.
    // -----------------------------------------------------------------------
    function generateOutline(userRequest) {
      return buildPayload().then(function (payload) {
        // Guard: nothing captured yet.
        if (!payload.pageContexts.length) {
          return $q.reject({
            code: 'NO_CONTEXTS',
            message: 'No saved dashboard contexts found yet. Open some reports and interact with them first.'
          });
        }

        // Guard: API key not configured.
        if (!AI_CONFIG.apiKey || AI_CONFIG.apiKey.indexOf('PLACEHOLDER') !== -1) {
          return $q.reject({
            code: 'NO_API_KEY',
            message: 'Anthropic API key not configured. Set AI_CONFIG.apiKey in app.js.'
          });
        }

        // The user message = typed request + the full payload JSON.
        var userMessage =
          userRequest + '\n\nHere is my Power BI dashboard context payload as JSON:\n' +
          JSON.stringify(payload, null, 2);

        var body = {
          model: AI_CONFIG.model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user', content: userMessage }
          ]
        };

        var config = {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': AI_CONFIG.apiKey,
            'anthropic-version': '2023-06-01',
            // Required to call the API directly from a browser (POC only).
            'anthropic-dangerous-direct-browser-access': 'true'
          }
        };

        return $http.post(AI_CONFIG.endpoint, body, config)
          .then(function (res) {
            var text = extractText(res.data);
            var parsed = parseStrictJson(text);
            if (!parsed || !parsed.slides) {
              return $q.reject({
                code: 'BAD_RESPONSE',
                message: 'The AI response could not be parsed into a slide outline.',
                raw: text
              });
            }
            return parsed;
          })
          .catch(function (err) {
            // Normalize $http errors + our own rejections into a common shape.
            if (err && err.code) { return $q.reject(err); }
            var msg = 'AI request failed';
            if (err && err.data && err.data.error && err.data.error.message) {
              msg = err.data.error.message;
            } else if (err && err.status === -1) {
              msg = 'Network/CORS error reaching the Anthropic API.';
            } else if (err && err.status) {
              msg = 'AI request failed with HTTP ' + err.status;
            }
            return $q.reject({ code: 'API_ERROR', message: msg });
          });
      });
    }

    // ----------------------------- helpers ---------------------------------

    // Pull the concatenated text out of an Anthropic Messages API response.
    function extractText(data) {
      if (!data || !data.content) { return ''; }
      return data.content
        .filter(function (block) { return block.type === 'text'; })
        .map(function (block) { return block.text; })
        .join('');
    }

    // Parse strict JSON, defensively stripping ```json / ``` fences if present.
    function parseStrictJson(text) {
      if (!text) { return null; }
      var cleaned = text.trim();

      // Strip leading/trailing markdown code fences if the model added them.
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

      // As a last resort, extract the first {...} block.
      try {
        return JSON.parse(cleaned);
      } catch (e) {
        var first = cleaned.indexOf('{');
        var last = cleaned.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
          try {
            return JSON.parse(cleaned.substring(first, last + 1));
          } catch (e2) {
            return null;
          }
        }
        return null;
      }
    }

    /* -------------------------------------------------------------------------
     * PRODUCTION PROXY SKETCH (recommended)
     * -------------------------------------------------------------------------
     * Replace the $http.post above with a call to your own backend so the API
     * key stays server-side:
     *
     *   return $http.post('/api/ppt-agent', {
     *     userRequest: userRequest,
     *     payload: payload
     *   }).then(function (res) { return res.data; });   // { slides: [...] }
     *
     * The backend then performs the Anthropic call with the key from a secret
     * store (Azure Key Vault) and returns the already-parsed outline.
     * ---------------------------------------------------------------------- */
  }
})();
