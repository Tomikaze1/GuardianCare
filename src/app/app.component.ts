import { Component, OnInit } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Platform } from '@ionic/angular';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false
})
export class AppComponent implements OnInit {
  constructor(
    private afAuth: AngularFireAuth,
    private platform: Platform,
    private translate: TranslateService
  ) {
    this.initializeApp();
  }

  ngOnInit() {
    this.setupAuthStateMonitoring();
  }

  private initializeApp(): void {
    this.platform.ready().then(() => {
      console.log('Platform ready, initializing Firebase auth');
      const savedLanguage = localStorage.getItem('userLanguage') || 'en';
      this.translate.use(savedLanguage);
      this.setupAuthStateMonitoring();
    });
  }

  private setupAuthStateMonitoring(): void {
    this.afAuth.authState.subscribe(
      user => {
        console.log('Firebase auth state:', user ? 'User logged in' : 'No user');
        if (user) {
          console.log('User ID:', user.uid);
          console.log('User email:', user.email);
        }
      },
      error => {
        console.error('Firebase auth state error:', error);
      }
    );
  }
}
