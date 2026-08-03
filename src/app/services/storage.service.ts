/* ============================================================
   StorageService — async (Promise-based) key/value abstraction.

   Current: localStorage (POC).
   Future:  Azure Redis Cache via backend API.

   Every consumer depends ONLY on the `StorageService` interface,
   injected through the `STORAGE_PROVIDER` InjectionToken. Swapping
   the implementation is a one-line change in main.ts — no caller
   changes required. The async signature exists precisely so a
   network-backed (Redis) provider drops in without touching callers.
   ============================================================ */

import { Injectable, InjectionToken } from '@angular/core';
// NOTE: The Redis skeleton at the bottom of this file relies on:
//   import { HttpClient } from '@angular/common/http';
//   import { inject } from '@angular/core';
//   import { firstValueFrom } from 'rxjs';
// They are commented out (with the skeleton) so the POC build stays clean.

/**
 * The abstract contract. All storage access in the app goes through this.
 * Promise-based so a remote (Redis/HTTP) provider is a drop-in replacement.
 */
export interface StorageService {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  getKeysByPrefix(prefix: string): Promise<string[]>;
}

/**
 * Injection token consumers ask for. Bound to a concrete implementation
 * in main.ts. Swap the binding to change storage backends everywhere.
 */
export const STORAGE_PROVIDER = new InjectionToken<StorageService>(
  'STORAGE_PROVIDER'
);

/**
 * A specific error surfaced when the browser storage quota is exceeded,
 * so callers can implement eviction/retry logic cleanly.
 */
export class StorageQuotaExceededError extends Error {
  constructor(public readonly key: string) {
    super(`Storage quota exceeded while writing key "${key}"`);
    this.name = 'StorageQuotaExceededError';
  }
}

/**
 * ------------------------------------------------------------
 * Current provider: browser localStorage (POC).
 * ------------------------------------------------------------
 * Wraps the synchronous localStorage API in Promises so the
 * async interface is honored and the swap to Redis is seamless.
 */
@Injectable({ providedIn: 'root' })
export class LocalStorageService implements StorageService {
  async getItem<T>(key: string): Promise<T | null> {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupt/non-JSON value — treat as absent rather than throwing.
      return null;
    }
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      // Normalize the various browser quota-exceeded shapes into our error
      // so callers can evict + retry without sniffing vendor codes.
      if (this.isQuotaError(err)) {
        throw new StorageQuotaExceededError(key);
      }
      throw err;
    }
  }

  async removeItem(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  async getKeysByPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== null && k.startsWith(prefix)) {
        keys.push(k);
      }
    }
    return keys;
  }

  /** Detects the different QuotaExceededError signatures across browsers. */
  private isQuotaError(err: unknown): boolean {
    if (!(err instanceof DOMException)) {
      return false;
    }
    return (
      err.name === 'QuotaExceededError' ||
      // Firefox
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014
    );
  }
}

/**
 * ------------------------------------------------------------
 * FUTURE provider: Azure Redis Cache via backend API (SKELETON).
 * ------------------------------------------------------------
 * This class is intentionally NOT wired up. It demonstrates that
 * swapping localStorage -> Redis is a single provider change in
 * main.ts:
 *
 *     { provide: STORAGE_PROVIDER, useClass: RedisStorageService }
 *
 * The backend would expose a small cache API:
 *     GET    /api/cache/{key}            -> { value }  | 404
 *     PUT    /api/cache/{key}            body: { value }
 *     DELETE /api/cache/{key}
 *     GET    /api/cache?prefix={prefix}  -> { keys: [] }
 *
 * Uncomment and register in main.ts when the backend is ready.
 */
// @Injectable({ providedIn: 'root' })
// export class RedisStorageService implements StorageService {
//   private readonly http = inject(HttpClient);
//   private readonly base = '/api/cache';
//
//   async getItem<T>(key: string): Promise<T | null> {
//     try {
//       const res = await firstValueFrom(
//         this.http.get<{ value: T }>(`${this.base}/${encodeURIComponent(key)}`)
//       );
//       return res?.value ?? null;
//     } catch {
//       // 404 (miss) or transient error -> treat as absent for the POC contract.
//       return null;
//     }
//   }
//
//   async setItem<T>(key: string, value: T): Promise<void> {
//     await firstValueFrom(
//       this.http.put<void>(`${this.base}/${encodeURIComponent(key)}`, { value })
//     );
//   }
//
//   async removeItem(key: string): Promise<void> {
//     await firstValueFrom(
//       this.http.delete<void>(`${this.base}/${encodeURIComponent(key)}`)
//     );
//   }
//
//   async getKeysByPrefix(prefix: string): Promise<string[]> {
//     const res = await firstValueFrom(
//       this.http.get<{ keys: string[] }>(
//         `${this.base}?prefix=${encodeURIComponent(prefix)}`
//       )
//     );
//     return res?.keys ?? [];
//   }
// }
