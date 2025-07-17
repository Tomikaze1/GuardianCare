import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { map } from 'rxjs/operators';
import { DangerZone } from '../models/zone.model';

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  constructor(private firestore: AngularFirestore) {}

  getZones() {
    return this.firestore.collection<DangerZone>('dangerZones').valueChanges({ idField: 'id' });
  }

  getZone(zoneId: string) {
    return this.firestore.collection('dangerZones').doc(zoneId).valueChanges();
  }

  createZone(zoneData: Omit<DangerZone, 'id'>) {
    return this.firestore.collection('dangerZones').add(zoneData);
  }

  updateZone(zoneId: string, data: Partial<DangerZone>) {
    return this.firestore.collection('dangerZones').doc(zoneId).update(data);
  }

  deleteZone(zoneId: string) {
    return this.firestore.collection('dangerZones').doc(zoneId).delete();
  }

  getPendingIncidents() {
    return this.firestore.collection('incidents', ref => 
      ref.where('status', '==', 'pending').orderBy('timestamp', 'desc')
    ).valueChanges({ idField: 'id' });
  }

  getIncidentsByStatus(status: 'pending' | 'verified' | 'rejected') {
    return this.firestore.collection('incidents', ref => 
      ref.where('status', '==', status).orderBy('timestamp', 'desc')
    ).valueChanges({ idField: 'id' });
  }

  validateIncident(incidentId: string, valid: boolean) {
    return this.firestore.collection('incidents').doc(incidentId).update({
      status: valid ? 'verified' : 'rejected',
      reviewedAt: new Date(),
      reviewedBy: 'admin'
    });
  }

  getIncidentAnalytics() {
    return this.firestore.collection('analytics').doc('incidents').valueChanges();
  }

  getUserActivity(limit = 100) {
    return this.firestore.collection('userActivity', ref =>
      ref.orderBy('timestamp', 'desc').limit(limit)
    ).valueChanges({ idField: 'id' });
  }

  getUsers() {
    return this.firestore.collection('users').valueChanges({ idField: 'uid' });
  }

  updateUserRole(uid: string, role: string) {
    return this.firestore.collection('users').doc(uid).update({ role });
  }
}