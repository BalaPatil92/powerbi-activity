/**
 * storageService.js
 * ---------------------------------------------------------------------------
 * Promise-based key/value storage abstraction.
 *
 * WHY THIS EXISTS:
 *   The whole app talks to storage ONLY through this service. Today it is
 *   backed by browser localStorage, but every method returns a $q promise and
 *   uses async-style semantics so that swapping the backing store for Azure
 *   Redis Cache (via a backend REST endpoint) is a drop-in change that does
 *   NOT require touching any caller.
 *
 * PUBLIC INTERFACE (stable — Redis impl must match exactly):
 *   getItem(key)             -> Promise<any|null>   (parsed JSON or null)
 *   setItem(key, value)      -> Promise<void>       (value is auto-serialized)
 *   removeItem(key)          -> Promise<void>
 *   getKeysByPrefix(prefix)  -> Promise<string[]>   (matching full keys)
 *
 * KEY NAMESPACING CONVENTION (owned by callers, documented here):
 *   ctx_<userId>_<reportId>   e.g. ctx_u123_rpt-01
 *
 * ---------------------------------------------------------------------------
 * AZURE REDIS CACHE DROP-IN (future implementation sketch)
 * ---------------------------------------------------------------------------
 * The exact same interface, backed by a backend REST endpoint that fronts
 * Azure Cache for Redis. Because callers already `.then()` everything, no
 * caller changes are needed — only the body of these four methods.
 *
 *   angular.module('biApp').factory('StorageService', ['$http', '$q',
 *     function ($http, $q) {
 *       var BASE = '/api/cache';   // backend route -> Azure Redis
 *
 *       function getItem(key) {
 *         // GET /api/cache/{key}  -> 200 { value } | 404
 *         return $http.get(BASE + '/' + encodeURIComponent(key))
 *           .then(function (res) { return res.data ? res.data.value : null; })
 *           .catch(function (err) {
 *             if (err.status === 404) { return null; }
 *             return $q.reject(err);
 *           });
 *       }
 *
 *       function setItem(key, value) {
 *         // PUT /api/cache/{key}  body: { value }
 *         return $http.put(BASE + '/' + encodeURIComponent(key), { value: value })
 *           .then(function () { return; });
 *       }
 *
 *       function removeItem(key) {
 *         // DELETE /api/cache/{key}
 *         return $http.delete(BASE + '/' + encodeURIComponent(key))
 *           .then(function () { return; });
 *       }
 *
 *       function getKeysByPrefix(prefix) {
 *         // GET /api/cache?prefix=ctx_u123_  (backend does SCAN MATCH prefix*)
 *         return $http.get(BASE, { params: { prefix: prefix } })
 *           .then(function (res) { return res.data.keys || []; });
 *       }
 *
 *       return { getItem: getItem, setItem: setItem,
 *                removeItem: removeItem, getKeysByPrefix: getKeysByPrefix };
 *     }]);
 *
 * On the server, /api/cache/* simply proxies to Azure Cache for Redis using
 * StackExchange.Redis (GET / SET / DEL / SCAN). Serialization stays JSON so
 * stored payloads are byte-identical to the localStorage version.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  angular
    .module('biApp')
    .factory('StorageService', StorageService);

  // DI annotation for minification safety.
  StorageService.$inject = ['$q'];

  function StorageService($q) {
    var service = {
      getItem: getItem,
      setItem: setItem,
      removeItem: removeItem,
      getKeysByPrefix: getKeysByPrefix
    };
    return service;

    // -----------------------------------------------------------------------
    // getItem: read a key, JSON-parse it, resolve with the value (or null).
    // Wrapped in $q so it presents the same async contract as a network store.
    // -----------------------------------------------------------------------
    function getItem(key) {
      return $q(function (resolve, reject) {
        try {
          var raw = window.localStorage.getItem(key);
          if (raw === null || raw === undefined) {
            resolve(null);
            return;
          }
          resolve(JSON.parse(raw));
        } catch (err) {
          // Corrupt JSON should not crash callers — treat as absent but log.
          console.warn('[StorageService] getItem failed for key "' + key + '":', err);
          resolve(null);
        }
      });
    }

    // -----------------------------------------------------------------------
    // setItem: serialize + persist. Handles QuotaExceededError by evicting the
    // single oldest context (by savedAt) and retrying ONCE.
    // -----------------------------------------------------------------------
    function setItem(key, value) {
      return $q(function (resolve, reject) {
        var serialized;
        try {
          serialized = JSON.stringify(value);
        } catch (serErr) {
          reject(serErr);
          return;
        }

        try {
          window.localStorage.setItem(key, serialized);
          resolve();
        } catch (err) {
          if (isQuotaError(err)) {
            // Evict oldest context entry, then retry a single time.
            console.warn('[StorageService] Quota exceeded — evicting oldest context and retrying once.');
            evictOldestContext(key);
            try {
              window.localStorage.setItem(key, serialized);
              resolve();
            } catch (retryErr) {
              reject(retryErr);
            }
          } else {
            reject(err);
          }
        }
      });
    }

    // -----------------------------------------------------------------------
    // removeItem: delete a key.
    // -----------------------------------------------------------------------
    function removeItem(key) {
      return $q(function (resolve) {
        window.localStorage.removeItem(key);
        resolve();
      });
    }

    // -----------------------------------------------------------------------
    // getKeysByPrefix: return all full keys starting with the given prefix.
    // Mirrors a Redis "SCAN MATCH prefix*" on the future backend.
    // -----------------------------------------------------------------------
    function getKeysByPrefix(prefix) {
      return $q(function (resolve) {
        var keys = [];
        for (var i = 0; i < window.localStorage.length; i++) {
          var k = window.localStorage.key(i);
          if (k && k.indexOf(prefix) === 0) {
            keys.push(k);
          }
        }
        resolve(keys);
      });
    }

    // ----------------------------- helpers ---------------------------------

    // Detect a quota-exceeded error across browsers (name + legacy codes).
    function isQuotaError(err) {
      if (!err) { return false; }
      return (
        err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || // Firefox
        err.code === 22 ||
        err.code === 1014
      );
    }

    // Find the context key (prefix "ctx_") with the earliest savedAt and drop
    // it to make room. `exceptKey` is the key we are currently trying to write
    // so we never evict the very thing we want to save.
    function evictOldestContext(exceptKey) {
      var oldestKey = null;
      var oldestTime = Infinity;

      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (!k || k.indexOf('ctx_') !== 0 || k === exceptKey) { continue; }
        try {
          var parsed = JSON.parse(window.localStorage.getItem(k));
          var t = parsed && parsed.savedAt ? new Date(parsed.savedAt).getTime() : 0;
          if (t < oldestTime) {
            oldestTime = t;
            oldestKey = k;
          }
        } catch (e) {
          // Unparseable ctx entry — it is the safest thing to evict.
          oldestKey = k;
          break;
        }
      }

      if (oldestKey) {
        console.warn('[StorageService] Evicting oldest context key:', oldestKey);
        window.localStorage.removeItem(oldestKey);
      }
    }
  }
})();
