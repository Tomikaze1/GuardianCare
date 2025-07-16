import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';  
import { Firestore, collection, getDocs, query, where, doc } from 'firebase/firestore';
import { inject } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  private firestore: Firestore;

  constructor(private firebaseService: FirebaseService) {
    this.firestore = firebaseService.getFirestoreInstance(); 
  }

  getReports() {
    const reportsCollection = collection(this.firestore, 'reports'); 
    const q = query(reportsCollection); 

    return getDocs(q).then(querySnapshot => {
      const reports = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      return reports;
    }).catch(error => {
      console.error('Error getting reports:', error);
      throw error;
    });
  }

  getDangerZoneRef(zoneId: string) {
    return doc(this.firestore, 'dangerZones', zoneId);
  }
}