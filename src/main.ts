/* ============================================================
   Application bootstrap (standalone — NO NgModules).
   Wires up the router, HttpClient, and the swappable
   STORAGE_PROVIDER token.
   ============================================================ */

import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';

import { AppComponent } from './app/app.component';
import { APP_ROUTES } from './app/app.routes';
import { STORAGE_PROVIDER } from './app/services/storage.service';
import { LocalStorageService } from './app/services/storage.service';

// ------------------------------------------------------------
// STORAGE PROVIDER SWAP POINT
// Current: localStorage (POC).
// Future: Azure Redis Cache via backend API.
//
// To swap, change the `useClass` below from LocalStorageService
// to RedisStorageService (skeleton lives in storage.service.ts).
// No caller changes are required — every consumer depends only
// on the STORAGE_PROVIDER token / StorageService interface.
// ------------------------------------------------------------

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(APP_ROUTES, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    { provide: STORAGE_PROVIDER, useClass: LocalStorageService },
  ],
}).catch((err) => console.error(err));
