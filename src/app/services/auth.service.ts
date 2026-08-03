/* ============================================================
   AuthService — POC-only demo authentication.

   ⚠️ SECURITY NOTE: This is NOT real authentication. Credentials
   are hardcoded and the "session" is just a localStorage blob.
   Do not use anything here in production. Replace with a real
   IdP / token flow (e.g. Azure AD / Entra ID) before shipping.
   ============================================================ */

import { Injectable, computed, signal } from '@angular/core';
import { DemoUser } from '../models/context.model';

/** localStorage key under which the "logged-in" user is persisted. */
const AUTH_USER_KEY = 'auth_user';

/** Internal record type: a demo credential mapped to its user. */
interface DemoCredential {
  username: string;
  password: string;
  user: DemoUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  // NOTE: AuthService intentionally uses localStorage DIRECTLY (synchronous)
  // rather than StorageService. Auth/session bootstrapping must resolve
  // synchronously at guard-evaluation time; the StorageService async contract
  // is reserved for application data (contexts, history) that may live in Redis.

  /**
   * The two hardcoded demo users. Both share the same password for
   * convenience. Shown as a hint on the login page.
   */
  private readonly demoCredentials: DemoCredential[] = [
    {
      username: 'user1',
      password: 'Demo@123',
      user: { userId: 'u001', name: 'Demo User One' },
    },
    {
      username: 'user2',
      password: 'Demo@123',
      user: { userId: 'u002', name: 'Demo User Two' },
    },
  ];

  /** Current user as a signal (null when logged out). */
  private readonly _currentUser = signal<DemoUser | null>(this.readSession());

  /** Public read-only view of the current user. */
  readonly currentUser = this._currentUser.asReadonly();

  /** Convenience computed boolean. */
  readonly isAuthenticated = computed(() => this._currentUser() !== null);

  /**
   * Attempt a login. Returns true on success, false on bad credentials.
   * On success, persists the user and updates the signal.
   */
  login(username: string, password: string): boolean {
    const match = this.demoCredentials.find(
      (c) => c.username === username && c.password === password
    );
    if (!match) {
      return false;
    }
    this.writeSession(match.user);
    this._currentUser.set(match.user);
    return true;
  }

  /** Clears the session and resets the signal. */
  logout(): void {
    localStorage.removeItem(AUTH_USER_KEY);
    this._currentUser.set(null);
  }

  /** The demo credential hints (username/password pairs) for the login page. */
  getDemoHints(): Array<{ username: string; password: string }> {
    return this.demoCredentials.map((c) => ({
      username: c.username,
      password: c.password,
    }));
  }

  // ---- private session persistence helpers ----

  private readSession(): DemoUser | null {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as DemoUser;
    } catch {
      return null;
    }
  }

  private writeSession(user: DemoUser): void {
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  }
}
