import { Injectable } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, map, switchMap } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  constructor(
    private afAuth: AngularFireAuth,
    private firestore: AngularFirestore
  ) {}

  getCurrentUser() {
    return this.afAuth.currentUser;
  }

  getUserData(uid: string): Observable<any> {
    return this.firestore.doc(`users/${uid}`).valueChanges();
  }

  isAdmin(): Observable<boolean> {
    return this.afAuth.authState.pipe(
      switchMap(user => {
        if (!user) {
          return [false];
        }
        return this.firestore.doc(`users/${user.uid}`).valueChanges().pipe(
          map((userData: any) => userData?.role === 'admin')
        );
      })
    );
  }

  getCurrentUserData(): Observable<any> {
    return this.afAuth.authState.pipe(
      switchMap(user => {
        if (!user) {
          return [null];
        }
        return this.firestore.doc(`users/${user.uid}`).valueChanges();
      })
    );
  }
} 