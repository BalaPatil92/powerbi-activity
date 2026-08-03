/* ============================================================
   Root shell component: top bar (user name + navigation dropdown + logout) + outlet.
   ============================================================ */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Current user signal, read directly in the template. */
  readonly currentUser = this.auth.currentUser;

  /** Track active route for the navigation dropdown. */
  readonly currentRoute = signal<string>('/dashboard');

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        const url = event.urlAfterRedirects || event.url;
        if (url.startsWith('/about-us')) {
          this.currentRoute.set('/about-us');
        } else if (url.startsWith('/gallery')) {
          this.currentRoute.set('/gallery');
        } else if (url.startsWith('/documentation')) {
          this.currentRoute.set('/documentation');
        } else {
          this.currentRoute.set('/dashboard');
        }
      });
  }

  /** Handle navigation dropdown changes. */
  onNavChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    if (target && target.value) {
      this.router.navigateByUrl(target.value);
    }
  }

  /** Log out and return to the login page. */
  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
