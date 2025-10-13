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
  distanceMeters?: number;
  isNew?: boolean;
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
    this.initializeNotifications();
  }

  private async initializeNotifications() {
    if (this.platform.is('capacitor')) {
      await this.requestMobilePermissions();
    } else {
      await this.requestWebPermissions();
    }
  }

  private async requestMobilePermissions() {
    // Placeholder for Capacitor push permissions
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

  addNotification(notification: Omit<NotificationData, 'id' | 'timestamp' | 'read'>) {
    const newNotification: NotificationData = {
      ...notification,
      id: this.generateId(),
      timestamp: new Date(),
      read: false
    };

    const currentNotifications = this.notificationsSubject.value;
    const updatedNotifications = [newNotification, ...currentNotifications].slice(0, 100);
    this.notificationsSubject.next(updatedNotifications);

    if (this.settingsSubject.value.pushNotifications && this.settingsSubject.value.enabled) {
      this.showPushNotification(newNotification);
    }
    if (this.settingsSubject.value.soundEnabled && newNotification.sound !== false) {
      this.playNotificationSound(newNotification.priority);
    }
    if (this.settingsSubject.value.vibrationEnabled && newNotification.vibration !== false) {
      this.vibrateDevice(newNotification.priority);
    }
    return newNotification;
  }

  addSafetyNotification(title: string, message: string, priority: 'medium' | 'high' | 'critical' = 'medium') {
    return this.addNotification({
      type: 'safety',
      priority,
      title,
      message,
      icon: 'shield',
      sound: true,
      vibration: true,
      persistent: priority === 'critical'
    });
  }

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

    created.distanceMeters = reportData.distanceFromUser;
    created.isNew = this.isRecent(reportData.validatedAt);
    const current = this.notificationsSubject.value;
    this.notificationsSubject.next([...current]);
    return created;
  }

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

  markAsRead(notificationId: string) {
    const notifications = this.notificationsSubject.value;
    const updatedNotifications = notifications.map(n => n.id === notificationId ? { ...n, read: true } : n);
    this.notificationsSubject.next(updatedNotifications);
  }

  markAllAsRead() {
    const notifications = this.notificationsSubject.value.map(n => ({ ...n, read: true }));
    this.notificationsSubject.next(notifications);
  }

  removeNotification(notificationId: string) {
    const notifications = this.notificationsSubject.value.filter(n => n.id !== notificationId);
    this.notificationsSubject.next(notifications);
  }

  clearAllNotifications() {
    this.notificationsSubject.next([]);
  }

  getUnreadCount(): number {
    return this.notificationsSubject.value.filter(n => !n.read).length;
  }

  updateSettings(settings: Partial<NotificationSettings>) {
    const updated = { ...this.settingsSubject.value, ...settings };
    this.settingsSubject.next(updated);
    this.saveSettings(updated);
  }

  private showPushNotification(notification: NotificationData) {
    if (this.platform.is('capacitor')) {
      this.showMobilePushNotification(notification);
    } else {
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
          window.location.href = notification.actionUrl;
        }
      };
      if (!notification.persistent && notification.priority !== 'critical') {
        setTimeout(() => webNotification.close(), 5000);
      }
    }
  }

  private showMobilePushNotification(notification: NotificationData) {
    console.log('Mobile push notification:', notification);
  }

  private playNotificationSound(priority: string) {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      const frequencies = { low: 400, medium: 600, high: 800, critical: 1000 } as const;
      oscillator.frequency.setValueAtTime((frequencies as any)[priority] || 600, audioContext.currentTime);
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
      console.warn('Could not play notification sound:', error);
    }
  }

  private vibrateDevice(priority: string) {
    if ('vibrate' in navigator) {
      const patterns: any = {
        low: [100],
        medium: [200, 100, 200],
        high: [300, 100, 300, 100, 300],
        critical: [500, 200, 500, 200, 500]
      };
      navigator.vibrate(patterns[priority] || patterns.medium);
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private saveSettings(settings: NotificationSettings) {
    localStorage.setItem('notificationSettings', JSON.stringify(settings));
  }

  loadSettings(): NotificationSettings {
    const saved = localStorage.getItem('notificationSettings');
    if (saved) {
      try { return JSON.parse(saved); } catch { /* ignore */ }
    }
    return this.settingsSubject.value;
  }

  private isRecent(date: Date): boolean {
    const diffMs = Date.now() - new Date(date).getTime();
    return diffMs <= 5 * 60 * 1000;
  }
}

export * from '../shared/services/notification-manager.service';


