import { Injectable } from '@angular/core';
import { FacebookLogin } from '@capacitor-community/facebook-login';
import { Subscription, Observable, BehaviorSubject } from 'rxjs';
import { map, take } from 'rxjs/operators';

// Native Firebase imports
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  signInWithCredential, 
  signOut, 
  onAuthStateChanged, 
  sendPasswordResetEmail, 
  User, 
  createUserWithEmailAndPassword, 
  updateProfile, 
  sendEmailVerification 
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { environment } from '../../environments/environment';

export interface AuthResult {
  success: boolean;
  error?: string;
  user?: any;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth: any;
  private firestore: any;
  private authStateSubscription?: Subscription;
  private authStateSubject = new BehaviorSubject<User | null>(null);

  constructor() {
    // Initialize Firebase if not already initialized
    try {
      initializeApp(environment.firebaseConfig);
      console.log('✅ Firebase initialized in AuthService');
    } catch (error) {
      console.log('ℹ️ Firebase already initialized in AuthService');
    }
    
    this.auth = getAuth();
    this.firestore = getFirestore();
    
    // Initialize auth state monitoring
    this.initializeAuthState();
  }

  private initializeAuthState(): void {
    console.log('AuthService: Initializing auth state monitoring');
    onAuthStateChanged(this.auth, (user) => {
      console.log('AuthService: Auth state changed:', user ? 'User authenticated' : 'No user');
      if (user) {
        console.log('AuthService: User details - UID:', user.uid, 'Email:', user.email);
      }
      this.authStateSubject.next(user);
    }, (error) => {
      console.error('AuthService: Auth state error:', error);
      this.authStateSubject.next(null);
    });
  }

  async login(email: string, password: string): Promise<AuthResult> {
    try {
      console.log('AuthService: Attempting login for:', email);
      const result = await signInWithEmailAndPassword(this.auth, email, password);
      console.log('AuthService: Login successful for:', email);
      console.log('AuthService: User UID after login:', result.user?.uid);
      return { success: true, user: result.user };
    } catch (error: any) {
      console.error('AuthService: Login error:', error);
      return { success: false, error: this.getErrorMessage(error.code) };
    }
  }

  async loginWithGoogle(): Promise<AuthResult> {
    try {
      console.log('AuthService: Attempting Google login');
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(this.auth, provider);
      await this.createUserInFirestore(result.user);
      console.log('AuthService: Google login successful');
      console.log('AuthService: User UID after Google login:', result.user?.uid);
      return { success: true, user: result.user };
    } catch (error: any) {
      console.error('AuthService: Google login error:', error);
      return { success: false, error: this.getErrorMessage(error.code) || 'Google login failed' };
    }
  }

  async loginWithFacebook(): Promise<AuthResult> {
    try {
      console.log('AuthService: Attempting Facebook login');
      const result = await FacebookLogin.login({ permissions: ['email', 'public_profile'] });

      if (result.accessToken) {
        const credential = FacebookAuthProvider.credential(result.accessToken.token);
        const authResult = await signInWithCredential(this.auth, credential);
        await this.createUserInFirestore(authResult.user);
        console.log('AuthService: Facebook login successful');
        console.log('AuthService: User UID after Facebook login:', authResult.user?.uid);
        return { success: true, user: authResult.user };
      } else {
        return { success: false, error: 'Facebook login was cancelled' };
      }
    } catch (error: any) {
      console.error('AuthService: Facebook login error:', error);
      return { success: false, error: this.getErrorMessage(error.code) || 'Facebook login failed' };
    }
  }

  private async createUserInFirestore(user: User | null) {
    if (user) {
      try {
        const userRef = doc(this.firestore, 'users', user.uid);
        const userDoc = await getDoc(userRef);

        if (userDoc && userDoc.exists()) {
          console.log('AuthService: User already exists in Firestore');
          return;
        }

        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: serverTimestamp(),
        });
        console.log('AuthService: User created in Firestore');
      } catch (error) {
        console.error('AuthService: Error creating user in Firestore:', error);
      }
    }
  }

  async resetPassword(email: string): Promise<AuthResult> {
    try {
      await sendPasswordResetEmail(this.auth, email);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: this.getErrorMessage(error.code) };
    }
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      const user = this.auth.currentUser;
      console.log('AuthService: Current user check:', user ? 'User authenticated' : 'No user');
      if (user) {
        console.log('AuthService: Current user UID:', user.uid);
      }
      return !!user;
    } catch (error) {
      console.error('AuthService: Error checking authentication:', error);
      return false;
    }
  }

  // Alternative method using Observable for better performance
  isAuthenticatedObservable(): Observable<boolean> {
    console.log('AuthService: Using observable auth check');
    return this.authStateSubject.pipe(
      take(1),
      map(user => {
        console.log('AuthService: Observable auth check result:', !!user);
        if (user) {
          console.log('AuthService: Observable user UID:', user.uid);
        }
        return !!user;
      })
    );
  }

  getCurrentUser(): Promise<User | null> {
    return Promise.resolve(this.auth.currentUser);
  }

  async logout(): Promise<void> {
    try {
      console.log('AuthService: Attempting logout');
      await signOut(this.auth);
      console.log('AuthService: Logout successful');
    } catch (error) {
      console.error('AuthService: Logout error:', error);
      throw error;
    }
  }

  // Cleanup method to prevent memory leaks
  ngOnDestroy(): void {
    // No explicit unsubscribe needed for onAuthStateChanged as it's a global listener
  }

  private getErrorMessage(errorCode: string): string {
    switch (errorCode) {
      case 'auth/user-not-found': return 'No user found with this email address.';
      case 'auth/wrong-password': return 'Incorrect password.';
      case 'auth/invalid-email': return 'Invalid email address.';
      case 'auth/user-disabled': return 'This account has been disabled.';
      case 'auth/too-many-requests': return 'Too many failed attempts. Please try again later.';
      case 'auth/network-request-failed': return 'Network error. Please check your connection.';
      case 'auth/popup-closed-by-user': return 'Login popup was closed. Please try again.';
      case 'auth/popup-blocked': return 'Login popup was blocked. Please allow popups and try again.';
      case 'auth/cancelled-popup-request': return 'Login was cancelled.';
      default: return 'An error occurred. Please try again.';
    }
  }
}
