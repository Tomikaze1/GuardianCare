import { Component, OnInit, ViewChild } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Observable, Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { AngularFireAuth } from '@angular/fire/compat/auth';

import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';
import { NotificationService } from '../shared/services/notification.service';

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string;
}

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false,
})
export class ProfilePage implements OnInit {
  profileForm: FormGroup;
  emergencyContacts: EmergencyContact[] = [];
  userProfile: any = null;
  profileImage: string | null = null;
  isEditing = false;
  isEditingContact = false;
  editingContactId: string | null = null;

  currentLanguage = 'en';
  twoFactorEnabled = false;
  gpsEnabled = true;
  timeBasedAlerts = true;
  dangerZoneAlerts = true;
  smartVibration = true;
  selectedAlertSound = 'Default';
  selectedVibrationPattern: 'gentle' | 'default' | 'strong' = 'default';
  selectedUnit = 'Metric';
  
  expandAccountSecurity = false;
  expandLocationAlerts = false;
  expandNotifications = false;
  expandLocalization = false;
  expandLegalSupport = false;

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

  private userSubscription: Subscription = new Subscription();
  @ViewChild(IonContent, { static: false }) content?: IonContent;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private userService: UserService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private translate: TranslateService,
    private router: Router,
    private afAuth: AngularFireAuth,
    private notificationService: NotificationService
  ) {
    this.profileForm = this.fb.group({
      displayName: ['', [Validators.required, Validators.minLength(2)]],
      phone: ['', [Validators.required, Validators.pattern(/^\+?[\d\s\-\(\)]+$/)]],
      email: ['', [Validators.required, Validators.email]],
      address: ['']
    });
  }

  ngOnInit() {
    console.log('ProfilePage: ngOnInit called');

    (window as any).profileDebug = {
      refreshProfile: () => this.refreshProfile(),
      checkProfileData: () => this.checkProfileData(),
      debugUserData: () => this.debugUserData(),
      loadUserProfile: () => this.loadUserProfile()
    };
  }

  ionViewWillEnter() {
    console.log('ProfilePage: ionViewWillEnter called');

    this.content?.scrollToTop(0);

    this.loadUserProfile();
  }

  async handleRefresh(event: any) {
    try {
      await this.loadUserProfile();
    } finally {
      setTimeout(() => event.target.complete(), 400);
    }
  }

  async debugUserData() {
    try {
      const currentUser = await this.authService.getCurrentUser();
      console.log('=== DEBUG USER DATA ===');
      console.log('Current User:', currentUser);
      
      if (currentUser) {
        const userData = await this.userService.getUserDataOnce(currentUser.uid);
        console.log('User Data from Firestore:', userData);
        console.log('=== END DEBUG ===');
      }
    } catch (error) {
      console.error('Debug error:', error);
    }
  }


  async refreshProfile() {
    console.log('Manually refreshing profile...');

    const loading = await this.loadingController.create({
      message: 'Refreshing profile...'
    });
    await loading.present();
    try {
      await this.loadUserProfile();
    } finally {

      setTimeout(() => loading.dismiss(), 400);
    }
  }

  checkProfileData() {
    console.log('=== PROFILE DATA CHECK ===');
    console.log('User Profile Object:', this.userProfile);
    console.log('Form Values:', this.profileForm.value);
    console.log('Emergency Contacts:', this.emergencyContacts);
    console.log('Profile Image:', this.profileImage);
    console.log('Is Editing:', this.isEditing);
    console.log('=== END PROFILE DATA CHECK ===');
  }


  ngOnDestroy() {
    this.userSubscription.unsubscribe();
  }

  async loadUserProfile() {
    try {
      console.log('=== PROFILE LOADING START ===');
      

      let currentUser = null;
      
      try {
        currentUser = await this.authService.getCurrentUser();
        console.log('Method 1 - AuthService getCurrentUser:', currentUser);
      } catch (error) {
        console.log('Method 1 failed:', error);
      }
      
      if (!currentUser) {
        try {
          currentUser = await this.userService.getCurrentUser();
          console.log('Method 2 - UserService getCurrentUser:', currentUser);
        } catch (error) {
          console.log('Method 2 failed:', error);
        }
      }
      
      if (!currentUser) {
        try {
          const auth = (window as any).firebase?.auth?.();
          if (auth) {
            currentUser = auth.currentUser;
            console.log('Method 3 - Direct Firebase auth:', currentUser);
          }
        } catch (error) {
          console.log('Method 3 failed:', error);
        }
      }
      
      console.log('Final current user:', currentUser);
      
      if (currentUser && currentUser.uid) {
        console.log('User UID:', currentUser.uid);
        

        const userData = await this.userService.getUserDataOnce(currentUser.uid);
        
        console.log('=== USER DATA FROM FIRESTORE ===');
        console.log('Raw user data:', userData);
        console.log('Data type:', typeof userData);
        console.log('Data keys:', userData ? Object.keys(userData) : 'null');
        
        if (userData) {
          const displayName = userData.displayName || 
                            (userData.firstName && userData.lastName ? 
                             `${userData.firstName} ${userData.lastName}` : '');
          
          console.log('=== PROFILE DATA EXTRACTION ===');
          console.log('First name:', userData.firstName);
          console.log('Last name:', userData.lastName);
          console.log('Display name resolved to:', displayName);
          console.log('Phone:', userData.phone);
          console.log('Email:', userData.email);
          console.log('Emergency contact name:', userData.emergencyContactName);
          console.log('Emergency contact phone:', userData.emergencyContact);
          

          this.profileForm.patchValue({
            displayName: displayName,
            phone: userData.phone || '',
            email: userData.email || '',
            address: userData.address || ''
          });

          this.profileImage = userData.photoURL || null;
          

          if (userData.emergencyContacts && Array.isArray(userData.emergencyContacts)) {
            this.emergencyContacts = userData.emergencyContacts;
            console.log('Using existing emergency contacts array:', this.emergencyContacts);
          } else if (userData.emergencyContact && userData.emergencyContactName) {
            this.emergencyContacts = [{
              id: '1',
              name: userData.emergencyContactName,
              phone: userData.emergencyContact,
              relationship: 'Emergency Contact'
            }];
            console.log('Converted single emergency contact to array:', this.emergencyContacts);
          } else {
            this.emergencyContacts = [];
            console.log('No emergency contacts found - checking individual fields:');
            console.log('- emergencyContact:', userData.emergencyContact);
            console.log('- emergencyContactName:', userData.emergencyContactName);
          }
          
          this.userProfile = userData;
          
          this.profileForm.updateValueAndValidity();
          
          console.log('=== FORM VALUES AFTER UPDATE ===');
          console.log('Form displayName:', this.profileForm.get('displayName')?.value);
          console.log('Form phone:', this.profileForm.get('phone')?.value);
          console.log('Form email:', this.profileForm.get('email')?.value);
          console.log('Emergency contacts count:', this.emergencyContacts.length);
          console.log('=== END USER DATA PROCESSING ===');
          

        } else {
          console.log('No user data found in Firestore');
        }
      } else {
        console.log('No current user found');
      }
    } catch (error) {
      console.error('Error in loadUserProfile:', error);
    }
  }

  async updateProfile() {
    if (this.profileForm.valid) {
      const loading = await this.loadingController.create({
        message: 'Updating profile...'
      });
      await loading.present();

      try {
        const currentUser = await this.authService.getCurrentUser();
        if (currentUser) {
          const fullName = this.profileForm.value.displayName;
          const nameParts = fullName.trim().split(' ');
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || '';

          let photoURL = this.profileImage;
          if (photoURL && photoURL.startsWith('data:')) {
            const sizeInBytes = (photoURL.length * 3) / 4;
            const maxSize = 1000000;
            
            if (sizeInBytes > maxSize) {
              console.warn('Image size exceeds Firebase limit, compressing further...');
              photoURL = await this.compressImage(photoURL);
            }
          }

          const updateData = {
            displayName: fullName,
            firstName: firstName,
            lastName: lastName,
            phone: this.profileForm.value.phone,
            email: this.profileForm.value.email,
            address: this.profileForm.value.address || '',
            photoURL: photoURL,
            emergencyContacts: this.emergencyContacts,
            emergencyContact: this.emergencyContacts.length > 0 ? this.emergencyContacts[0].phone : '',
            emergencyContactName: this.emergencyContacts.length > 0 ? this.emergencyContacts[0].name : '',
            updatedAt: new Date()
          };

          await this.userService.updateUserData(currentUser.uid, updateData);
          this.isEditing = false;
        }
      } catch (error) {
        console.error('Error updating profile:', error);
      } finally {
        await loading.dismiss();
      }
    }
  }

  async selectProfileImage() {
    try {
      const image = await Camera.getPhoto({
        quality: 60,
        allowEditing: true,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos
      });

      if (image.dataUrl) {
        const compressedImage = await this.compressImage(image.dataUrl);
        this.profileImage = compressedImage;
      }
    } catch (error: any) {
      if (error.message && error.message.includes('User cancelled')) {
        console.log('User cancelled image selection');
        return; 
      }
      
      console.error('Error selecting image:', error);
    }
  }

  private async compressImage(dataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        let { width, height } = img;
        const maxWidth = 300; 
        const maxHeight = 300;
        
        const scaleFactor = Math.min(maxWidth / width, maxHeight / height);
        
        if (scaleFactor < 1) {
          width = width * scaleFactor;
          height = height * scaleFactor;
        }
        
        canvas.width = width;
        canvas.height = height;
        

        ctx?.drawImage(img, 0, 0, width, height);
        

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7); 
        

        const sizeInBytes = (compressedDataUrl.length * 3) / 4; 
        const maxSize = 800000; 
        
        if (sizeInBytes > maxSize) {
          canvas.toBlob((blob) => {
            if (blob) {
              const reader = new FileReader();
              reader.onload = () => {
                resolve(reader.result as string);
              };
              reader.readAsDataURL(blob);
            } else {
              resolve(compressedDataUrl);
            }
          }, 'image/jpeg', 0.5); 
        } else {
          resolve(compressedDataUrl);
        }
      };
      
      img.src = dataUrl;
    });
  }

  async addEmergencyContact() {
    const alert = await this.alertController.create({
      header: 'Add Emergency Contact',
      inputs: [
        {
          name: 'name',
          type: 'text',
          placeholder: 'Full Name'
        },
        {
          name: 'phone',
          type: 'tel',
          placeholder: 'Phone Number'
        },
        {
          name: 'relationship',
          type: 'text',
          placeholder: 'Relationship (e.g., Father, Mother, Friend)'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Add',
          handler: (data) => {
            if (data.name && data.phone && data.relationship) {
              const newContact: EmergencyContact = {
                id: Date.now().toString(),
                name: data.name,
                phone: data.phone,
                relationship: data.relationship
              };
              this.emergencyContacts.push(newContact);
            } else {
            }
          }
        }
      ]
    });

    await alert.present();
  }

  async editEmergencyContact(contact: EmergencyContact) {
    const alert = await this.alertController.create({
      header: 'Edit Emergency Contact',
      inputs: [
        {
          name: 'name',
          type: 'text',
          placeholder: 'Full Name',
          value: contact.name
        },
        {
          name: 'phone',
          type: 'tel',
          placeholder: 'Phone Number',
          value: contact.phone
        },
        {
          name: 'relationship',
          type: 'text',
          placeholder: 'Relationship',
          value: contact.relationship
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Update',
          handler: (data) => {
            if (data.name && data.phone && data.relationship) {
              const index = this.emergencyContacts.findIndex(c => c.id === contact.id);
              if (index !== -1) {
                this.emergencyContacts[index] = {
                  ...contact,
                  name: data.name,
                  phone: data.phone,
                  relationship: data.relationship
                };
              }
            } else {
            }
          }
        }
      ]
    });

    await alert.present();
  }

  async deleteEmergencyContact(contact: EmergencyContact) {
    const alert = await this.alertController.create({
      header: 'Delete Contact',
      message: `Are you sure you want to delete ${contact.name}?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            this.emergencyContacts = this.emergencyContacts.filter(c => c.id !== contact.id);
          }
        }
      ]
    });

    await alert.present();
  }

  toggleEdit() {
    this.isEditing = !this.isEditing;
    if (!this.isEditing) {
      const displayName = this.userProfile?.displayName || 
                         (this.userProfile?.firstName && this.userProfile?.lastName ? 
                          `${this.userProfile.firstName} ${this.userProfile.lastName}` : '');
      
      this.profileForm.patchValue({
        displayName: displayName,
        phone: this.userProfile?.phone || '',
        email: this.userProfile?.email || ''
      });
      
      console.log('Form reset to original values:', this.profileForm.value);
    } else {
      console.log('Entering edit mode');
    }
  }

  private async showToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastController.create({
      message,
      duration: 2200,
      color,
      position: 'top',
      cssClass: 'toast-top'
    });
    await toast.present();
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

  toggleSection(section: string) {
    switch (section) {
      case 'account':
        this.expandAccountSecurity = !this.expandAccountSecurity;
        break;
      case 'location':
        this.expandLocationAlerts = !this.expandLocationAlerts;
        break;
      case 'notifications':
        this.expandNotifications = !this.expandNotifications;
        break;
      case 'localization':
        this.expandLocalization = !this.expandLocalization;
        break;
      case 'legal':
        this.expandLegalSupport = !this.expandLegalSupport;
        break;
    }
  }


  async toggleTwoFactor() {
    console.log('Two-factor authentication toggled:', this.twoFactorEnabled);
    await this.showToast('Two-factor authentication setting updated', 'success');
  }

  async changePassword() {
    const alert = await this.alertController.create({
      header: 'Change Password',
      message: 'Password change functionality will be implemented here.',
      buttons: ['OK']
    });
    await alert.present();
  }

  async updateEmail() {
    const alert = await this.alertController.create({
      header: 'Update Email',
      message: 'Email update functionality will be implemented here.',
      buttons: ['OK']
    });
    await alert.present();
  }

  async toggleGPS() {
    console.log('GPS tracking toggled:', this.gpsEnabled);
    await this.showToast('GPS setting updated', 'success');
  }

  async toggleDangerZoneAlerts() {
    console.log('Danger zone alerts toggled:', this.dangerZoneAlerts);
    await this.showToast('Danger zone alerts setting updated', 'success');
  }

  async toggleTimeBasedAlerts() {
    console.log('Time-based alerts toggled:', this.timeBasedAlerts);
    await this.showToast('Time-based alerts setting updated', 'success');
  }


  async toggleSmartVibration() {
    console.log('Smart vibration toggled:', this.smartVibration);
    await this.showToast('Smart vibration setting updated', 'success');
  }

  async changeAlertSound(event: any) {
    console.log('Alert sound changed:', event.detail.value);
    await this.showToast(`Alert sound changed to ${event.detail.value}`, 'success');
  }

  async changeVibrationPattern(event: any) {
    console.log('Vibration pattern changed:', event.detail.value);
    await this.showToast(`Vibration pattern changed to ${event.detail.value}`, 'success');
  }

  async changeLanguage(event: any) {
    const newLanguage = event.detail.value;
    this.currentLanguage = newLanguage;
    this.translate.use(newLanguage);
    console.log('Language changed to:', newLanguage);
    await this.showToast(`Language changed to ${this.languages.find(l => l.code === newLanguage)?.name}`, 'success');
  }

  async changeUnit(event: any) {
    console.log('Unit system changed:', event.detail.value);
    await this.showToast(`Unit system changed to ${event.detail.value}`, 'success');
  }

  async showPrivacyPolicy() {
    const alert = await this.alertController.create({
      header: 'Privacy Policy',
      message: 'Privacy policy will be displayed here.',
      buttons: ['OK']
    });
    await alert.present();
  }

  async showTermsOfService() {
    const alert = await this.alertController.create({
      header: 'Terms of Service',
      message: 'Terms of service will be displayed here.',
      buttons: ['OK']
    });
    await alert.present();
  }

  async contactSupport() {
    const alert = await this.alertController.create({
      header: 'Contact Support',
      message: 'Support contact information will be displayed here.',
      buttons: ['OK']
    });
    await alert.present();
  }

  async alertSounds() {
    const alert = await this.alertController.create({
      header: 'Alert Sounds',
      inputs: this.alertSoundOptions.map(sound => ({
        name: 'alertSound',
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
          handler: (data) => {
            if (data) {
              this.selectedAlertSound = data;
              this.showToast(`Alert sound changed to ${data}`, 'success');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async languagePreference() {
    const alert = await this.alertController.create({
      header: 'Language Preference',
      inputs: this.languages.map(lang => ({
        name: 'language',
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
          handler: (data) => {
            if (data) {
              this.currentLanguage = data;
              this.translate.use(data);
              const selectedLang = this.languages.find(l => l.code === data);
              this.showToast(`Language changed to ${selectedLang?.name}`, 'success');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async unitPreference() {
    const alert = await this.alertController.create({
      header: 'Unit System',
      inputs: this.unitOptions.map(unit => ({
        name: 'unit',
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
          handler: (data) => {
            if (data) {
              this.selectedUnit = data;
              this.showToast(`Unit system changed to ${data}`, 'success');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  getCurrentLanguageName(): string {
    const lang = this.languages.find(l => l.code === this.currentLanguage);
    return lang ? lang.name : 'English';
  }
}
