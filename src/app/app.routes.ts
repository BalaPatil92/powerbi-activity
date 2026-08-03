/* ============================================================
   Application routes — lazy-loaded standalone components.
   ============================================================ */

import { Routes } from '@angular/router';
import { authGuard, loginGuard } from './guards/auth.guard';

export const APP_ROUTES: Routes = [
  // Default: send to login (the loginGuard forwards to /dashboard if already in).
  { path: '', pathMatch: 'full', redirectTo: 'login' },

  {
    path: 'login',
    canActivate: [loginGuard],
    // Lazy-load the standalone login component.
    loadComponent: () =>
      import('./components/login/login.component').then(
        (m) => m.LoginComponent
      ),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    // Lazy-load the standalone dashboard component.
    loadComponent: () =>
      import('./components/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent
      ),
  },
  {
    path: 'about-us',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/about-us/about-us.component').then(
        (m) => m.AboutUsComponent
      ),
  },
  {
    path: 'gallery',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/gallery/gallery.component').then(
        (m) => m.GalleryComponent
      ),
  },
  {
    path: 'documentation',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/documentation/documentation.component').then(
        (m) => m.DocumentationComponent
      ),
  },

  // Fallback: anything unknown -> login.
  { path: '**', redirectTo: 'login' },
];
