import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, AlertController } from '@ionic/angular';
import { NotificationService } from '../../shared/services/notification.service';

// Native Firebase imports
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  updateProfile, 
  sendEmailVerification,
  fetchSignInMethodsForEmail 
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc 
} from 'firebase/firestore';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone:false,
})
export class RegisterPage implements OnInit {
  registerForm: FormGroup;
  showPassword = false;
  showConfirmPassword = false;
  isLoading = false;
  private auth: any;
  private firestore: any;

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private notificationService: NotificationService
  ) {
    // Initialize Firebase if not already initialized
    try {
      initializeApp(environment.firebaseConfig);
      console.log('✅ Firebase initialized in RegisterPage');
    } catch (error) {
      console.log('ℹ️ Firebase already initialized in RegisterPage');
    }
    
    this.auth = getAuth();
    this.firestore = getFirestore();
    
    this.registerForm = this.formBuilder.group({
      firstName: ['', [Validators.required, Validators.minLength(2), Validators.pattern(/^[a-zA-Z\s]*$/)]],
      lastName: ['', [Validators.required, Validators.minLength(2), Validators.pattern(/^[a-zA-Z\s]*$/)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required, Validators.pattern(/^09\d{9}$/)]],
      password: ['', [Validators.required, Validators.minLength(8), this.passwordStrengthValidator]],
      confirmPassword: ['', [Validators.required]],
      emergencyContact: ['', [Validators.required, Validators.pattern(/^09\d{9}$/)]],
      emergencyContactName: ['', [Validators.required, Validators.minLength(2), Validators.pattern(/^[a-zA-Z\s]*$/)]],
      acceptTerms: [false, [Validators.requiredTrue]]
    }, { 
      validators: [this.passwordMatchValidator, this.emergencyContactValidator] 
    });
  }

  ngOnInit() {
    // Debug form validation
    this.registerForm.statusChanges.subscribe(status => {
      console.log('Form status:', status);
      if (status === 'INVALID') {
        console.log('Form errors:', this.getFormErrors());
      }
    });
  }

  getFormErrors() {
    const errors: any = {};
    Object.keys(this.registerForm.controls).forEach(key => {
      const control = this.registerForm.get(key);
      if (control && control.errors) {
        errors[key] = control.errors;
      }
    });
    return errors;
  }

  passwordStrengthValidator(control: any) {
    const value = control.value;
    if (!value) return null;
    const hasNumber = /[0-9]/.test(value);
    const hasUpper = /[A-Z]/.test(value);
    const hasLower = /[a-z]/.test(value);
    const hasSpecial = /[#?!@$%^&*-]/.test(value);
    const valid = hasNumber && hasUpper && hasLower && hasSpecial;
    if (!valid) return { passwordStrength: true };
    return null;
  }

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

  emergencyContactValidator(form: FormGroup) {
    const phone = form.get('phone');
    const emergencyContact = form.get('emergencyContact');
    if (phone && emergencyContact && phone.value === emergencyContact.value) {
      emergencyContact.setErrors({ sameAsUserPhone: true });
      return { sameAsUserPhone: true };
    }
    return null;
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  toggleConfirmPassword() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  viewTerms() {
    // TODO: Implement terms of service view
    console.log('View terms of service');
  }

  viewPrivacy() {
    // TODO: Implement privacy policy view
    console.log('View privacy policy');
  }

  async onRegister() {
    if (this.registerForm.valid && !this.isLoading) {
      this.isLoading = true;
      const loading = await this.loadingController.create({
        message: 'Creating your account...',
        spinner: 'crescent'
      });
      await loading.present();

      try {
        const formData = this.registerForm.value;
        const { email, password, firstName, lastName, phone, emergencyContact, emergencyContactName } = formData;
        
        // Check if email already exists
        const methods = await fetchSignInMethodsForEmail(this.auth, email);
        if (methods && methods.length > 0) {
          await loading.dismiss();
          this.isLoading = false;
          await this.showEmailExistsAlert();
          return;
        }

        // Create user account
        const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);

        if (userCredential.user) {
          // Update user profile
          try {
            await updateProfile(userCredential.user, {
              displayName: `${firstName} ${lastName}`,
              photoURL: null
            });
          } catch (profileError) {
            console.warn('Profile update failed, but continuing with registration:', profileError);
            // Don't throw error here, continue with registration
          }

          // Send email verification (optional)
          try {
            await sendEmailVerification(userCredential.user);
          } catch (emailError) {
            console.warn('Email verification failed, but user account created:', emailError);
          }

                     // Create Firestore documents
           try {
             // Create user document
             await setDoc(doc(this.firestore, 'users', userCredential.user.uid), {
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
               lastLogin: new Date()
             });

             // Create user settings document
             await setDoc(doc(this.firestore, 'userSettings', userCredential.user.uid), {
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
           } catch (firestoreError) {
             console.error('Firestore error:', firestoreError);
             // Even if Firestore fails, the user account is created, so we should still show success
             // but log the error for debugging
           }

          // Registration successful
          await loading.dismiss();
          this.isLoading = false;
          
          this.notificationService.success(
            'Success!',
            '🎉 Account created successfully! You can now sign in with your email and password.',
            'Sign In',
            5000
          );

          this.router.navigate(['/auth/login']);
        }
      } catch (error: any) {
        await loading.dismiss();
        this.isLoading = false;
        
        console.error('Registration error:', error);
        
        let errorMessage = 'An unexpected error occurred. Please try again.';
        let errorHeader = 'Registration Error';
        
        if (error.code === 'auth/email-already-in-use') {
          errorMessage = 'This email is already registered. Please use a different email or try signing in.';
          this.registerForm.get('email')?.setErrors({ emailExists: true });
        } else if (error.code === 'auth/weak-password') {
          errorMessage = 'Password is too weak. Please choose a stronger password.';
          this.registerForm.get('password')?.setErrors({ weakPassword: true });
        } else if (error.code === 'auth/invalid-email') {
          errorMessage = 'Please enter a valid email address.';
          this.registerForm.get('email')?.setErrors({ invalidEmail: true });
        } else if (error.code === 'auth/network-request-failed') {
          errorMessage = 'Network error. Please check your internet connection and try again.';
        } else if (error.code === 'auth/too-many-requests') {
          errorMessage = 'Too many failed attempts. Please try again later.';
        } else if (error.message === 'Failed to complete user profile setup') {
          errorMessage = 'Account created but profile setup failed. Please contact support.';
          errorHeader = 'Partial Registration Success';
        }

        const alert = await this.alertController.create({
          header: errorHeader,
          message: errorMessage,
          buttons: ['OK']
        });
        await alert.present();
      }
         } else {
       this.markFormGroupTouched(this.registerForm);
       this.focusOnFirstError();
       this.notificationService.warning(
         'Warning!',
         'Please fill in all required fields correctly.',
         'OK',
         3000
       );
     }
  }

  private async showEmailExistsAlert() {
    const alert = await this.alertController.create({
      header: 'Email Already Exists',
      message: 'This email is already registered. Please use a different email or try signing in.',
      buttons: [
        {
          text: 'OK',
          handler: () => {
            this.registerForm.get('email')?.setErrors({ emailExists: true });
            this.registerForm.get('email')?.markAsTouched();
          }
        },
        {
          text: 'Sign In',
          handler: () => {
            this.router.navigate(['/auth/login']);
          }
        }
      ]
    });
    await alert.present();
  }

  focusOnFirstError() {
    const firstErrorField = document.querySelector('.input-box input.ion-invalid');
    if (firstErrorField) {
      (firstErrorField as HTMLElement).focus();
    }
  }

  private markFormGroupTouched(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(key => {
      const control = formGroup.get(key);
      control?.markAsTouched();
      if (control instanceof FormGroup) {
        this.markFormGroupTouched(control);
      }
    });
  }

  goToLogin() {
    this.router.navigate(['/auth/login']);
  }

  getErrorMessage(fieldName: string): string {
    const field = this.registerForm.get(fieldName);
    if (field?.errors && field.touched) {
      if (field.errors['required']) return `${this.getFieldDisplayName(fieldName)} is required`;
      if (field.errors['email']) return 'Please enter a valid email address';
      if (field.errors['minlength']) {
        const requiredLength = field.errors['minlength'].requiredLength;
        return `${this.getFieldDisplayName(fieldName)} must be at least ${requiredLength} characters`;
      }
      if (field.errors['pattern']) return this.getPatternErrorMessage(fieldName);
      if (field.errors['passwordMismatch']) return 'Passwords do not match';
      if (field.errors['passwordStrength']) return 'Password must contain uppercase, lowercase, number, and special character';
      if (field.errors['sameAsUserPhone']) return 'Emergency contact must be different from your phone number';
      if (field.errors['emailExists']) return 'Email already registered';
    }
    return '';
  }

  private getPatternErrorMessage(fieldName: string): string {
    switch (fieldName) {
      case 'firstName':
      case 'lastName':
      case 'emergencyContactName':
        return 'Only letters and spaces are allowed';
      case 'phone':
      case 'emergencyContact':
        return 'Phone number must be 11 digits starting with 09 (e.g., 09499382695)';
      default:
        return `Please enter a valid ${this.getFieldDisplayName(fieldName)}`;
    }
  }

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
}