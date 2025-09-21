import { Injectable } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, map, switchMap, firstValueFrom } from 'rxjs';

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

  // New method to get user data as a Promise to avoid injection context issues
  async getUserDataOnce(uid: string): Promise<any> {
    try {
      // Use native Firebase instead of AngularFire to avoid injection context issues
      const { getFirestore, doc, getDoc } = await import('firebase/firestore');
      const firestore = getFirestore();
      const userDocRef = doc(firestore, 'users', uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        return userDoc.data();
      } else {
        console.log('No user document found');
        return null;
      }
    } catch (error) {
      console.error('Error getting user data:', error);
      throw error;
    }
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

  async updateUserData(uid: string, data: any): Promise<void> {
    try {
      // Use native Firebase instead of AngularFire to avoid injection context issues
      const { getFirestore, doc, updateDoc } = await import('firebase/firestore');
      const firestore = getFirestore();
      const userDocRef = doc(firestore, 'users', uid);
      await updateDoc(userDocRef, data);
      console.log('User data updated successfully');
    } catch (error) {
      console.error('Error updating user data:', error);
      throw error;
    }
  }

  async createUserData(uid: string, data: any): Promise<void> {
    try {
      // Use native Firebase instead of AngularFire to avoid injection context issues
      const { getFirestore, doc, setDoc } = await import('firebase/firestore');
      const firestore = getFirestore();
      const userDocRef = doc(firestore, 'users', uid);
      await setDoc(userDocRef, data);
      console.log('User data created successfully');
    } catch (error) {
      console.error('Error creating user data:', error);
      throw error;
    }
  }
} 