import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: false
})
export class RegisterPage {
  fullName = '';
  phoneNumber = '';
  email = '';
  password = '';
  confirmPassword = '';
  emergencyContact = '';
  error = '';
  showPassword = false;
  showConfirmPassword = false;
  acceptTerms = false;
  passwordStrength = 'weak';

  constructor(private router: Router) {}

  async onRegister() {
    this.error = '';
    
    // Validation
    if (!this.isFormValid()) {
      this.error = 'Please fill in all required fields and accept the terms.';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.error = 'Passwords do not match.';
      return;
    }

    if (this.passwordStrength === 'weak') {
      this.error = 'Please choose a stronger password.';
      return;
    }

    try {
      // TODO: Replace with real Firebase Auth call
      // await this.authService.register({
      //   fullName: this.fullName,
      //   phoneNumber: this.phoneNumber,
      //   email: this.email,
      //   password: this.password,
      //   emergencyContact: this.emergencyContact
      // });
      
      // Simulate loading
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Success: Go to main app tabs (map/home)
      this.router.navigate(['/tabs/home']);
    } catch (err) {
      this.error = 'Registration failed. Please try again.';
    }
  }

  isFormValid(): boolean {
    return !!(
      this.fullName.trim() &&
      this.phoneNumber.trim() &&
      this.email.trim() &&
      this.password &&
      this.confirmPassword &&
      this.acceptTerms
    );
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  // Password strength checker
  ngOnInit() {
    // Watch for password changes
    setInterval(() => {
      this.updatePasswordStrength();
    }, 500);
  }

  updatePasswordStrength() {
    if (!this.password) {
      this.passwordStrength = 'weak';
      return;
    }

    let score = 0;
    
    // Length check
    if (this.password.length >= 8) score++;
    if (this.password.length >= 12) score++;
    
    // Character variety checks
    if (/[a-z]/.test(this.password)) score++;
    if (/[A-Z]/.test(this.password)) score++;
    if (/[0-9]/.test(this.password)) score++;
    if (/[^A-Za-z0-9]/.test(this.password)) score++;

    // Set strength based on score
    if (score <= 2) {
      this.passwordStrength = 'weak';
    } else if (score <= 4) {
      this.passwordStrength = 'fair';
    } else if (score <= 5) {
      this.passwordStrength = 'good';
    } else {
      this.passwordStrength = 'strong';
    }
  }

  getPasswordStrengthText(): string {
    switch (this.passwordStrength) {
      case 'weak': return 'Weak';
      case 'fair': return 'Fair';
      case 'good': return 'Good';
      case 'strong': return 'Strong';
      default: return 'Weak';
    }
  }

  goBack() {
    this.router.navigate(['/auth/login']);
  }

  goToLogin() {
    this.router.navigate(['/auth/login']);
  }

  openTerms() {
    // TODO: Open terms of service modal or page
    console.log('Opening Terms of Service');
  }

  openPrivacy() {
    // TODO: Open privacy policy modal or page
    console.log('Opening Privacy Policy');
  }

  async registerWithGoogle() {
    try {
      // TODO: Implement Google OAuth registration
      console.log('Google registration');
    } catch (error) {
      this.error = 'Google registration failed. Please try again.';
    }
  }

  async registerWithApple() {
    try {
      // TODO: Implement Apple OAuth registration
      console.log('Apple registration');
    } catch (error) {
      this.error = 'Apple registration failed. Please try again.';
    }
  }
}