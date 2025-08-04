import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, from } from 'rxjs';
import { map, take, catchError, timeout } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(): Observable<boolean> {
    console.log('AuthGuard: Checking authentication...');
    
    return this.authService.isAuthenticatedObservable().pipe(
      take(1),
      timeout(5000), // 5 second timeout
      map(authenticated => {
        console.log('AuthGuard: Authentication result:', authenticated);
        if (authenticated) {
          console.log('AuthGuard: User is authenticated, allowing access');
          return true;
        }
        console.log('AuthGuard: User not authenticated, redirecting to login');
        this.router.navigate(['/auth/login']);
        return false;
      }),
      catchError(error => {
        console.error('AuthGuard: Error checking authentication:', error);
        console.log('AuthGuard: Redirecting to login due to error');
        this.router.navigate(['/auth/login']);
        return of(false);
      })
    );
  }
}
