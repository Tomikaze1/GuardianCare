import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ToastController, AlertController, LoadingController, IonContent } from '@ionic/angular';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Router } from '@angular/router';
import { UserService } from '../services/user.service';
import { NotificationService } from '../shared/services/notification.service';
import { ReportService, Report } from '../services/report.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage implements OnInit, OnDestroy {
  currentLanguage = 'en';
  userRole = 'Unknown';
  userId = 'Unknown';
  
  // User profile data
  userProfile: any = null;
  userReports: Report[] = [];
  private subscriptions: Subscription[] = [];
  @ViewChild(IonContent, { static: false }) content?: IonContent;
  
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
  selectedVibrationPattern: 'gentle' | 'default' | 'strong' = 'default';
  vibrationDuration = 200;
  
  // Localization
  selectedUnit = 'Metric';
  touristTranslationMode = false;
  homeUIMode: 'sidebar' | 'buttons' = 'sidebar';
  
  // UI state: collapsible sections
  expandAccountSecurity = false;
  expandLocationAlerts = false;
  expandNotifications = false;
  expandLocalization = false;
  expandLegalSupport = false;
  
  // UI state: subpanels
  smartVibrationOptionsOpen = false;
  
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
    private loadingController: LoadingController,
    private reportService: ReportService
  ) {
    // Don't set language here - let initializeLanguage() handle it
  }

  ngOnInit() {
    // Load user profile data
    const userDataSub = this.userService.getCurrentUserData().subscribe(userData => {
      if (userData) {
        this.userProfile = userData;
        this.userRole = userData.role || 'No role set';
        this.userId = userData.uid || 'No UID';
        console.log('Current user data:', userData);
        console.log('User role:', this.userRole);
        console.log('User ID:', this.userId);
      } else {
        console.log('No user data found');
        this.userProfile = null;
      }
    });
    this.subscriptions.push(userDataSub);

    // Load user reports
    const reportsSub = this.reportService.getUserReports().subscribe(reports => {
      this.userReports = reports;
      console.log('User reports loaded:', reports.length);
    });
    this.subscriptions.push(reportsSub);
    
    this.initializeLanguage();
    this.loadSettings();
    
    // Check GPS status on page load
    this.checkGPSStatus();
  }

  ionViewWillEnter() {
    // Scroll to top whenever entering this tab
    this.content?.scrollToTop(0);
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  // Collapsible helpers
  toggleSection(section: 'account' | 'location' | 'notifications' | 'localization' | 'legal') {
    // Store the current state of the clicked section
    const isCurrentlyExpanded = this.getSectionState(section);
    
    // Close all sections first
    this.expandAccountSecurity = false;
    this.expandLocationAlerts = false;
    this.expandNotifications = false;
    this.expandLocalization = false;
    this.expandLegalSupport = false;
    
    // If the clicked section was closed, open it (if it was open, keep it closed)
    if (!isCurrentlyExpanded) {
      switch (section) {
        case 'account':
          this.expandAccountSecurity = true;
          break;
        case 'location':
          this.expandLocationAlerts = true;
          break;
        case 'notifications':
          this.expandNotifications = true;
          break;
        case 'localization':
          this.expandLocalization = true;
          break;
        case 'legal':
          this.expandLegalSupport = true;
          break;
      }
    }
  }

  // Helper method to get the current state of a section
  private getSectionState(section: 'account' | 'location' | 'notifications' | 'localization' | 'legal'): boolean {
    switch (section) {
      case 'account': return this.expandAccountSecurity;
      case 'location': return this.expandLocationAlerts;
      case 'notifications': return this.expandNotifications;
      case 'localization': return this.expandLocalization;
      case 'legal': return this.expandLegalSupport;
      default: return false;
    }
  }

  // Helper methods for user profile display
  getUserDisplayName(): string {
    if (this.userProfile) {
      return `${this.userProfile.firstName || ''} ${this.userProfile.lastName || ''}`.trim() || 'User';
    }
    return 'User';
  }

  getUserEmail(): string {
    return this.userProfile?.email || 'No email';
  }

  getUserPhone(): string {
    return this.userProfile?.phone || 'No phone number';
  }

  getEmergencyContact(): string {
    if (this.userProfile?.emergencyContactName && this.userProfile?.emergencyContact) {
      return `${this.userProfile.emergencyContactName} - ${this.userProfile.emergencyContact}`;
    }
    return 'No emergency contact set';
  }


  private initializeLanguage() {
    // Load saved language from localStorage, default to 'en' if not found
    const savedLanguage = localStorage.getItem('userLanguage') || 'en';
    this.currentLanguage = savedLanguage;
    this.translate.use(savedLanguage);
    
    console.log('Current Language loaded from localStorage:', this.currentLanguage);
  }

  private loadSettings() {
    // Load saved settings from localStorage with proper default values
    this.gpsEnabled = localStorage.getItem('gpsEnabled') !== 'false'; // Default to true
    this.timeBasedAlerts = localStorage.getItem('timeBasedAlerts') !== 'false'; // Default to true
    this.dangerZoneAlerts = localStorage.getItem('dangerZoneAlerts') !== 'false'; // Default to true
    this.doNotDisturbEnabled = localStorage.getItem('doNotDisturbEnabled') === 'true'; // Default to false
    this.smartVibration = localStorage.getItem('smartVibration') !== 'false'; // Default to true
    this.panicModeVisuals = localStorage.getItem('panicModeVisuals') !== 'false'; // Default to true
    this.touristTranslationMode = localStorage.getItem('touristTranslationMode') === 'true'; // Default to false
    this.twoFactorEnabled = localStorage.getItem('twoFactorEnabled') === 'true'; // Default to false
    this.selectedVibrationPattern = (localStorage.getItem('vibrationPattern') as any) || 'default';
    this.vibrationDuration = Number(localStorage.getItem('vibrationDuration') || 200);
    
    this.selectedAlertSound = localStorage.getItem('selectedAlertSound') || 'Default';
    this.selectedUnit = localStorage.getItem('selectedUnit') || 'Metric';
    const savedUi = localStorage.getItem('homeUIMode');
    this.homeUIMode = (savedUi === 'buttons' || savedUi === 'sidebar') ? (savedUi as any) : 'sidebar';
    
    // Load saved language
    const savedLanguage = localStorage.getItem('userLanguage') || 'en';
    this.currentLanguage = savedLanguage;
    this.translate.use(savedLanguage);
    
    console.log('Settings loaded:', {
      gpsEnabled: this.gpsEnabled,
      timeBasedAlerts: this.timeBasedAlerts,
      dangerZoneAlerts: this.dangerZoneAlerts,
      doNotDisturbEnabled: this.doNotDisturbEnabled,
      smartVibration: this.smartVibration,
      panicModeVisuals: this.panicModeVisuals,
      currentLanguage: this.currentLanguage
    });
  }

  private async checkGPSStatus() {
    if ('geolocation' in navigator) {
      try {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            console.log('GPS is working correctly');
            if (!this.gpsEnabled) {
              this.gpsEnabled = true;
              localStorage.setItem('gpsEnabled', 'true');
            }
          },
          (error) => {
            console.log('GPS access denied or unavailable');
            if (this.gpsEnabled) {
              this.gpsEnabled = false;
              localStorage.setItem('gpsEnabled', 'false');
            }
          }
        );
      } catch (error) {
        console.error('Error checking GPS status:', error);
      }
    }
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
    try {
      // Check if GPS is actually available
      if (this.gpsEnabled && 'geolocation' in navigator) {
        // Test GPS access
        navigator.geolocation.getCurrentPosition(
          (position) => {
            localStorage.setItem('gpsEnabled', this.gpsEnabled.toString());
            const message = this.gpsEnabled ? 'GPS access enabled and working' : 'GPS access disabled';
            this.notificationService.success('Success', message, 'OK', 2000);
          },
          (error) => {
            this.gpsEnabled = false;
            localStorage.setItem('gpsEnabled', 'false');
            this.notificationService.error('GPS Error', 'Unable to access GPS. Please check your location permissions.', 'OK', 3000);
          }
        );
      } else {
        localStorage.setItem('gpsEnabled', this.gpsEnabled.toString());
        const message = this.gpsEnabled ? 'GPS access enabled' : 'GPS access disabled';
        this.notificationService.success('Success', message, 'OK', 2000);
      }
    } catch (error) {
      console.error('GPS toggle error:', error);
      this.notificationService.error('Error', 'Failed to toggle GPS setting', 'OK', 3000);
    }
  }

  async toggleTimeBasedAlerts() {
    localStorage.setItem('timeBasedAlerts', this.timeBasedAlerts.toString());
    const message = this.timeBasedAlerts ? 'Time-based alerts enabled' : 'Time-based alerts disabled';
    this.notificationService.success('Success', message, 'OK', 2000);
    
    // If enabling, show a brief explanation
    if (this.timeBasedAlerts) {
      setTimeout(() => {
        this.notificationService.info('Time-Based Alerts', 'You will receive smart alerts during high-risk hours based on your location and time of day.', 'OK', 4000);
      }, 1000);
    }
  }

  async toggleDangerZoneAlerts() {
    localStorage.setItem('dangerZoneAlerts', this.dangerZoneAlerts.toString());
    const message = this.dangerZoneAlerts ? 'Danger zone alerts enabled' : 'Danger zone alerts disabled';
    this.notificationService.success('Success', message, 'OK', 2000);
    
    // If enabling, show a brief explanation
    if (this.dangerZoneAlerts) {
      setTimeout(() => {
        this.notificationService.info('Danger Zone Alerts', 'You will be notified when approaching or entering high-risk areas in your vicinity.', 'OK', 4000);
      }, 1000);
    }
  }

  async toggleDoNotDisturb() {
    localStorage.setItem('doNotDisturbEnabled', this.doNotDisturbEnabled.toString());
    const message = this.doNotDisturbEnabled ? 'Do not disturb mode enabled' : 'Do not disturb mode disabled';
    this.notificationService.success('Success', message, 'OK', 2000);
    
    // If enabling, show current schedule
    if (this.doNotDisturbEnabled) {
      setTimeout(() => {
        this.notificationService.info('Do Not Disturb Active', 'Notifications will be silenced from 10:00 PM to 6:00 AM. Tap to customize schedule.', 'OK', 4000);
      }, 1000);
    }
  }

  async doNotDisturbSettings() {
    const alert = await this.alertController.create({
      header: 'Do Not Disturb Settings',
      message: 'Configure your quiet hours when notifications will be silenced.',
      inputs: [
        {
          name: 'startTime',
          type: 'time',
          value: '22:00',
          label: 'Start Time'
        },
        {
          name: 'endTime',
          type: 'time',
          value: '06:00',
          label: 'End Time'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: (data) => {
            localStorage.setItem('dndStartTime', data.startTime);
            localStorage.setItem('dndEndTime', data.endTime);
            this.notificationService.success('Success', 'Do not disturb schedule updated!', 'OK', 2000);
          }
        }
      ]
    });
    await alert.present();
  }

  // Notifications Methods
  async toggleSmartVibration() {
    localStorage.setItem('smartVibration', this.smartVibration.toString());
    const message = this.smartVibration ? 'Smart vibration enabled' : 'Smart vibration disabled';
    this.notificationService.success('Success', message, 'OK', 2000);
    localStorage.setItem('vibrationPattern', this.selectedVibrationPattern);
    localStorage.setItem('vibrationDuration', String(this.vibrationDuration));
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

  onChangeHomeUiMode(event: CustomEvent) {
    const value = event.detail?.value as 'sidebar' | 'buttons';
    if (value === 'sidebar' || value === 'buttons') {
      this.homeUIMode = value;
      localStorage.setItem('homeUIMode', value);
      this.notificationService.success('Success', `Home UI set to ${value === 'sidebar' ? 'Sidebar' : 'Floating Buttons'}`, 'OK', 2000);
    }
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
    
    // If enabling, show explanation
    if (this.touristTranslationMode) {
      setTimeout(() => {
        this.notificationService.info('Tourist Mode Active', 'The app will provide translations and tourist-friendly information for your current location.', 'OK', 4000);
      }, 1000);
    }
  }

  // Utility method to reset all settings to defaults
  async resetToDefaults() {
    const alert = await this.alertController.create({
      header: 'Reset Settings',
      message: 'Are you sure you want to reset all settings to their default values? This action cannot be undone.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Reset',
          handler: () => {
            // Reset to default values
            this.gpsEnabled = true;
            this.timeBasedAlerts = true;
            this.dangerZoneAlerts = true;
            this.doNotDisturbEnabled = false;
            this.smartVibration = true;
            this.panicModeVisuals = true;
            this.touristTranslationMode = false;
            this.twoFactorEnabled = false;
            this.selectedAlertSound = 'Default';
            this.selectedUnit = 'Metric';
            
            // Clear localStorage and set defaults
            localStorage.removeItem('gpsEnabled');
            localStorage.removeItem('timeBasedAlerts');
            localStorage.removeItem('dangerZoneAlerts');
            localStorage.removeItem('doNotDisturbEnabled');
            localStorage.removeItem('smartVibration');
            localStorage.removeItem('panicModeVisuals');
            localStorage.removeItem('touristTranslationMode');
            localStorage.removeItem('twoFactorEnabled');
            localStorage.removeItem('selectedAlertSound');
            localStorage.removeItem('selectedUnit');
            localStorage.removeItem('dndStartTime');
            localStorage.removeItem('dndEndTime');
            
            this.notificationService.success('Success', 'All settings have been reset to defaults!', 'OK', 2000);
          }
        }
      ]
    });
    await alert.present();
  }

  // Method to check if location services are available
  async checkLocationServices() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.notificationService.success('Location Services', 'GPS is working correctly!', 'OK', 2000);
        },
        (error) => {
          let errorMessage = 'Location access denied';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Location permission denied. Please enable location access in your browser settings.';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Location information is unavailable.';
              break;
            case error.TIMEOUT:
              errorMessage = 'Location request timed out.';
              break;
          }
          this.notificationService.error('Location Error', errorMessage, 'OK', 4000);
        }
      );
    } else {
      this.notificationService.error('Location Error', 'Geolocation is not supported by this browser.', 'OK', 3000);
    }
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

  getLanguageName(langCode: string): string {
    const language = this.languages.find(lang => lang.code === langCode);
    return language ? language.name : langCode.toUpperCase();
  }

  async changeLanguage(lang: string) {
    console.log('Changing language to:', lang);
    this.currentLanguage = lang;
    this.translate.use(lang);
    localStorage.setItem('userLanguage', lang);
    
    // Force a small delay to ensure the language change is applied
    setTimeout(() => {
      const message = this.translate.instant('ALERTS.LANGUAGE_CHANGED');
      this.notificationService.success('Success', message, 'OK', 2000);
      
      // Log the current language to verify the change
      console.log('Language changed to:', this.currentLanguage);
      console.log('Translate service current lang:', this.translate.currentLang);
    }, 100);
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


}
