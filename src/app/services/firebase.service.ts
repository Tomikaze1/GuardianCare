import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {
  constructor(private firestore: AngularFirestore) {
    console.log('FirebaseService initialized using AngularFirestore');
  }

  getFirestoreInstance(): AngularFirestore {
    return this.firestore;
  }

  addDocument(collectionName: string, data: any): Promise<any> {
    return this.firestore.collection(collectionName).add(data);
  }

  getDocuments(collectionName: string): Observable<any[]> {
    return this.firestore.collection(collectionName).valueChanges({ idField: 'id' });
  }

  deleteDocument(collectionName: string, docId: string): Promise<void> {
    return this.firestore.collection(collectionName).doc(docId).delete();
  }

  updateDocument(collectionName: string, docId: string, data: any): Promise<void> {
    return this.firestore.collection(collectionName).doc(docId).update(data);
  }

  getDocumentById(collectionName: string, docId: string): Observable<any> {
    return this.firestore.collection(collectionName).doc(docId).valueChanges();
  }
}
