import { Injectable } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { FacebookLogin } from '@capacitor-community/facebook-login';
import firebase from 'firebase/compat/app';

export interface AuthResult {
  success: boolean;
  error?: string;
  user?: any;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  constructor(
    private afAuth: AngularFireAuth,
    private firestore: AngularFirestore
  ) {}

  // Email/password login
  async login(email: string, password: string): Promise<AuthResult> {
    try {
      const result = await this.afAuth.signInWithEmailAndPassword(email, password);
      return { success: true, user: result.user };
    } catch (error: any) {
      return { success: false, error: this.getErrorMessage(error.code) };
    }
  }

  // Google login (via Firebase popup)
  async loginWithGoogle(): Promise<AuthResult> {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await this.afAuth.signInWithPopup(provider);
      return { success: true, user: result.user };
    } catch (error: any) {
      return { success: false, error: this.getErrorMessage(error.code) || 'Google login failed' };
    }
  }

  // Facebook login (via Capacitor plugin)
  async loginWithFacebook(): Promise<AuthResult> {
    try {
      const result = await FacebookLogin.login({ permissions: ['email', 'public_profile'] });

      if (result.accessToken) {
        const credential = firebase.auth.FacebookAuthProvider.credential(result.accessToken.token);
        const authResult = await this.afAuth.signInWithCredential(credential);
        return { success: true, user: authResult.user };
      } else {
        return { success: false, error: 'Facebook login was cancelled' };
      }
    } catch (error: any) {
      return { success: false, error: this.getErrorMessage(error.code) || 'Facebook login failed' };
    }
  }

  // Password reset
  async resetPassword(email: string): Promise<AuthResult> {
    try {
      await this.afAuth.sendPasswordResetEmail(email);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: this.getErrorMessage(error.code) };
    }
  }

  // Check auth status
  async isAuthenticated(): Promise<boolean> {
    return new Promise(resolve => {
      this.afAuth.authState.subscribe(user => {
        resolve(!!user);
      });
    });
  }

  // Get current user
  getCurrentUser() {
    return this.afAuth.currentUser;
  }

  // Logout
  async logout(): Promise<void> {
    await this.afAuth.signOut();
  }

  // Friendly error messages
  private getErrorMessage(errorCode: string): string {
    switch (errorCode) {
      case 'auth/user-not-found': return 'No user found with this email address.';
      case 'auth/wrong-password': return 'Incorrect password.';
      case 'auth/invalid-email': return 'Invalid email address.';
      case 'auth/user-disabled': return 'This account has been disabled.';
      case 'auth/too-many-requests': return 'Too many failed attempts. Please try again later.';
      case 'auth/network-request-failed': return 'Network error. Please check your connection.';
      default: return 'An error occurred. Please try again.';
    }
  }
}
