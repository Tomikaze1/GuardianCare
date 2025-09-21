import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireStorage } from '@angular/fire/compat/storage';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {
  constructor(
    private firestore: AngularFirestore,
    private storage: AngularFireStorage
  ) {}

  getFirestoreInstance(): AngularFirestore {
    return this.firestore;
  }

  async addDocument(collectionName: string, data: any): Promise<any> {
    try {
      const docRef = await this.firestore.collection(collectionName).add(data);
      return docRef;
    } catch (error: unknown) {
      console.error("Error adding document: ", error);
      throw error;
    }
  }

  getDocuments(collectionName: string): Observable<any[]> {
    try {
      if (!this.firestore) {
        console.error('FirebaseService: Firestore instance is not available');
        throw new Error('Firestore instance not available');
      }
      // Use snapshotChanges() instead of valueChanges() to avoid injection context issues
      return this.firestore.collection(collectionName).snapshotChanges().pipe(
        map(actions => actions.map(a => {
          const data = a.payload.doc.data();
          const id = a.payload.doc.id;
          return { id, ...(data as any) };
        }))
      );
    } catch (error) {
      console.error('FirebaseService: Error in getDocuments:', error);
      throw error;
    }
  }

  async deleteDocument(collectionName: string, docId: string): Promise<void> {
    try {
      await this.firestore.collection(collectionName).doc(docId).delete();
    } catch (error: unknown) {
      console.error("Error deleting document: ", error);
      throw error;
    }
  }

  async updateDocument(collectionName: string, docId: string, data: any): Promise<void> {
    try {
      await this.firestore.collection(collectionName).doc(docId).update(data);
    } catch (error: unknown) {
      console.error("Error updating document: ", error);
      throw error;
    }
  }

  getDocumentById(collectionName: string, docId: string): Observable<any> {
    return this.firestore.collection(collectionName).doc(docId).valueChanges({ idField: 'id' });
  }

  getStorageInstance(): AngularFireStorage {
    return this.storage;
  }
}