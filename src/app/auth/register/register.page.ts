import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, AlertController, ToastController } from '@ionic/angular';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: false
})
export class RegisterPage implements OnInit {
  registerForm: FormGroup;
  showPassword = false;
  showConfirmPassword = false;
  isLoading = false;

  constructor(
    private formBuilder: FormBuilder,
    private afAuth: AngularFireAuth,
    private firestore: AngularFirestore,
    private router: Router,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private toastController: ToastController
  ) {
    this.registerForm = this.formBuilder.group({
      firstName: ['', [Validators.required, Validators.minLength(2), Validators.pattern(/^[a-zA-Z\s]*$/)]],
      lastName: ['', [Validators.required, Validators.minLength(2), Validators.pattern(/^[a-zA-Z\s]*$/)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required, Validators.pattern(/^[\+]?[1-9][\d]{0,15}$/)]],
      password: ['', [Validators.required, Validators.minLength(8), this.passwordStrengthValidator]],
      confirmPassword: ['', [Validators.required]],
      emergencyContact: ['', [Validators.required, Validators.pattern(/^[\+]?[1-9][\d]{0,15}$/)]],
      emergencyContactName: ['', [Validators.required, Validators.minLength(2), Validators.pattern(/^[a-zA-Z\s]*$/)]],
      acceptTerms: [false, [Validators.requiredTrue]]
    }, { 
      validators: [this.passwordMatchValidator, this.emergencyContactValidator] 
    });
  }

  ngOnInit() {
    // Add real-time validation feedback
    this.registerForm.valueChanges.subscribe(() => {
      this.updateFormValidation();
    });
  }

