import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { AuthService } from '../../services/auth.service';

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
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private authService: AuthService
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
          await this.showToast('Login successful!', 'success');
          const isAuthenticated = await this.authService.isAuthenticated();
          if (isAuthenticated) {
            this.router.navigate(['/tabs/home']);
          } else {
            await this.showAlert('Login Error', 'Authentication failed. Please try again.');
          }
        } else {
          await loading.dismiss();
          await this.showAlert('Login Failed', userCredential.error || 'Invalid credentials');
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

        const alert = await this.alertController.create({
          header: 'Login Failed',
          message: errorMessage,
          buttons: ['OK']
        });
        await alert.present();
      } finally {
        this.isLoading = false;
      }
    } else {
      await this.showToast('Please fill in all required fields correctly', 'warning');
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

      if (result.success) {
        await loading.dismiss();
        await this.showToast('Google login successful!', 'success');
        const isAuthenticated = await this.authService.isAuthenticated();
        if (isAuthenticated) {
          this.router.navigate(['/tabs/home']);
        } else {
          await this.showAlert('Login Error', 'Authentication failed. Please try again.');
        }
      } else {
        await loading.dismiss();
        await this.showAlert('Google Login Failed', result.error || 'Unable to login with Google');
      }
    } catch (error) {
      await loading.dismiss();
      console.error('Google login error:', error);
      await this.showAlert('Error', 'Google login failed. Please try again.');
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

      if (result.success) {
        await loading.dismiss();
        await this.showToast('Facebook login successful!', 'success');
        const isAuthenticated = await this.authService.isAuthenticated();
        if (isAuthenticated) {
          this.router.navigate(['/tabs/home']);
        } else {
          await this.showAlert('Login Error', 'Authentication failed. Please try again.');
        }
      } else {
        await loading.dismiss();
        await this.showAlert('Facebook Login Failed', result.error || 'Unable to login with Facebook');
      }
    } catch (error) {
      await loading.dismiss();
      console.error('Facebook login error:', error);
      await this.showAlert('Error', 'Facebook login failed. Please try again.');
    } finally {
      this.isLoading = false;
    }
  }

  async forgotPassword(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Reset Password',
      message: 'Enter your email address to receive a password reset link.',
      inputs: [
        {
          name: 'email',
          type: 'email',
          placeholder: 'Email address'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Send Reset Link',
          handler: async (data) => {
            if (data.email) {
              try {
                const result = await this.authService.resetPassword(data.email);
                if (result.success) {
                  await this.showToast('Password reset email sent!', 'success');
                  return true;
                } else {
                  await this.showAlert('Error', result.error || 'Failed to send reset email');
                  return false;
                }
              } catch (error) {
                console.error('Password reset error:', error);
                await this.showAlert('Error', 'Failed to send reset email. Please try again.');
                return false;
              }
            } else {
              await this.showToast('Please enter a valid email address', 'warning');
              return false;
            }
          }
        }
      ]
    });

    await alert.present();
  }

  goToRegister(): void {
    this.router.navigate(['/auth/register']);
  }

  private async showAlert(header: string, message: string): Promise<void> {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: ['OK']
    });
    await alert.present();
  }

  private async showToast(message: string, color: 'success' | 'warning' | 'danger' = 'success'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'top'
    });
    await toast.present();
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
