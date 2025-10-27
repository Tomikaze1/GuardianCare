import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Platform } from '@ionic/angular';

export interface NotificationData {
  id: string;
  type: 'safety' | 'report' | 'system' | 'location' | 'engagement';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
  icon?: string;
  sound?: boolean;
  vibration?: boolean;
  persistent?: boolean;
  distanceMeters?: number; // optional distance
  isNew?: boolean; // recent badge
  seenByUser?: boolean; // for NEW badge in notifications page
}

export interface NotificationSettings {
  enabled: boolean;
  pushNotifications: boolean;
  inAppNotifications: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  safetyAlerts: boolean;
  reportUpdates: boolean;
  systemUpdates: boolean;
  locationAlerts: boolean;
  engagementNotifications: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationManagerService {
  private notificationsSubject = new BehaviorSubject<NotificationData[]>([]);
  private settingsSubject = new BehaviorSubject<NotificationSettings>({
    enabled: true,
    pushNotifications: true,
    inAppNotifications: true,
    soundEnabled: true,
    vibrationEnabled: true,
    safetyAlerts: true,
    reportUpdates: true,
    systemUpdates: true,
    locationAlerts: true,
    engagementNotifications: false
  });

  public notifications$ = this.notificationsSubject.asObservable();
  public settings$ = this.settingsSubject.asObservable();

  constructor(private platform: Platform) {
    this.loadNotificationsFromStorage();
    this.initializeNotifications();
  }

  private async initializeNotifications() {
    // Request notification permissions
    if (this.platform.is('capacitor')) {
      // For mobile devices
      await this.requestMobilePermissions();
    } else {
      // For web browsers
      await this.requestWebPermissions();
    }
  }

  private async requestMobilePermissions() {
    // Implementation for Capacitor push notifications
    console.log('Requesting mobile notification permissions...');
  }

  private async requestWebPermissions() {
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        console.log('Web notification permission:', permission);
      } catch (error) {
        console.warn('Could not request notification permission:', error);
      }
    }
  }

  // Add new notification
  addNotification(notification: Omit<NotificationData, 'id' | 'timestamp' | 'read'>) {
    const newNotification: NotificationData = {
      ...notification,
      id: this.generateId(),
      timestamp: new Date(),
      read: false,
      seenByUser: false // NEW badge will show
    };

    // Ensure seenByUser is in the data object for notifications page compatibility
    (newNotification as any).data = {
      ...(newNotification as any).data,
      seenByUser: false
    };

    const currentNotifications = this.notificationsSubject.value;
    const updatedNotifications = [newNotification, ...currentNotifications].slice(0, 100); // Keep last 100
    this.notificationsSubject.next(updatedNotifications);
    this.saveNotificationsToStorage();

    // Dispatch custom event to notify other components about new notification
    this.dispatchNotificationEvent();

    // Show push notification only for zone context (set by ZoneNotificationService)
    if ((window as any).__guardianCareZoneSound === true && this.settingsSubject.value.pushNotifications && this.settingsSubject.value.enabled) {
      this.showPushNotification(newNotification);
    }

    // DISABLED: playNotificationSound for zone context
    // Only Guardian Care ringtone plays, not this oscillator sound
    // if ((window as any).__guardianCareZoneSound === true && this.settingsSubject.value.soundEnabled && newNotification.sound !== false) {
    //   this.playNotificationSound(newNotification.priority);
    // }

    // Vibrate if enabled
    if (this.settingsSubject.value.vibrationEnabled && newNotification.vibration !== false) {
      this.vibrateDevice(newNotification.priority);
    }

    return newNotification;
  }

  // Safety notifications
  addSafetyNotification(title: string, message: string, priority: 'medium' | 'high' | 'critical' = 'medium') {
    return this.addNotification({
      type: 'safety',
      priority,
      title,
      message,
      icon: 'shield',
      sound: false, // no sound for banner-only confirmation
      vibration: false,
      persistent: priority === 'critical'
    });
  }

  // Report notifications
  addReportNotification(title: string, message: string, reportId?: string) {
    return this.addNotification({
      type: 'report',
      priority: 'medium',
      title,
      message,
      icon: 'document-text',
      actionUrl: reportId ? `/reports/${reportId}` : undefined
    });
  }

  // Location notifications
  addLocationNotification(title: string, message: string, priority: 'low' | 'medium' | 'high' = 'medium') {
    return this.addNotification({
      type: 'location',
      priority,
      title,
      message,
      icon: 'location',
      sound: priority === 'high',
      vibration: priority === 'high'
    });
  }

  // System notifications
  addSystemNotification(title: string, message: string, priority: 'low' | 'medium' = 'low') {
    return this.addNotification({
      type: 'system',
      priority,
      title,
      message,
      icon: 'settings',
      sound: false,
      vibration: false
    });
  }

  // Engagement notifications
  addEngagementNotification(title: string, message: string) {
    return this.addNotification({
      type: 'engagement',
      priority: 'low',
      title,
      message,
      icon: 'heart',
      sound: false,
      vibration: false
    });
  }

  // Admin validated report notification
  addAdminValidatedReportNotification(reportData: {
    type: string;
    locationAddress: string;
    riskLevel: number;
    validatedAt: Date;
    distanceFromUser?: number;
  }) {
    const riskLevelText = this.getRiskLevelText(reportData.riskLevel);
    const priority = this.getRiskPriority(reportData.riskLevel);
    
    const title = `New ${reportData.type}`;
    const message = `${reportData.locationAddress} - ${riskLevelText} Zone`;

    const created = this.addNotification({
      type: 'safety',
      priority,
      title,
      message,
      icon: 'shield-checkmark',
      sound: true,
      vibration: true,
      persistent: priority === 'critical'
    });

    // Attach distance and isNew if available
    created.distanceMeters = reportData.distanceFromUser;
    created.isNew = this.isRecent(reportData.validatedAt);

    const current = this.notificationsSubject.value;
    this.notificationsSubject.next([...current]);
    return created;
  }

  // Helper methods for admin notifications
  private getRiskLevelText(riskLevel: number): string {
    switch (riskLevel) {
      case 1: return 'Low';
      case 2: return 'Moderate';
      case 3: return 'High';
      case 4: return 'Critical';
      case 5: return 'Extreme';
      default: return 'Unknown';
    }
  }

  private getRiskPriority(riskLevel: number): 'medium' | 'high' | 'critical' {
    if (riskLevel >= 4) return 'critical';
    if (riskLevel >= 3) return 'high';
    return 'medium';
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  // Mark notification as read
  markAsRead(notificationId: string) {
    const notifications = this.notificationsSubject.value;
    const updatedNotifications = notifications.map(notification =>
      notification.id === notificationId ? { ...notification, read: true } : notification
    );
    this.notificationsSubject.next(updatedNotifications);
    this.saveNotificationsToStorage();
  }

  // Mark all as read
  markAllAsRead() {
    const notifications = this.notificationsSubject.value;
    const updatedNotifications = notifications.map(notification => ({ ...notification, read: true }));
    this.notificationsSubject.next(updatedNotifications);
    this.saveNotificationsToStorage();
  }

  // Remove notification
  removeNotification(notificationId: string) {
    const notifications = this.notificationsSubject.value;
    const updatedNotifications = notifications.filter(notification => notification.id !== notificationId);
    this.notificationsSubject.next(updatedNotifications);
    this.saveNotificationsToStorage();
  }

  // Clear all notifications
  clearAllNotifications() {
    this.notificationsSubject.next([]);
    this.saveNotificationsToStorage();
  }

  // Get unread count
  getUnreadCount(): number {
    return this.notificationsSubject.value.filter(notification => !notification.read).length;
  }

  // Update settings
  updateSettings(settings: Partial<NotificationSettings>) {
    const currentSettings = this.settingsSubject.value;
    const updatedSettings = { ...currentSettings, ...settings };
    this.settingsSubject.next(updatedSettings);
    this.saveSettings(updatedSettings);
  }

  // Show push notification
  private showPushNotification(notification: NotificationData) {
    if (this.platform.is('capacitor')) {
      // Mobile push notification
      this.showMobilePushNotification(notification);
    } else {
      // Web push notification
      this.showWebPushNotification(notification);
    }
  }

  private showWebPushNotification(notification: NotificationData) {
    if ('Notification' in window && Notification.permission === 'granted') {
      const webNotification = new Notification(notification.title, {
        body: notification.message,
        icon: '/assets/icon/icon.png',
        tag: notification.id,
        requireInteraction: notification.persistent || notification.priority === 'critical'
      });

      webNotification.onclick = () => {
        window.focus();
        webNotification.close();
        if (notification.actionUrl) {
          // Navigate to specific page
          window.location.href = notification.actionUrl;
        }
      };

      // Auto-close after 5 seconds unless it's critical
      if (!notification.persistent && notification.priority !== 'critical') {
        setTimeout(() => webNotification.close(), 5000);
      }
    }
  }

  private showMobilePushNotification(notification: NotificationData) {
    // Implementation for Capacitor push notifications
    console.log('Mobile push notification:', notification);
  }

  // Play notification sound
  private playNotificationSound(priority: string) {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Different frequencies for different priorities
      const frequencies = {
        low: 400,
        medium: 600,
        high: 800,
        critical: 1000
      };

      oscillator.frequency.setValueAtTime(frequencies[priority as keyof typeof frequencies] || 600, audioContext.currentTime);
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
      console.warn('Could not play notification sound:', error);
    }
  }

  // Vibrate device
  private vibrateDevice(priority: string) {
    if ('vibrate' in navigator) {
      const patterns = {
        low: [100],
        medium: [200, 100, 200],
        high: [300, 100, 300, 100, 300],
        critical: [500, 200, 500, 200, 500]
      };

      navigator.vibrate(patterns[priority as keyof typeof patterns] || patterns.medium);
    }
  }

  // Generate unique ID
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Save settings to localStorage
  private saveSettings(settings: NotificationSettings) {
    localStorage.setItem('notificationSettings', JSON.stringify(settings));
  }

  // Load settings from localStorage
  loadSettings(): NotificationSettings {
    const saved = localStorage.getItem('notificationSettings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.warn('Could not parse saved notification settings:', error);
      }
    }
    return this.settingsSubject.value;
  }

  private isRecent(date: Date): boolean {
    const diffMs = Date.now() - new Date(date).getTime();
    return diffMs <= 5 * 60 * 1000; // 5 minutes
  }

  // Persistence methods
  private saveNotificationsToStorage() {
    try {
      localStorage.setItem('guardian_care_notifications', JSON.stringify(this.notificationsSubject.value));
      
      // Dispatch custom event to notify tabs page about badge update
      this.dispatchNotificationEvent();
    } catch (error) {
      console.warn('Could not save notifications to storage:', error);
    }
  }

  private dispatchNotificationEvent() {
    // Dispatch a custom event that the tabs page can listen to
    const event = new CustomEvent('notificationsUpdated', {
      detail: { unreadCount: this.getUnreadCount() }
    });
    window.dispatchEvent(event);
  }

  private loadNotificationsFromStorage() {
    try {
      const stored = localStorage.getItem('guardian_care_notifications');
      if (stored) {
        const notifications = JSON.parse(stored);
        // Convert timestamp strings back to Date objects
        const parsedNotifications = notifications.map((n: any) => ({
          ...n,
          timestamp: new Date(n.timestamp)
        }));
        this.notificationsSubject.next(parsedNotifications);
      }
    } catch (error) {
      console.warn('Could not load notifications from storage:', error);
    }
  }
}