  // Custom password strength validator
  passwordStrengthValidator(control: any) {
    const value = control.value;
    if (!value) return null;

    const hasNumber = /[0-9]/.test(value);
    const hasUpper = /[A-Z]/.test(value);
    const hasLower = /[a-z]/.test(value);
    const hasSpecial = /[#?!@$%^&*-]/.test(value);

    const valid = hasNumber && hasUpper && hasLower && hasSpecial;
    
    if (!valid) {
      return { passwordStrength: true };
    }
    
    return null;
  }

  // Password match validator
  passwordMatchValidator(form: FormGroup) {
    const password = form.get('password');
    const confirmPassword = form.get('confirmPassword');
    
    if (password && confirmPassword && password.value !== confirmPassword.value) {
      confirmPassword.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }
    
    if (confirmPassword?.errors?.['passwordMismatch']) {
      delete confirmPassword.errors['passwordMismatch'];
      if (Object.keys(confirmPassword.errors).length === 0) {
        confirmPassword.setErrors(null);
      }
    }
    
    return null;
  }

  // Emergency contact validator (ensure it's different from user's phone)
  emergencyContactValidator(form: FormGroup) {
    const phone = form.get('phone');
    const emergencyContact = form.get('emergencyContact');
    
    if (phone && emergencyContact && phone.value === emergencyContact.value) {
      emergencyContact.setErrors({ sameAsUserPhone: true });
      return { sameAsUserPhone: true };
    }
    
    return null;
  }

  // Update form validation state
  updateFormValidation() {
    // This method can be used to trigger UI updates based on form state
    // Currently handled by the template, but can be extended for complex validation
  }

  // Toggle password visibility
  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  // Toggle confirm password visibility
  toggleConfirmPasswordVisibility() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  // Main registration method
  async onRegister() {
    if (this.registerForm.valid && !this.isLoading) {
      this.isLoading = true;
      
      const loading = await this.loadingController.create({
        message: 'Creating your account...',
        spinner: 'crescent',
        cssClass: 'custom-loading'
      });
      await loading.present();

      try {
        const formData = this.registerForm.value;
        const { email, password, firstName, lastName, phone, emergencyContact, emergencyContactName } = formData;
        
        // Create user with Firebase Auth
        const userCredential = await this.afAuth.createUserWithEmailAndPassword(email, password);
        
        if (userCredential.user) {
          // Update user profile
          await userCredential.user.updateProfile({
            displayName: `${firstName} ${lastName}`,
            photoURL: null
          });

          // Send email verification
          await userCredential.user.sendEmailVerification();

          // Store additional user data in Firestore
          await this.firestore.collection('users').doc(userCredential.user.uid).set({
            uid: userCredential.user.uid,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.toLowerCase().trim(),
            phone: phone.trim(),
            emergencyContact: emergencyContact.trim(),
            emergencyContactName: emergencyContactName.trim(),
            role: 'user',
            isActive: true,
            isVerified: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastLogin: new Date(),
            preferences: {
              notifications: true,
              language: 'en',
              alertRadius: 1000, // meters
              theme: 'light',
              soundEnabled: true,
              vibrationEnabled: true
            },
            location: {
              latitude: null,
              longitude: null,
              address: null,
              lastUpdated: null
            },
            stats: {
              alertsSent: 0,
              alertsReceived: 0,
              incidentsReported: 0,
              communityScore: 0
            }
          });

          // Create user settings document
          await this.firestore.collection('userSettings').doc(userCredential.user.uid).set({
            userId: userCredential.user.uid,
            privacy: {
              shareLocation: true,
              showProfile: true,
              allowDirectMessages: true
            },
            notifications: {
              emergencyAlerts: true,
              communityUpdates: true,
              safetyTips: true,
              emailNotifications: true,
              pushNotifications: true
            },
            createdAt: new Date(),
            updatedAt: new Date()
          });

          await loading.dismiss();
          this.isLoading = false;
          
          // Show success message
          const toast = await this.toastController.create({
            message: '🎉 Account created successfully! Please check your email to verify your account.',
            duration: 4000,
            color: 'success',
            position: 'top',
            cssClass: 'custom-toast'
          });
          await toast.present();

          // Navigate to verification page or home
          this.router.navigate(['/auth/verify-email'], { 
            queryParams: { email: email } 
          });
        }
      } catch (error: any) {
        await loading.dismiss();
        this.isLoading = false;
        
        let errorMessage = 'Registration failed. Please try again.';
        let errorTitle = 'Registration Error';
        
        switch (error.code) {
          case 'auth/email-already-in-use':
            errorMessage = 'This email is already registered. Please use a different email or try signing in.';
            errorTitle = 'Email Already Exists';
            break;
          case 'auth/weak-password':
            errorMessage = 'Password is too weak. Please choose a stronger password with at least 8 characters, including uppercase, lowercase, numbers, and special characters.';
            errorTitle = 'Weak Password';
            break;
          case 'auth/invalid-email':
            errorMessage = 'Please enter a valid email address.';
            errorTitle = 'Invalid Email';
            break;
          case 'auth/operation-not-allowed':
            errorMessage = 'Email/password accounts are not enabled. Please contact support.';
            errorTitle = 'Service Unavailable';
            break;
          case 'auth/network-request-failed':
            errorMessage = 'Network error. Please check your internet connection and try again.';
            errorTitle = 'Network Error';
            break;
          default:
            console.error('Registration error:', error);
            errorMessage = `Registration failed: ${error.message}`;
        }

        const alert = await this.alertController.create({
          header: errorTitle,
          message: errorMessage,
          buttons: [
            {
              text: 'OK',
              role: 'cancel',
              cssClass: 'alert-button-cancel'
            },
            {
              text: 'Try Again',
              cssClass: 'alert-button-confirm',
              handler: () => {
                // Optionally clear form or focus on problematic field
                this.focusOnFirstError();
              }
            }
          ],
          cssClass: 'custom-alert'
        });
        await alert.present();
      }
    } else {
      // Show validation errors
      this.markFormGroupTouched(this.registerForm);
      this.focusOnFirstError();
      
      const toast = await this.toastController.create({
        message: 'Please fill in all required fields correctly.',
        duration: 3000,
        color: 'warning',
        position: 'top',
        cssClass: 'custom-toast'
      });
      await toast.present();
    }
  }

  // Focus on first error field
  focusOnFirstError() {
    const firstErrorField = document.querySelector('.input-box input.ion-invalid');
    if (firstErrorField) {
      (firstErrorField as HTMLElement).focus();
    }
  }

  // Mark all form fields as touched to show validation errors
  private markFormGroupTouched(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(key => {
      const control = formGroup.get(key);
      control?.markAsTouched();
      
      if (control instanceof FormGroup) {
        this.markFormGroupTouched(control);
      }
    });
  }

  // Navigate to login page
  goToLogin() {
    this.router.navigate(['/auth/login']);
  }

  // Get error message for specific field
  getErrorMessage(fieldName: string): string {
    const field = this.registerForm.get(fieldName);
    
    if (field?.errors && field.touched) {
      if (field.errors['required']) {
        return `${this.getFieldDisplayName(fieldName)} is required`;
      }
      if (field.errors['email']) {
        return 'Please enter a valid email address';
      }
      if (field.errors['minlength']) {
        const requiredLength = field.errors['minlength'].requiredLength;
        return `${this.getFieldDisplayName(fieldName)} must be at least ${requiredLength} characters`;
      }
      if (field.errors['pattern']) {
        return this.getPatternErrorMessage(fieldName);
      }
      if (field.errors['passwordMismatch']) {
        return 'Passwords do not match';
      }
      if (field.errors['passwordStrength']) {
        return 'Password must contain uppercase, lowercase, number, and special character';
      }
      if (field.errors['sameAsUserPhone']) {
        return 'Emergency contact must be different from your phone number';
      }
    }
    
    return '';
  }

  // Get pattern-specific error messages
  private getPatternErrorMessage(fieldName: string): string {
    switch (fieldName) {
      case 'firstName':
      case 'lastName':
      case 'emergencyContactName':
        return 'Only letters and spaces are allowed';
      case 'phone':
      case 'emergencyContact':
        return 'Please enter a valid phone number';
      default:
        return `Please enter a valid ${this.getFieldDisplayName(fieldName)}`;
    }
  }

  // Get display name for field
  private getFieldDisplayName(fieldName: string): string {
    const displayNames: { [key: string]: string } = {
      firstName: 'First Name',
      lastName: 'Last Name',
      email: 'Email',
      phone: 'Phone Number',
      password: 'Password',
      confirmPassword: 'Confirm Password',
      emergencyContact: 'Emergency Contact',
      emergencyContactName: 'Emergency Contact Name',
      acceptTerms: 'Terms and Conditions'
    };
    
    return displayNames[fieldName] || fieldName;
  }

  // Get password strength indicator
  getPasswordStrength(): string {
    const password = this.registerForm.get('password')?.value;
    if (!password) return '';

    const hasNumber = /[0-9]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasSpecial = /[#?!@$%^&*-]/.test(password);
    const length = password.length;

    let strength = 0;
    if (length >= 8) strength++;
    if (hasNumber) strength++;
    if (hasUpper) strength++;
    if (hasLower) strength++;
    if (hasSpecial) strength++;

    switch (strength) {
      case 0:
      case 1:
        return 'Very Weak';
      case 2:
        return 'Weak';
      case 3:
        return 'Fair';
      case 4:
        return 'Good';
      case 5:
        return 'Strong';
      default:
        return '';
    }
  }

  // Check if form field is invalid and touched
  isFieldInvalid(fieldName: string): boolean {
    const field = this.registerForm.get(fieldName);
    return !!(field?.invalid && field?.touched);
  }

  // Check if form field is valid and touched
  isFieldValid(fieldName: string): boolean {
    const field = this.registerForm.get(fieldName);
    return !!(field?.valid && field?.touched);
  }
}
