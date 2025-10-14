import { Component, OnInit } from '@angular/core';
import { AdminNotificationService, ZoneNotificationSettings } from '../../services/admin-notification.service';
import { AlertController } from '@ionic/angular';

/**
 * Zone Notification Settings Component
 * 
 * Allows users to customize location-based zone notification preferences:
 * - Notification radius (how far to receive alerts)
 * - Distance thresholds (nearby, very close)
 * - Toggle features on/off
 */
@Component({
  selector: 'app-zone-notification-settings',
  templateUrl: './zone-notification-settings.component.html',
  styleUrls: ['./zone-notification-settings.component.scss']
})
export class ZoneNotificationSettingsComponent implements OnInit {
  settings: ZoneNotificationSettings = {
    notificationRadiusKm: 10,
    nearbyThresholdKm: 1,
    closeThresholdKm: 0.5,
    enableLocationNotifications: true,
    enableTimeInformation: true
  };

  // UI state
  radiusOptions = [
    { value: 1, label: '1 km' },
    { value: 3, label: '3 km' },
    { value: 5, label: '5 km' },
    { value: 10, label: '10 km (Default)' },
    { value: 15, label: '15 km' },
    { value: 20, label: '20 km' },
    { value: 30, label: '30 km' },
    { value: 50, label: '50 km' }
  ];

  constructor(
    private adminNotificationService: AdminNotificationService,
    private alertController: AlertController
  ) {}

  ngOnInit() {
    this.loadSettings();
  }

  /**
   * Load current settings from service
   */
  loadSettings() {
    this.settings = this.adminNotificationService.getNotificationSettings();
    console.log('📥 Loaded settings:', this.settings);
  }

  /**
   * Save settings to service
   */
  saveSettings() {
    this.adminNotificationService.updateNotificationSettings(this.settings);
    console.log('💾 Settings saved:', this.settings);
  }

  /**
   * Update notification radius
   */
  onRadiusChange(event: any) {
    this.settings.notificationRadiusKm = event.detail.value;
    this.saveSettings();
  }

  /**
   * Update nearby threshold
   */
  onNearbyThresholdChange(event: any) {
    this.settings.nearbyThresholdKm = event.detail.value;
    this.saveSettings();
  }

  /**
   * Update close threshold
   */
  onCloseThresholdChange(event: any) {
    this.settings.closeThresholdKm = event.detail.value;
    this.saveSettings();
  }

  /**
   * Toggle location notifications
   */
  onLocationNotificationsToggle(event: any) {
    this.settings.enableLocationNotifications = event.detail.checked;
    this.saveSettings();
  }

  /**
   * Toggle time information
   */
  onTimeInformationToggle(event: any) {
    this.settings.enableTimeInformation = event.detail.checked;
    this.saveSettings();
  }

  /**
   * Reset settings to defaults with confirmation
   */
  async resetToDefaults() {
    const alert = await this.alertController.create({
      header: 'Reset Settings',
      message: 'Are you sure you want to reset all notification settings to defaults?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Reset',
          handler: () => {
            this.adminNotificationService.resetNotificationSettings();
            this.loadSettings();
            this.showResetConfirmation();
          }
        }
      ]
    });

    await alert.present();
  }

  /**
   * Show confirmation after reset
   */
  async showResetConfirmation() {
    const alert = await this.alertController.create({
      header: 'Settings Reset',
      message: 'Notification settings have been reset to defaults.',
      buttons: ['OK']
    });

    await alert.present();
  }

  /**
   * Show information about notification radius
   */
  async showRadiusInfo() {
    const alert = await this.alertController.create({
      header: 'Notification Radius',
      message: `The notification radius determines how far away a new zone can be for you to receive an alert.
      
      Current setting: ${this.settings.notificationRadiusKm}km
      
      You will receive notifications for new zones within ${this.settings.notificationRadiusKm}km of your current location.`,
      buttons: ['OK']
    });

    await alert.present();
  }

  /**
   * Show information about distance thresholds
   */
  async showThresholdInfo() {
    const alert = await this.alertController.create({
      header: 'Distance Thresholds',
      message: `Distance thresholds determine how notifications are classified:
      
      🚨 Very Close: < ${this.settings.closeThresholdKm}km
      ⚠️ Nearby: < ${this.settings.nearbyThresholdKm}km
      📍 In Your Area: < 5km
      📍 Near You: < ${this.settings.notificationRadiusKm}km
      
      Closer zones receive higher priority notifications.`,
      buttons: ['OK']
    });

    await alert.present();
  }

  /**
   * Get formatted distance text
   */
  getDistanceText(km: number): string {
    if (km < 1) {
      return `${km * 1000}m`;
    }
    return `${km}km`;
  }

  /**
   * Get notification count estimate
   */
  getNotificationEstimate(): string {
    const radius = this.settings.notificationRadiusKm;
    
    if (radius <= 1) {
      return 'Very few notifications (immediate area only)';
    } else if (radius <= 5) {
      return 'Moderate notifications (nearby areas)';
    } else if (radius <= 10) {
      return 'Regular notifications (local area)';
    } else if (radius <= 20) {
      return 'Frequent notifications (wider area)';
    } else {
      return 'Many notifications (large area)';
    }
  }
}


