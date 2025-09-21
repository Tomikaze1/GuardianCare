import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Observable, Subscription } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';

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

  private userSubscription: Subscription = new Subscription();

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private userService: UserService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private translate: TranslateService
  ) {
    this.profileForm = this.fb.group({
      displayName: ['', [Validators.required, Validators.minLength(2)]],
      phone: ['', [Validators.required, Validators.pattern(/^\+?[\d\s\-\(\)]+$/)]],
      email: [{ value: '', disabled: true }]
    });
  }

  ngOnInit() {
    console.log('ProfilePage: ngOnInit called');
    this.loadUserProfile();
    
    // Expose debug methods to global scope for testing
    (window as any).profileDebug = {
      refreshProfile: () => this.refreshProfile(),
      checkProfileData: () => this.checkProfileData(),
      debugUserData: () => this.debugUserData(),
      loadUserProfile: () => this.loadUserProfile()
    };
  }

  ionViewWillEnter() {
    console.log('ProfilePage: ionViewWillEnter called');
    // Reload profile data when entering the page
    this.loadUserProfile();
  }

  // Debug method to check user data - you can call this from browser console
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

  // Method to manually refresh profile data
  async refreshProfile() {
    console.log('Manually refreshing profile...');
    await this.loadUserProfile();
  }

  // Method to check if profile data is properly loaded
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
    const loading = await this.loadingController.create({
      message: 'Loading profile...'
    });
    await loading.present();

    try {
      console.log('=== PROFILE LOADING START ===');
      
      // Try multiple ways to get current user
      let currentUser = null;
      
      // Method 1: Direct from auth service
      try {
        currentUser = await this.authService.getCurrentUser();
        console.log('Method 1 - AuthService getCurrentUser:', currentUser);
      } catch (error) {
        console.log('Method 1 failed:', error);
      }
      
      // Method 2: From AngularFireAuth
      if (!currentUser) {
        try {
          currentUser = await this.userService.getCurrentUser();
          console.log('Method 2 - UserService getCurrentUser:', currentUser);
        } catch (error) {
          console.log('Method 2 failed:', error);
        }
      }
      
      // Method 3: Check if user is already logged in via Firebase auth state
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
        
        // Use the Promise approach to avoid injection context issues
        const userData = await this.userService.getUserDataOnce(currentUser.uid);
        
        console.log('=== USER DATA FROM FIRESTORE ===');
        console.log('Raw user data:', userData);
        console.log('Data type:', typeof userData);
        console.log('Data keys:', userData ? Object.keys(userData) : 'null');
        
        if (userData) {
          // Handle both registration data format and profile format
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
          
          // Update form with user data
          this.profileForm.patchValue({
            displayName: displayName,
            phone: userData.phone || '',
            email: userData.email || ''
          });

          this.profileImage = userData.photoURL || null;
          
          // Handle emergency contacts - convert single emergency contact to array format
          if (userData.emergencyContacts && Array.isArray(userData.emergencyContacts)) {
            // Already in array format
            this.emergencyContacts = userData.emergencyContacts;
            console.log('Using existing emergency contacts array:', this.emergencyContacts);
          } else if (userData.emergencyContact && userData.emergencyContactName) {
            // Convert single emergency contact from registration to array format
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
          
          // Force form update to ensure data is displayed
          this.profileForm.updateValueAndValidity();
          
          console.log('=== FORM VALUES AFTER UPDATE ===');
          console.log('Form displayName:', this.profileForm.get('displayName')?.value);
          console.log('Form phone:', this.profileForm.get('phone')?.value);
          console.log('Form email:', this.profileForm.get('email')?.value);
          console.log('Emergency contacts count:', this.emergencyContacts.length);
          console.log('=== END USER DATA PROCESSING ===');
          
          this.showToast('Profile loaded successfully', 'success');
        } else {
          console.log('No user data found in Firestore');
          this.showToast('No user data found. Please complete your profile.', 'warning');
        }
      } else {
        console.log('No current user found');
        this.showToast('No user logged in', 'danger');
      }
    } catch (error) {
      console.error('Error in loadUserProfile:', error);
      this.showToast('Failed to load profile', 'danger');
    } finally {
      await loading.dismiss();
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
          // Split displayName into firstName and lastName if needed
          const fullName = this.profileForm.value.displayName;
          const nameParts = fullName.trim().split(' ');
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || '';

          // Validate image size before saving
          let photoURL = this.profileImage;
          if (photoURL && photoURL.startsWith('data:')) {
            const sizeInBytes = (photoURL.length * 3) / 4; // Approximate byte size
            const maxSize = 1000000; // 1MB limit
            
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
            photoURL: photoURL,
            emergencyContacts: this.emergencyContacts,
            // Keep the original single emergency contact format for backward compatibility
            emergencyContact: this.emergencyContacts.length > 0 ? this.emergencyContacts[0].phone : '',
            emergencyContactName: this.emergencyContacts.length > 0 ? this.emergencyContacts[0].name : '',
            updatedAt: new Date()
          };

          await this.userService.updateUserData(currentUser.uid, updateData);
          this.isEditing = false;
          this.showToast('Profile updated successfully', 'success');
        }
      } catch (error) {
        console.error('Error updating profile:', error);
        this.showToast('Failed to update profile', 'danger');
      } finally {
        await loading.dismiss();
      }
    }
  }

  async selectProfileImage() {
    try {
      const image = await Camera.getPhoto({
        quality: 60, // Reduced quality to reduce file size
        allowEditing: true,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos
      });

      if (image.dataUrl) {
        // Compress the image to reduce base64 size
        const compressedImage = await this.compressImage(image.dataUrl);
        this.profileImage = compressedImage;
        this.showToast('Image selected successfully', 'success');
      }
    } catch (error: any) {
      // Handle user cancellation gracefully
      if (error.message && error.message.includes('User cancelled')) {
        console.log('User cancelled image selection');
        return; // Don't show error toast for user cancellation
      }
      
      console.error('Error selecting image:', error);
      this.showToast('Failed to select image', 'danger');
    }
  }

  private async compressImage(dataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        // Calculate new dimensions to reduce file size
        let { width, height } = img;
        const maxWidth = 300; // Maximum width
        const maxHeight = 300; // Maximum height
        
        // Calculate scaling factor
        const scaleFactor = Math.min(maxWidth / width, maxHeight / height);
        
        if (scaleFactor < 1) {
          width = width * scaleFactor;
          height = height * scaleFactor;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Draw and compress
        ctx?.drawImage(img, 0, 0, width, height);
        
        // Convert to base64 with compression
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7); // 70% quality
        
        // Check if compressed image is still too large
        const sizeInBytes = (compressedDataUrl.length * 3) / 4; // Approximate byte size
        const maxSize = 800000; // 800KB limit (leaving some buffer under 1MB)
        
        if (sizeInBytes > maxSize) {
          // Further compress if still too large
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
          }, 'image/jpeg', 0.5); // Even lower quality
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
              this.showToast('Please fill in all fields', 'warning');
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
              this.showToast('Please fill in all fields', 'warning');
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
      // Reset form if cancelled - use the original user data
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
      duration: 3000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }
}
