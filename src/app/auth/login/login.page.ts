import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController } from '@ionic/angular';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../shared/services/notification.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage implements OnInit {
  loginForm: FormGroup;
  showPassword = false;
  isLoading = false;

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private loadingController: LoadingController,
    private authService: AuthService,
    private notificationService: NotificationService
  ) {
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit(): void {
    this.initializeApp();
  }

  private async initializeApp(): Promise<void> {
    try {
      await this.checkAuthStatus();
    } catch (error) {
      console.error('App initialization error:', error);
    }
  }

  async checkAuthStatus(): Promise<void> {
    const isAuthenticated = await this.authService.isAuthenticated();
    if (isAuthenticated) {
      this.router.navigate(['/tabs/home']);
    }
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  async onLogin(): Promise<void> {
    if (this.loginForm.valid && !this.isLoading) {
      this.isLoading = true;

      const loading = await this.loadingController.create({
        message: 'Logging in...',
        spinner: 'crescent',
      });
      await loading.present();

      const { email, password } = this.loginForm.value;

      try {
        const userCredential = await this.authService.login(email, password);

        if (userCredential.success) {
          await loading.dismiss();
          this.notificationService.success('Success!', 'Login successful!', 'OK', 3000);
          const isAuthenticated = await this.authService.isAuthenticated();
          if (isAuthenticated) {
            this.router.navigate(['/tabs/home']);
          } else {
            this.notificationService.error('Login Error', 'Authentication failed. Please try again.', 'OK', 5000);
          }
        } else {
          await loading.dismiss();
          this.notificationService.error('Login Failed', userCredential.error || 'Invalid credentials', 'OK', 5000);
        }
      } catch (error: any) {
        await loading.dismiss();
        this.isLoading = false;

        console.error('Login error details:', error);
        let errorMessage = 'An error occurred. Please try again.';
        
        if (error.code) {
          errorMessage = this.getErrorMessage(error.code);
        } else if (error.message) {
          errorMessage = error.message;
        }

        this.notificationService.error('Login Failed', errorMessage, 'OK', 5000);
      }
    } else {
      this.notificationService.warning('Invalid Form', 'Please check your input and try again.', 'OK', 3000);
    }
  }

  async loginWithGoogle(): Promise<void> {
    if (this.isLoading) return;
    
    this.isLoading = true;
    const loading = await this.loadingController.create({
      message: 'Logging in with Google...',
      spinner: 'crescent',
    });
    await loading.present();

    try {
      const result = await this.authService.loginWithGoogle();
      await loading.dismiss();

      if (result.success) {
        this.notificationService.success('Success!', 'Google login successful!', 'OK', 3000);
        const isAuthenticated = await this.authService.isAuthenticated();
        if (isAuthenticated) {
          this.router.navigate(['/tabs/home']);
        } else {
          this.notificationService.error('Login Error', 'Authentication failed. Please try again.', 'OK', 5000);
        }
      } else {
        this.notificationService.error('Google Login Failed', result.error || 'Unable to login with Google', 'OK', 5000);
      }
    } catch (error) {
      await loading.dismiss();
      console.error('Google login error:', error);
      this.notificationService.error('Error', 'Google login failed. Please try again.', 'OK', 5000);
    } finally {
      this.isLoading = false;
    }
  }

  async loginWithFacebook(): Promise<void> {
    if (this.isLoading) return;
    
    this.isLoading = true;
    const loading = await this.loadingController.create({
      message: 'Logging in with Facebook...',
      spinner: 'crescent',
    });
    await loading.present();

    try {
      const result = await this.authService.loginWithFacebook();
      await loading.dismiss();

      if (result.success) {
        this.notificationService.success('Success!', 'Facebook login successful!', 'OK', 3000);
        const isAuthenticated = await this.authService.isAuthenticated();
        if (isAuthenticated) {
          this.router.navigate(['/tabs/home']);
        } else {
          this.notificationService.error('Login Error', 'Authentication failed. Please try again.', 'OK', 5000);
        }
      } else {
        this.notificationService.error('Facebook Login Failed', result.error || 'Unable to login with Facebook', 'OK', 5000);
      }
    } catch (error) {
      await loading.dismiss();
      console.error('Facebook login error:', error);
      this.notificationService.error('Error', 'Facebook login failed. Please try again.', 'OK', 5000);
    } finally {
      this.isLoading = false;
    }
  }

  async forgotPassword(): Promise<void> {
    const email = prompt('Enter your email address to receive a password reset link:');
    
    if (email) {
      try {
        const result = await this.authService.resetPassword(email);
        if (result.success) {
          this.notificationService.success('Success!', 'Password reset email sent!', 'OK', 3000);
        } else {
          this.notificationService.error('Error', result.error || 'Failed to send reset email', 'OK', 5000);
        }
      } catch (error) {
        console.error('Password reset error:', error);
        this.notificationService.error('Error', 'Failed to send reset email. Please try again.', 'OK', 5000);
      }
    } else if (email !== null) {
      this.notificationService.warning('Invalid Email', 'Please enter a valid email address', 'OK', 3000);
    }
  }

  goToRegister(): void {
    this.router.navigate(['/auth/register']);
  }

  private getErrorMessage(errorCode: string): string {
    switch (errorCode) {
      case 'auth/user-not-found': return 'No user found with this email address.';
      case 'auth/wrong-password': return 'Incorrect password.';
      case 'auth/invalid-email': return 'Invalid email address.';
      case 'auth/user-disabled': return 'This account has been disabled.';
      case 'auth/too-many-requests': return 'Too many failed attempts. Please try again later.';
      case 'auth/network-request-failed': return 'Network error. Please check your connection.';
      default: return 'An error occurred. Please try again.';
    }
  }
}
