import { Component, OnInit } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ToastController, AlertController, LoadingController } from '@ionic/angular';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Router } from '@angular/router';
import { UserService } from '../services/user.service';
import { NotificationService } from '../shared/services/notification.service';

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
  
  // Account & Security
  twoFactorEnabled = false;
  
  // Location & Alerts
  gpsEnabled = true;
  timeBasedAlerts = true;
  dangerZoneAlerts = true;
  doNotDisturbEnabled = false;
  
  // Notifications
  smartVibration = true;
  selectedAlertSound = 'Default';
  panicModeVisuals = true;
  
  // Localization
  selectedUnit = 'Metric';
  touristTranslationMode = false;
  
  languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'ja', name: '日本語' },
    { code: 'ph', name: 'Filipino' }
  ];

  alertSoundOptions = [
    { value: 'Soft', label: 'Soft' },
    { value: 'Default', label: 'Default' },
    { value: 'Loud', label: 'Loud' }
  ];

  unitOptions = [
    { value: 'Metric', label: 'Metric' },
    { value: 'Imperial', label: 'Imperial' }
  ];

  constructor(
    private translate: TranslateService,
    private toastController: ToastController,
    private alertController: AlertController,
    private afAuth: AngularFireAuth,
    private router: Router,
    private userService: UserService,
    private notificationService: NotificationService,
    private loadingController: LoadingController
  ) {
    this.currentLanguage = 'en';
    this.translate.use('en');
    localStorage.setItem('userLanguage', 'en');
  }

  ngOnInit() {
    this.userService.isAdmin().subscribe(isAdmin => {
      this.isAdmin = isAdmin;
      console.log('Admin status:', isAdmin);
    });

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
    
    this.initializeLanguage();
    this.loadSettings();
  }

  private initializeLanguage() {
    this.currentLanguage = 'en';
    this.translate.use('en');
    localStorage.setItem('userLanguage', 'en');
    
    console.log('Current Language:', this.currentLanguage);
    console.log('Should only be English selected');
  }

  private loadSettings() {
    // Load saved settings from localStorage
    this.gpsEnabled = localStorage.getItem('gpsEnabled') !== 'false';
    this.timeBasedAlerts = localStorage.getItem('timeBasedAlerts') !== 'false';
    this.dangerZoneAlerts = localStorage.getItem('dangerZoneAlerts') !== 'false';
    this.doNotDisturbEnabled = localStorage.getItem('doNotDisturbEnabled') === 'true';
    this.smartVibration = localStorage.getItem('smartVibration') !== 'false';
    this.panicModeVisuals = localStorage.getItem('panicModeVisuals') !== 'false';
    this.touristTranslationMode = localStorage.getItem('touristTranslationMode') === 'true';
    this.twoFactorEnabled = localStorage.getItem('twoFactorEnabled') === 'true';
    
    this.selectedAlertSound = localStorage.getItem('selectedAlertSound') || 'Default';
    this.selectedUnit = localStorage.getItem('selectedUnit') || 'Metric';
  }

  // Account & Security Methods
  async changePassword() {
    this.notificationService.info('Coming Soon', 'Password change functionality will be available soon!', 'OK', 3000);
  }

  async updateEmail() {
    this.notificationService.info('Coming Soon', 'Email update functionality will be available soon!', 'OK', 3000);
  }

  async linkedDevices() {
    this.notificationService.info('Coming Soon', 'Linked devices functionality will be available soon!', 'OK', 3000);
  }

  async twoFactorAuth() {
    this.notificationService.info('Coming Soon', 'Two-factor authentication setup will be available soon!', 'OK', 3000);
  }

  async toggleTwoFactor() {
    localStorage.setItem('twoFactorEnabled', this.twoFactorEnabled.toString());
    const message = this.twoFactorEnabled ? 'Two-factor authentication enabled' : 'Two-factor authentication disabled';
    this.notificationService.success('Success', message, 'OK', 2000);
  }

  // Location & Alerts Methods
  async toggleGPS() {
    localStorage.setItem('gpsEnabled', this.gpsEnabled.toString());
    const message = this.gpsEnabled ? 'GPS access enabled' : 'GPS access disabled';
    this.notificationService.success('Success', message, 'OK', 2000);
  }

  async toggleTimeBasedAlerts() {
    localStorage.setItem('timeBasedAlerts', this.timeBasedAlerts.toString());
    const message = this.timeBasedAlerts ? 'Time-based alerts enabled' : 'Time-based alerts disabled';
    this.notificationService.success('Success', message, 'OK', 2000);
  }

  async toggleDangerZoneAlerts() {
    localStorage.setItem('dangerZoneAlerts', this.dangerZoneAlerts.toString());
    const message = this.dangerZoneAlerts ? 'Danger zone alerts enabled' : 'Danger zone alerts disabled';
    this.notificationService.success('Success', message, 'OK', 2000);
  }

  async toggleDoNotDisturb() {
    localStorage.setItem('doNotDisturbEnabled', this.doNotDisturbEnabled.toString());
    const message = this.doNotDisturbEnabled ? 'Do not disturb mode enabled' : 'Do not disturb mode disabled';
    this.notificationService.success('Success', message, 'OK', 2000);
  }

  async doNotDisturbSettings() {
    this.notificationService.info('Coming Soon', 'Do not disturb settings will be available soon!', 'OK', 3000);
  }

  // Notifications Methods
  async toggleSmartVibration() {
    localStorage.setItem('smartVibration', this.smartVibration.toString());
    const message = this.smartVibration ? 'Smart vibration enabled' : 'Smart vibration disabled';
    this.notificationService.success('Success', message, 'OK', 2000);
  }

  async alertSounds() {
    const alert = await this.alertController.create({
      header: 'Select Alert Sound',
      inputs: this.alertSoundOptions.map(sound => ({
        type: 'radio',
        label: sound.label,
        value: sound.value,
        checked: sound.value === this.selectedAlertSound
      })),
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'OK',
          handler: (value) => {
            if (value) {
              this.selectedAlertSound = value;
              localStorage.setItem('selectedAlertSound', value);
              this.notificationService.success('Success', `Alert sound changed to ${value}`, 'OK', 2000);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async languagePreference() {
    const alert = await this.alertController.create({
      header: 'Select Language',
      inputs: this.languages.map(lang => ({
        type: 'radio',
        label: lang.name,
        value: lang.code,
        checked: lang.code === this.currentLanguage
      })),
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'OK',
          handler: (value) => {
            if (value) {
              this.changeLanguage(value);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async togglePanicModeVisuals() {
    localStorage.setItem('panicModeVisuals', this.panicModeVisuals.toString());
    const message = this.panicModeVisuals ? 'Panic mode visuals enabled' : 'Panic mode visuals disabled';
    this.notificationService.success('Success', message, 'OK', 2000);
  }

  // Localization Methods
  async appLanguage() {
    const alert = await this.alertController.create({
      header: 'Select App Language',
      inputs: this.languages.map(lang => ({
        type: 'radio',
        label: lang.name,
        value: lang.code,
        checked: lang.code === this.currentLanguage
      })),
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'OK',
          handler: (value) => {
            if (value) {
              this.changeLanguage(value);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async units() {
    const alert = await this.alertController.create({
      header: 'Select Units',
      inputs: this.unitOptions.map(unit => ({
        type: 'radio',
        label: unit.label,
        value: unit.value,
        checked: unit.value === this.selectedUnit
      })),
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'OK',
          handler: (value) => {
            if (value) {
              this.selectedUnit = value;
              localStorage.setItem('selectedUnit', value);
              this.notificationService.success('Success', `Units changed to ${value}`, 'OK', 2000);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async toggleTouristTranslation() {
    localStorage.setItem('touristTranslationMode', this.touristTranslationMode.toString());
    const message = this.touristTranslationMode ? 'Tourist translation mode enabled' : 'Tourist translation mode disabled';
    this.notificationService.success('Success', message, 'OK', 2000);
  }

  // Legal & Support Methods
  async termsOfService() {
    const alert = await this.alertController.create({
      header: 'Terms of Service',
      message: `
        <div style="text-align: left; max-height: 300px; overflow-y: auto;">
          <h4>GuardianCare Terms of Service</h4>
          <p><strong>Last updated:</strong> August 2024</p>
          
          <h5>1. Acceptance of Terms</h5>
          <p>By using GuardianCare, you agree to be bound by these Terms of Service.</p>
          
          <h5>2. Service Description</h5>
          <p>GuardianCare is a safety companion app that provides location-based alerts and emergency response services.</p>
          
          <h5>3. User Responsibilities</h5>
          <p>Users are responsible for:</p>
          <ul>
            <li>Providing accurate information</li>
            <li>Using the service responsibly</li>
            <li>Notifying authorities in real emergencies</li>
          </ul>
          
          <h5>4. Privacy</h5>
          <p>Your privacy is important. See our Privacy Policy for details.</p>
          
          <h5>5. Limitation of Liability</h5>
          <p>GuardianCare is not liable for any damages arising from use of the service.</p>
        </div>
      `,
      buttons: [
        {
          text: 'Close',
          role: 'cancel'
        }
      ],
      cssClass: 'terms-alert'
    });
    await alert.present();
  }

  async privacyPolicy() {
    const alert = await this.alertController.create({
      header: 'Privacy Policy',
      message: `
        <div style="text-align: left; max-height: 300px; overflow-y: auto;">
          <h4>GuardianCare Privacy Policy</h4>
          <p><strong>Last updated:</strong> August 2024</p>
          
          <h5>1. Information We Collect</h5>
          <p>We collect:</p>
          <ul>
            <li>Location data (with your consent)</li>
            <li>Account information</li>
            <li>Emergency reports</li>
            <li>App usage data</li>
          </ul>
          
          <h5>2. How We Use Your Information</h5>
          <p>We use your information to:</p>
          <ul>
            <li>Provide safety alerts</li>
            <li>Improve our services</li>
            <li>Respond to emergencies</li>
            <li>Send notifications</li>
          </ul>
          
          <h5>3. Data Security</h5>
          <p>We implement industry-standard security measures to protect your data.</p>
          
          <h5>4. Data Sharing</h5>
          <p>We only share data with:</p>
          <ul>
            <li>Emergency services (when needed)</li>
            <li>Your explicit consent</li>
            <li>Legal requirements</li>
          </ul>
          
          <h5>5. Your Rights</h5>
          <p>You have the right to access, modify, or delete your data.</p>
        </div>
      `,
      buttons: [
        {
          text: 'Close',
          role: 'cancel'
        }
      ],
      cssClass: 'privacy-alert'
    });
    await alert.present();
  }

  async contactSupport() {
    const alert = await this.alertController.create({
      header: 'Contact Support',
      message: `
        <div style="text-align: left;">
          <h4>Get Help & Support</h4>
          
          <div style="margin: 15px 0;">
            <h5>📧 Email Support</h5>
            <p><strong>support@guardiancare.com</strong></p>
            <p>Response time: 24-48 hours</p>
          </div>
          
          <div style="margin: 15px 0;">
            <h5>📞 Emergency Hotline</h5>
            <p><strong>+1 (555) 123-4567</strong></p>
            <p>24/7 emergency support</p>
          </div>
          
          <div style="margin: 15px 0;">
            <h5>💬 Live Chat</h5>
            <p>Available during business hours</p>
            <p>9:00 AM - 6:00 PM (PST)</p>
          </div>
          
          <div style="margin: 15px 0;">
            <h5>📱 In-App Support</h5>
            <p>Use the "Report Issue" feature</p>
            <p>Include screenshots for faster resolution</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 10px; border-radius: 8px; margin-top: 15px;">
            <p><strong>💡 Tip:</strong> For faster support, please include your device model and app version when contacting us.</p>
          </div>
        </div>
      `,
      buttons: [
        {
          text: 'Send Email',
          handler: () => {
            window.open('mailto:support@guardiancare.com?subject=GuardianCare Support Request', '_blank');
          }
        },
        {
          text: 'Close',
          role: 'cancel'
        }
      ],
      cssClass: 'support-alert'
    });
    await alert.present();
  }

  async changeLanguage(lang: string) {
    console.log('Changing language to:', lang);
    this.currentLanguage = lang;
    this.translate.use(lang);
    localStorage.setItem('userLanguage', lang);
    
    const message = this.translate.instant('ALERTS.LANGUAGE_CHANGED');
    this.notificationService.success('Success', message, 'OK', 2000);
  }

  async logOut(): Promise<void> {
    try {
      const loading = await this.loadingController.create({
        message: 'Logging out...',
        spinner: 'crescent',
        duration: 5000
      });
      await loading.present();

      console.log('Starting logout process');
      await this.afAuth.signOut();
      await loading.dismiss();
      
      console.log('Logout successful, redirecting to login');
      this.notificationService.success('Success!', 'Logged out successfully!', 'OK', 2000);
      this.router.navigate(['/auth/login']);
    } catch (error) {
      console.error('Logout error:', error);
      this.notificationService.error('Error', 'Failed to logout. Please try again.', 'OK', 3000);
    }
  }

  navigateToAdmin(route: string) {
    this.router.navigate([`/admin/${route}`]);
  }
}
