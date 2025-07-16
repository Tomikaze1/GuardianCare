import { Injectable } from '@angular/core';
import { Firestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, getDoc } from '@angular/fire/firestore';
import { inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DocumentSnapshot, FirestoreError } from 'firebase/firestore';

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {
  private firestore: Firestore;

  constructor() {
    this.firestore = inject(Firestore);
  }

  getFirestoreInstance(): Firestore {
    return this.firestore;
  }

  async addDocument(collectionName: string, data: any): Promise<any> {
    try {
      const docRef = await addDoc(collection(this.firestore, collectionName), data);
      return docRef;
    } catch (error: unknown) {
      console.error("Error adding document: ", error);
      throw error;
    }
  }

  getDocuments(collectionName: string): Observable<any[]> {
    const q = query(collection(this.firestore, collectionName));
    return new Observable<any[]>((observer) => {
      getDocs(q)
        .then(querySnapshot => {
          const docs = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          observer.next(docs);
        })
        .catch((error: unknown) => {
          console.error('Error getting documents: ', error);
          observer.error(error);
        });
    });
  }

  async deleteDocument(collectionName: string, docId: string): Promise<void> {
    try {
      await deleteDoc(doc(this.firestore, collectionName, docId));
    } catch (error: unknown) {
      console.error("Error deleting document: ", error);
      throw error;
    }
  }

  async updateDocument(collectionName: string, docId: string, data: any): Promise<void> {
    try {
      const docRef = doc(this.firestore, collectionName, docId);
      await updateDoc(docRef, data);
    } catch (error: unknown) {
      console.error("Error updating document: ", error);
      throw error;
    }
  }

  getDocumentById(collectionName: string, docId: string): Observable<any> {
    return new Observable<any>((observer) => {
      const docRef = doc(this.firestore, collectionName, docId);
      getDoc(docRef).then((docSnapshot: DocumentSnapshot) => {
        if (docSnapshot.exists()) {
          observer.next({
            id: docSnapshot.id,
            ...docSnapshot.data()
          });
        } else {
          observer.error('No document found!');
        }
      }).catch((error: unknown) => {
        observer.error(`Error fetching document: ${error}`);
      });
    });
  }
}