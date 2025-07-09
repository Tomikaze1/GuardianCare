// src/app/services/firestore.service.ts

import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';  // Import the FirebaseService

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  constructor(private firebaseService: FirebaseService) {}

  // Example method to fetch reports from Firestore
  getReports() {
    const db = this.firebaseService.getFirestoreInstance();
    // Now you can use the Firestore instance (db) to interact with Firestore
  }

  // Add more Firestore logic here
}
