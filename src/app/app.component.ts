import { Component, OnInit } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor(private afAuth: AngularFireAuth) {}

  ngOnInit() {
    // Check Firebase connection
    console.log('App initializing...');
    this.afAuth.authState.subscribe(
      (user) => {
        console.log('Firebase Auth State:', user ? 'Authenticated' : 'Not authenticated');
        if (user) {
          console.log('User details:', {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName
          });
        }
      },
      (error) => {
        console.error('Firebase Auth Error:', error);
      }
    );
  }
}
