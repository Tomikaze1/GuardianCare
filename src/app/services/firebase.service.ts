// src/app/services/firebase.service.ts

import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import { getFirestore } from 'firebase/firestore';

// Firebase configuration object
const firebaseConfig = {
  apiKey: "AIzaSyDBowIhypiRQeeMay8yOTGbKZ3aATnHF-c",
  authDomain: "guardiancare-42d0e.firebaseapp.com",
  projectId: "guardiancare-42d0e",
  storageBucket: "guardiancare-42d0e.firebasestorage.app",
  messagingSenderId: "245676224765",
  appId: "1:245676224765:web:194288d285426cd7020e94",
  measurementId: "G-57REVD6BSB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Export Firestore to use in other parts of the app
const db = getFirestore(app);

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {
  constructor() {
    console.log('Firebase Initialized');
  }

  // Example method to get Firestore instance
  getFirestoreInstance() {
    return db;
  }

  // Example: method to add data to Firestore
  // Add your Firestore logic here
}
