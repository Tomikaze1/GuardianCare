import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';
import { LocationService } from './location.service';
import { User } from 'firebase/auth';

export interface Incident {
  id?: string;
  type: string;
  description: string;
  location: {
    lat: number;
    lng: number;
    address?: string;
  };
  timestamp: Date;
  severity: 'low' | 'medium' | 'high';
  status: 'pending' | 'verified' | 'resolved';
  reporterId: string;
  reporterName: string;
  media?: string[];
  anonymous: boolean;
  category?: string;
  tags?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class IncidentService {
  private readonly collectionName = 'incidents';

  constructor(
    private firebaseService: FirebaseService,
    private authService: AuthService,
    private locationService: LocationService
  ) {}

  getIncidents(): Observable<Incident[]> {
    return this.firebaseService.getFirestoreInstance()
      .collection(this.collectionName)
      .valueChanges({ idField: 'id' })
      .pipe(
        map((docs: any[]) => 
          docs.map(doc => ({
            ...doc,
            timestamp: doc.timestamp?.toDate ? doc.timestamp.toDate() : doc.timestamp
          } as Incident))
        )
      );
  }

  addIncident(incident: Omit<Incident, 'id' | 'timestamp' | 'status' | 'reporterId' | 'reporterName'>): Observable<Incident> {
    return from(this.authService.getCurrentUser()).pipe(
      switchMap((user: User | null) => {
        const newIncident: Omit<Incident, 'id'> = {
          ...incident,
          timestamp: new Date(),
          status: 'pending',
          reporterId: user?.uid || 'anonymous',
          reporterName: user?.displayName || user?.email || (incident as any).reporterName || 'Anonymous'
        };

        return from(this.firebaseService.addDocument(this.collectionName, newIncident));
      }),
      map((docRef: any) => ({
        id: docRef.id,
        ...incident,
        timestamp: new Date(),
        status: 'pending',
        reporterId: (incident as any).reporterId || 'anonymous',
        reporterName: (incident as any).reporterName || 'Anonymous'
      } as Incident))
    );
  }

  updateIncident(id: string, updates: Partial<Incident>): Observable<Incident | null> {
    return from(this.firebaseService.getFirestoreInstance()
      .collection(this.collectionName)
      .doc(id)
      .update(updates)
    ).pipe(
      switchMap(() => this.getIncidentById(id))
    );
  }

  deleteIncident(id: string): Observable<boolean> {
    return from(this.firebaseService.getFirestoreInstance()
      .collection(this.collectionName)
      .doc(id)
      .delete()
    ).pipe(
      map(() => true)
    );
  }

  getIncidentById(id: string): Observable<Incident | null> {
    return this.firebaseService.getFirestoreInstance()
      .collection(this.collectionName)
      .doc(id)
      .valueChanges({ idField: 'id' })
      .pipe(
        map((doc: any) => {
          if (doc) {
            return {
              ...doc,
              timestamp: doc.timestamp?.toDate ? doc.timestamp.toDate() : doc.timestamp
            } as Incident;
          }
          return null;
        })
      );
  }

  getIncidentsByType(type: string): Observable<Incident[]> {
    return this.firebaseService.getFirestoreInstance()
      .collection(this.collectionName, ref => ref.where('type', '==', type))
      .valueChanges({ idField: 'id' })
      .pipe(
        map((docs: any[]) => 
          docs.map(doc => ({
            ...doc,
            timestamp: doc.timestamp?.toDate ? doc.timestamp.toDate() : doc.timestamp
          } as Incident))
        )
      );
  }

  getIncidentsBySeverity(severity: 'low' | 'medium' | 'high'): Observable<Incident[]> {
    return this.firebaseService.getFirestoreInstance()
      .collection(this.collectionName, ref => ref.where('severity', '==', severity))
      .valueChanges({ idField: 'id' })
      .pipe(
        map((docs: any[]) => 
          docs.map(doc => ({
            ...doc,
            timestamp: doc.timestamp?.toDate ? doc.timestamp.toDate() : doc.timestamp
          } as Incident))
        )
      );
  }

  getIncidentsByStatus(status: 'pending' | 'verified' | 'resolved'): Observable<Incident[]> {
    return this.firebaseService.getFirestoreInstance()
      .collection(this.collectionName, ref => ref.where('status', '==', status))
      .valueChanges({ idField: 'id' })
      .pipe(
        map((docs: any[]) => 
          docs.map(doc => ({
            ...doc,
            timestamp: doc.timestamp?.toDate ? doc.timestamp.toDate() : doc.timestamp
          } as Incident))
        )
      );
  }

  getCurrentLocation(): Observable<{ lat: number; lng: number }> {
    return from(this.locationService.getCurrentLocation());
  }

  async uploadImage(imageData: string): Promise<string> {
    try {
      const user = await this.authService.getCurrentUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      const fileName = `incidents/${user.uid}/${Date.now()}.jpg`;
      const storageRef = this.firebaseService.getStorageInstance().ref(fileName);
      
      const response = await fetch(imageData);
      const blob = await response.blob();
      
      const uploadTask = await storageRef.put(blob);
      const downloadURL = await uploadTask.ref.getDownloadURL();
      
      return downloadURL;
    } catch (error) {
      console.error('Error uploading image:', error);
      throw new Error('Failed to upload image. Please try again.');
    }
  }

  async uploadMultipleImages(imageDataArray: string[]): Promise<string[]> {
    const uploadPromises = imageDataArray.map(imageData => this.uploadImage(imageData));
    return Promise.all(uploadPromises);
  }

  getIncidentTypes(): string[] {
    return [
      'Theft',
      'Assault',
      'Vandalism',
      'Suspicious Activity',
      'Traffic Accident',
      'Fire',
      'Medical Emergency',
      'Natural Disaster',
      'Other'
    ];
  }

  getSeverityLevels(): { value: 'low' | 'medium' | 'high'; label: string }[] {
    return [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' }
    ];
  }
}