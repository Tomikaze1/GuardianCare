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
    // Force English as default and clear any conflicting data
    this.currentLanguage = 'en';
    this.translate.use('en');
    localStorage.setItem('userLanguage', 'en');
  }

  ngOnInit() {
    this.userService.isAdmin().subscribe(isAdmin => {
      this.isAdmin = isAdmin;
    });
    
    // Ensure current language is properly set
    this.initializeLanguage();
  }

  private initializeLanguage() {
    // Force English as the only selected language
    this.currentLanguage = 'en';
    this.translate.use('en');
    localStorage.setItem('userLanguage', 'en');
    
    // Debug logging
    console.log('Current Language:', this.currentLanguage);
    console.log('Should only be English selected');
  }

  async changeLanguage(lang: string) {
    console.log('Changing language to:', lang);
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
