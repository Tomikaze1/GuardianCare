import { Component, OnInit } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ToastController } from '@ionic/angular';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Router } from '@angular/router';
import { UserService } from '../services/user.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage implements OnInit {
  currentLanguage = 'en';
  isAdmin = false;
  userRole = 'Unknown';
  userId = 'Unknown';
  languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'ja', name: '日本語' }
  ];

  constructor(
    private translate: TranslateService,
    private toastController: ToastController,
    private afAuth: AngularFireAuth,
    private router: Router,
    private userService: UserService
  ) {
    const savedLang = localStorage.getItem('userLanguage') || 'en';
    this.currentLanguage = savedLang;
    this.translate.use(savedLang);
  }

  ngOnInit() {
    this.userService.isAdmin().subscribe(isAdmin => {
      this.isAdmin = isAdmin;
      console.log('Admin status:', isAdmin);
    });

    // Get current user data for debugging
    this.userService.getCurrentUserData().subscribe(userData => {
      if (userData) {
        this.userRole = userData.role || 'No role set';
        this.userId = userData.uid || 'No UID';
        console.log('Current user data:', userData);
        console.log('User role:', this.userRole);
        console.log('User ID:', this.userId);
      } else {
        console.log('No user data found');
      }
    });
  }

  async setLanguage(lang: string) {
    this.currentLanguage = lang;
    this.translate.use(lang);
    localStorage.setItem('userLanguage', lang);
    
    const message = this.translate.instant('ALERTS.LANGUAGE_CHANGED');
    await this.showToast(message);
  }

  async changeLanguage(lang: string) {
    this.currentLanguage = lang;
    this.translate.use(lang);
    localStorage.setItem('userLanguage', lang);
    
    const message = this.translate.instant('ALERTS.LANGUAGE_CHANGED');
    await this.showToast(message);
  }

  async showToast(message: string) {
    const toast = await this.toastController.create({
      message: message,
      duration: 2000,
      position: 'bottom'
    });
    await toast.present();
  }

  async logOut() {
    try {
      await this.afAuth.signOut();
      this.router.navigate(['/auth/login']);
    } catch (error) {
      const message = this.translate.instant('ALERTS.LOGOUT_FAILED');
      await this.showToast(message);
    }
  }

  navigateToAdmin(route: string) {
    this.router.navigate([`/admin/${route}`]);
  }
}
