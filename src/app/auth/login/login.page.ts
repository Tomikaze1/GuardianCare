import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage {
  email = '';
  password = '';
  error = '';
  showPassword = false;
  rememberMe = false;

  constructor(private router: Router) {}

  async onLogin() {
    this.error = '';
    
    // Basic validation
    if (!this.email || !this.password) {
      this.error = 'Please fill in all required fields.';
      return;
    }

    try {
      // TODO: Replace with real Firebase Auth call
      // await this.authService.login(this.email, this.password);
      
      // Simulate loading
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Success: Go to main app tabs (map/home)
      this.router.navigate(['/tabs/home']);
    } catch (err) {
      this.error = 'Login failed. Please check your credentials and try again.';
    }
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  goToRegister() {
    this.router.navigate(['/auth/register']);
  }

  goToForgotPassword() {
    this.router.navigate(['/auth/forgot-password']);
  }

  async loginWithGoogle() {
    try {
      // TODO: Implement Google OAuth
      console.log('Google login');
    } catch (error) {
      this.error = 'Google login failed. Please try again.';
    }
  }

  async loginWithApple() {
    try {
      // TODO: Implement Apple OAuth
      console.log('Apple login');
    } catch (error) {
      this.error = 'Apple login failed. Please try again.';
    }
  }
}