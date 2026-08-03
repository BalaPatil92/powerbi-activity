/* ============================================================
   Functional route guards (Angular 18 CanActivateFn).
   ============================================================ */

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Protects authenticated routes (e.g. /dashboard).
 * Redirects to /login when there is no logged-in user.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }
  // Not logged in -> bounce to login. Returning a UrlTree performs the redirect.
  return router.createUrlTree(['/login']);
};

/**
 * Guards /login: if the user is ALREADY logged in, send them straight
 * to the dashboard instead of showing the login form again.
 */
export const loginGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return router.createUrlTree(['/dashboard']);
  }
  return true;
};
