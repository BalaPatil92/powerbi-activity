/* ============================================================
   Application routes — strictly 2 pages: Login & Dashboard.
   ============================================================ */

import { Routes } from '@angular/router';
import { authGuard, loginGuard } from './guards/auth.guard';

export const APP_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },

  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () =>
      import('./components/login/login.component').then(
        (m) => m.LoginComponent
      ),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent
      ),
  },

  // Fallback: anything unknown -> login.
  { path: '**', redirectTo: 'login' },
];
