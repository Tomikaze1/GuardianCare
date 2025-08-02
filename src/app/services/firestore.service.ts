import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';  

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  constructor(private firebaseService: FirebaseService) {}

  getReports() {
    return this.firebaseService.getDocuments('reports');
  }

  getDangerZoneRef(zoneId: string) {
    const firestore = this.firebaseService.getFirestoreInstance();
    return firestore.collection('dangerZones').doc(zoneId);
  }
}