/* ============================================================
   LoginComponent — standalone reactive-forms login page.
   ============================================================ */

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Inline error flag (component signal state). */
  readonly loginError = signal(false);

  /** The two demo credential hints to display on the page. */
  readonly demoHints = this.auth.getDemoHints();

  /** Reactive login form. */
  readonly form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  /** Attempt login; on success navigate to /dashboard, else show error. */
  submit(): void {
    this.loginError.set(false);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { username, password } = this.form.getRawValue();
    const ok = this.auth.login(username, password);

    if (ok) {
      this.router.navigate(['/dashboard']);
    } else {
      this.loginError.set(true);
    }
  }

  /** Prefill the form from a demo hint chip (POC convenience). */
  useHint(hint: { username: string; password: string }): void {
    this.form.setValue({
      username: hint.username,
      password: hint.password,
    });
    this.loginError.set(false);
  }
}
