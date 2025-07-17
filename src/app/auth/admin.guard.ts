import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { map, take, switchMap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {
  constructor(
    private afAuth: AngularFireAuth,
    private firestore: AngularFirestore,
    private router: Router
  ) {}

  canActivate() {
    return this.afAuth.authState.pipe(
      take(1),
      switchMap(user => {
        if (!user) {
          this.router.navigate(['/auth/login']);
          return [false];
        }
        return this.firestore.doc(`users/${user.uid}`).valueChanges().pipe(
          take(1),
          map((userData: any) => {
            if (userData?.role === 'admin') {
              return true;
            } else {
              this.router.navigate(['/tabs/home']);
              return false;
            }
          })
        );
      })
    );
  }
}