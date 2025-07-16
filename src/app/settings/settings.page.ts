import { Component } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ToastController } from '@ionic/angular';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Router } from '@angular/router';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage {
  currentLanguage = 'en';
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
    private router: Router
  ) {
    const savedLang = localStorage.getItem('userLanguage') || 'en';
    this.currentLanguage = savedLang;
    this.translate.use(savedLang);
  }

  async setLanguage(lang: string) {
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
}
