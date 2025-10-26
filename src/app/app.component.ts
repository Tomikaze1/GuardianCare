import { Component, OnInit } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Platform } from '@ionic/angular';
import { AdminNotificationService } from './services/admin-notification.service';

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
    private translate: TranslateService,
    private adminNotificationService: AdminNotificationService
  ) {
    this.initializeApp();
    console.log('🔔 AppComponent: AdminNotificationService injected and initialized');
  }

  ngOnInit() {
    this.setupAuthStateMonitoring();
    
    // Test AdminNotificationService initialization
    setTimeout(() => {
      console.log('🔔 AppComponent: Testing AdminNotificationService...');
      // The service should be listening for admin validations now
    }, 2000);
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
