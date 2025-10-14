import { Component, OnInit, OnDestroy } from '@angular/core';
import { AlertController, LoadingController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from '../services/auth.service';
import { ReportService } from '../services/report.service';
import { NotificationManagerService } from '../services/notification-manager.service';
import { AdminNotificationService } from '../services/admin-notification.service';
import { LocationService } from '../services/location.service';
import { Subscription } from 'rxjs';

interface NotificationItem {
  id: string;
  type: 'report_validated' | 'new_zone' | 'zone_alert' | 'system';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  data?: any;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: false
})
export class NotificationsPage implements OnInit, OnDestroy {
  notifications: NotificationItem[] = [];
  filteredNotifications: NotificationItem[] = [];
  isLoading = false;
  currentUser: any = null;
  
  stickyNew: boolean = true;
  
  // Offline/Online sync functionality
  isOnline = navigator.onLine;
  lastOnlineTime: Date | null = null;
  offlineNotifications: NotificationItem[] = [];
  
  private subscriptions: Subscription[] = [];
  private processedReportIds = new Set<string>();

  constructor(
    private alertController: AlertController,
    private loadingController: LoadingController,
    private translateService: TranslateService,
    private authService: AuthService,
    private reportService: ReportService,
    private notificationManager: NotificationManagerService,
    private adminNotificationService: AdminNotificationService,
    private locationService: LocationService
  ) {}

  async ngOnInit() {
    await this.loadUserProfile();
    this.setupOfflineOnlineListeners();
    
    // Clear existing notifications to force recreation with updated data
    localStorage.removeItem('guardian_care_notifications');
    console.log('🗑️ Cleared existing notifications from localStorage');
    
    this.loadNotifications();
    this.subscribeToNotifications();
    this.subscribeToAdminValidations();
    
    // Always create fresh test notifications with updated data
    this.createTestNotifications();
    console.log('🔄 Created fresh test notifications with adminLevel data');
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    // Clean up offline/online listeners
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  private setupOfflineOnlineListeners() {
    // Set up offline/online detection
    this.handleOnline = this.handleOnline.bind(this);
    this.handleOffline = this.handleOffline.bind(this);
    
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    
    // Store initial online time
    if (this.isOnline) {
      this.lastOnlineTime = new Date();
      localStorage.setItem('guardian_care_last_online_time', this.lastOnlineTime.toISOString());
    } else {
      // If offline on startup, load last online time
      const storedTime = localStorage.getItem('guardian_care_last_online_time');
      if (storedTime) {
        this.lastOnlineTime = new Date(storedTime);
      }
    }
  }

  private handleOnline = () => {
    console.log('🌐 User is back online - syncing missed notifications');
    this.isOnline = true;
    this.lastOnlineTime = new Date();
    localStorage.setItem('guardian_care_last_online_time', this.lastOnlineTime.toISOString());
    
    // Sync missed notifications when coming back online
    this.syncMissedNotifications();
  };

  private handleOffline = () => {
    console.log('📱 User went offline');
    this.isOnline = false;
    // Store current time as last online time
    this.lastOnlineTime = new Date();
    localStorage.setItem('guardian_care_last_online_time', this.lastOnlineTime.toISOString());
  };

  private async loadUserProfile() {
    try {
      this.currentUser = await this.authService.getCurrentUser();
      
      // Set initial login time if not set
      if (this.currentUser && !localStorage.getItem('guardian_care_last_login_time')) {
        localStorage.setItem('guardian_care_last_login_time', new Date().toISOString());
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  }

  private loadNotifications() {
    this.isLoading = true;
    
    // For first-time users, set initial notification check time to NOW
    // This ensures no old notifications show up on first sign-in
    if (!localStorage.getItem('guardian_care_last_notification_check')) {
      this.updateLastNotificationCheckTime();
      console.log('🆕 First-time user: Set initial notification check time to NOW');
    }
    
    // Load existing notifications from localStorage first
    this.loadExistingNotifications();
    
    // Then load new notifications from real-time sources (after last check time)
    this.loadReportValidationNotifications();
    this.loadNewZoneNotifications();
    
    // If user was offline, sync missed notifications
    if (!this.isOnline) {
      this.syncMissedNotifications();
    }
    
    this.isLoading = false;
  }

  private loadExistingNotifications() {
    try {
      const stored = localStorage.getItem('guardian_care_notifications');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.notifications = parsed.map((n: any) => ({
          ...n,
          timestamp: new Date(n.timestamp)
        }));
        console.log(`📱 Loaded ${this.notifications.length} existing notifications from localStorage`);
        this.applyFiltersAndSort();
      }
    } catch (error) {
      console.error('Error loading existing notifications:', error);
      this.notifications = [];
    }
  }

  private async syncMissedNotifications() {
    if (!this.lastOnlineTime || !this.currentUser) {
      console.log('🔄 Cannot sync notifications - missing last online time or user');
      return;
    }

    console.log('🔄 Syncing missed notifications since:', this.lastOnlineTime);
    
    try {
      // Load all validated reports that were validated after last online time
      const reports = await this.reportService.getValidatedReports().pipe().toPromise();
      if (!reports) return;

      const missedReports = reports.filter(report => {
        const validatedDate = new Date(report.validatedAt || report.updatedAt);
        return report.status === 'Validated' &&
               report.validatedAt && // Must have validation timestamp (admin validated)
               report.level && // Must have admin-assigned level (admin validated)
               validatedDate > this.lastOnlineTime!;
      });

      console.log(`🔄 Found ${missedReports.length} missed notifications to sync`);

      if (missedReports.length > 0) {
        // Show a summary notification about missed notifications
        this.showMissedNotificationsSummary(missedReports.length);
        
        // Add each missed notification
        for (const report of missedReports) {
          await this.createMissedNotification(report);
        }
        
        // Update last notification check time to now
        this.updateLastNotificationCheckTime();
        
        // Save notifications
        this.saveNotifications();
        this.sortNotifications();
      }
    } catch (error) {
      console.error('Error syncing missed notifications:', error);
    }
  }

  private async createMissedNotification(report: any) {
    try {
      const existingNotification = this.notifications.find(n => 
        (n.type === 'report_validated' || n.type === 'new_zone') && n.data?.reportId === report.id
      );

      if (!existingNotification) {
        // Use admin's assigned level (admin validation takes priority)
        const adminLevel = report.level || 1;
        const validatedDate = new Date(report.validatedAt);
        const timeStr = this.formatDetailedTime(validatedDate);
        const isUserReport = report.userId === this.currentUser.uid;
        
        // Calculate distance if user location is available
        let distanceText = '';
        if (this.currentUser && report.location) {
          try {
            const userLocation = await this.locationService.getCurrentLocation();
            if (userLocation) {
              const distanceMeters = this.calculateDistance(
                userLocation.lat,
                userLocation.lng,
                report.location.lat,
                report.location.lng
              );
              distanceText = distanceMeters < 1000 ? 
                `${Math.round(distanceMeters)}m away` : 
                `${(distanceMeters / 1000).toFixed(1)}km away`;
            }
          } catch (error) {
            console.error('Error calculating distance for missed notification:', error);
          }
        }

        const notificationType = isUserReport ? 'report_validated' : 'new_zone';
        const notification: NotificationItem = {
          id: `${notificationType}_${report.id}_missed`,
          type: notificationType,
          title: isUserReport ? `Your Report Validated` : `New Added Zone`,
          message: `${report.type} • ${report.location.simplifiedAddress || report.locationAddress}${distanceText ? ` • ${distanceText}` : ''} • ${timeStr}`,
          timestamp: validatedDate,
          read: false,
          data: {
            reportId: report.id,
            reportType: report.type,
            adminLevel: adminLevel,
            location: report.location,
            locationAddress: report.locationAddress,
            validatedTime: timeStr,
            distanceMeters: distanceText ? this.parseDistanceToMeters(distanceText) : null,
            isMissedNotification: true // Flag to indicate this was a missed notification
          },
          priority: adminLevel >= 4 ? 'critical' : adminLevel >= 3 ? 'high' : 'medium'
        };
        
        this.notifications.unshift(notification);
        console.log(`📱 Added missed notification for report: ${report.id}`);
      }
    } catch (error) {
      console.error('Error creating missed notification:', error);
    }
  }

  private async showMissedNotificationsSummary(count: number) {
    try {
      const alert = await this.alertController.create({
        header: 'Missed Notifications',
        message: `You have ${count} new notification${count > 1 ? 's' : ''} while you were offline.`,
        buttons: [
          {
            text: 'View Now',
            handler: () => {
              // Scroll to top of notifications
              setTimeout(() => {
                const content = document.querySelector('ion-content');
                if (content) {
                  content.scrollToTop(300);
                }
              }, 100);
            }
          },
          {
            text: 'Later',
            role: 'cancel'
          }
        ]
      });
      await alert.present();
    } catch (error) {
      console.error('Error showing missed notifications summary:', error);
    }
  }

  clearAllNotifications() {
    // Clear all notifications from memory
    this.notifications = [];
    
    // Clear all stored notifications from localStorage
    localStorage.removeItem('guardian_care_notifications');
    
    // Clear processed report IDs to start fresh
    this.adminNotificationService.clearProcessedReports();
    
    // Trigger storage event to update tabs badge
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'guardian_care_notifications',
      newValue: null,
      oldValue: localStorage.getItem('guardian_care_notifications')
    }));
    
    console.log('🧹 Cleared all existing notifications - starting fresh');
  }

  private loadReportValidationNotifications() {
    // Show notifications for ALL validated reports (not just user's own)
    if (this.currentUser) {
      this.subscriptions.push(
        this.reportService.getValidatedReports().subscribe(async reports => {
          // Get the last time user checked notifications
          const lastCheckTime = this.getLastNotificationCheckTime();
          
          // Filter for ALL reports that were validated AFTER last check by ADMIN
          const validatedReports = reports.filter(report => {
            const validatedDate = new Date(report.validatedAt || report.updatedAt);
            return report.status === 'Validated' &&
                   report.validatedAt && // Must have validation timestamp (admin validated)
                   report.level && // Must have admin-assigned level (admin validated)
                   validatedDate > lastCheckTime;
          });
          
          for (const report of validatedReports) {
            const existingNotification = this.notifications.find(n => 
              n.type === 'report_validated' && n.data?.reportId === report.id
            );
            
            if (!existingNotification) {
              // Use admin's assigned level (admin validation takes priority)
              const adminLevel = report.level || 1;
              const validatedDate = new Date(report.validatedAt);
              const timeStr = this.formatDetailedTime(validatedDate);
              const isUserReport = report.userId === this.currentUser.uid;
              
              // Calculate distance if user location is available
              let distanceText = '';
              if (this.currentUser && report.location) {
                try {
                  // Get user's current location from LocationService
                  const userLocation = await this.locationService.getCurrentLocation();
                  if (userLocation) {
                    const distanceMeters = this.calculateDistance(
                      userLocation.lat,
                      userLocation.lng,
                      report.location.lat,
                      report.location.lng
                    );
                    distanceText = distanceMeters < 1000 ? 
                      `${Math.round(distanceMeters)}m away` : 
                      `${(distanceMeters / 1000).toFixed(1)}km away`;
                  }
                } catch (error) {
                  console.error('Error calculating distance:', error);
                }
              }

              if (report.id && this.processedReportIds.has(report.id)) {
                return;
              }
              
              const notification: NotificationItem = {
                id: `validated_${report.id}`,
                type: 'report_validated',
                title: isUserReport ? `Your Report Validated` : `New ${report.type} Incident`,
                message: `${report.type} • ${report.location.simplifiedAddress || report.locationAddress}${distanceText ? ` • ${distanceText}` : ''} • ${timeStr}`,
                timestamp: validatedDate,
                read: false,
                data: {
                  reportId: report.id,
                  reportType: report.type,
                  adminLevel: adminLevel,
                  location: report.location,
                  locationAddress: report.locationAddress,
                  validatedTime: timeStr,
                  distanceMeters: distanceText ? this.parseDistanceToMeters(distanceText) : null
                },
                priority: adminLevel >= 4 ? 'critical' : adminLevel >= 3 ? 'high' : 'medium'
              };
              
              this.notifications.unshift(notification);
              if (report.id) this.processedReportIds.add(report.id);
            }
          }
          
          this.saveNotifications();
          this.sortNotifications();
        })
      );
    }
  }


  private loadNewZoneNotifications() {
    // Load notifications about new zones added - ONLY AFTER last check (admin validated)
    this.subscriptions.push(
      this.reportService.getValidatedReports().subscribe(async reports => {
        // Get the last time user checked notifications
        const lastCheckTime = this.getLastNotificationCheckTime();
        
        // Filter for admin-validated reports AFTER last check (excluding own reports)
        const newZones = reports.filter(report => {
          const validatedDate = new Date(report.validatedAt || report.updatedAt);
          return report.status === 'Validated' && 
                 report.validatedAt && // Must have admin validation timestamp
                 report.level && // Must have admin-assigned level (admin validated)
                 validatedDate > lastCheckTime &&
                 report.userId !== this.currentUser?.uid; // Don't show own reports as new zones
        });
        
        for (const report of newZones) {
          const existingNotification = this.notifications.find(n => 
            n.type === 'new_zone' && n.data?.reportId === report.id
          );
          
          if (!existingNotification) {
            // Use admin's assigned level (admin validation takes priority)
            const adminLevel = report.level || 1;
            const validatedDate = new Date(report.validatedAt);
            const timeStr = this.formatDetailedTime(validatedDate);
            
            // Calculate distance if user location is available
            let distanceText = '';
            if (this.currentUser && report.location) {
              try {
                // Get user's current location from LocationService
                const userLocation = await this.locationService.getCurrentLocation();
                if (userLocation) {
                  const distanceMeters = this.calculateDistance(
                    userLocation.lat,
                    userLocation.lng,
                    report.location.lat,
                    report.location.lng
                  );
                  distanceText = distanceMeters < 1000 ? 
                    `${Math.round(distanceMeters)}m away` : 
                    `${(distanceMeters / 1000).toFixed(1)}km away`;
                }
              } catch (error) {
                console.error('Error calculating distance:', error);
              }
            }
            
            const notification: NotificationItem = {
              id: `zone_${report.id}`,
              type: 'new_zone',
              title: `New Added Zone`,
              message: `${report.type} • ${report.location.simplifiedAddress || report.locationAddress}${distanceText ? ` • ${distanceText}` : ''} • ${timeStr}`,
              timestamp: validatedDate,
              read: false,
              data: {
                reportId: report.id,
                reportType: report.type,
                adminLevel: adminLevel,
                location: report.location,
                locationAddress: report.locationAddress,
                validatedTime: timeStr,
                distanceMeters: distanceText ? this.parseDistanceToMeters(distanceText) : null
              },
              priority: adminLevel >= 4 ? 'critical' : adminLevel >= 3 ? 'high' : 'medium'
            };
            
            this.notifications.unshift(notification);
          }
        }
        
        this.saveNotifications();
        this.sortNotifications();
      })
    );
  }

  private subscribeToNotifications() {
    // Subscribe to real-time notification updates
    this.subscriptions.push(
      this.notificationManager.notifications$.subscribe(newNotifications => {
        newNotifications.forEach(notification => {
          const convertedType = this.convertNotificationType(notification.type);
          // Skip NotificationManager report/zone items to avoid duplicates (we already add from Firestore stream)
          if (convertedType === 'report_validated' || convertedType === 'new_zone') {
            return;
          }
          const existingIndex = this.notifications.findIndex(n => n.id === notification.id);
          if (existingIndex === -1) {
            const convertedNotification: NotificationItem = {
              id: notification.id,
              type: convertedType,
              title: notification.title,
              message: notification.message,
              timestamp: notification.timestamp,
              read: notification.read,
              priority: notification.priority,
              data: {
                actionUrl: notification.actionUrl,
                icon: notification.icon,
                sound: notification.sound,
                vibration: notification.vibration,
                persistent: notification.persistent,
                distanceMeters: (notification as any).distanceMeters
              }
            };
            this.notifications.unshift(convertedNotification);
          }
        });
        
        this.saveNotifications();
        this.sortNotifications();
      })
    );
  }

  private saveNotifications() {
    const unreadCount = this.notifications.filter(n => !n.read).length;
    console.log(`💾 Saving notifications. Total: ${this.notifications.length}, Unread: ${unreadCount}`);
    
    localStorage.setItem('guardian_care_notifications', JSON.stringify(this.notifications));
    this.applyFiltersAndSort();
    
    // Trigger storage event to update tabs badge count
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'guardian_care_notifications',
      newValue: JSON.stringify(this.notifications),
      oldValue: null
    }));
    
    console.log(`💾 Notifications saved to localStorage`);
  }

  // Sort notifications by timestamp (newest first) and apply sticky NEW if enabled
  private sortNotifications() {
    // base sort by timestamp desc
    this.notifications.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    this.applyFiltersAndSort();
  }

  isNewBadge(notification: NotificationItem): boolean {
    return (new Date().getTime() - new Date(notification.timestamp).getTime()) <= 5 * 60 * 1000;
  }

  isMissedNotification(notification: NotificationItem): boolean {
    return notification.data?.isMissedNotification === true;
  }

  getStatusColor(notification: NotificationItem): string {
    if (notification.type === 'report_validated') {
      return 'success';
    } else if (notification.type === 'new_zone') {
      return 'primary';
    } else if (notification.type === 'zone_alert') {
      return 'warning';
    } else if (notification.type === 'system') {
      return 'medium';
    }
    return 'medium';
  }

  getStatusIcon(notification: NotificationItem): string {
    if (notification.type === 'report_validated') {
      return 'checkmark-circle-outline';
    } else if (notification.type === 'new_zone') {
      return 'add-circle-outline';
    } else if (notification.type === 'zone_alert') {
      return 'warning-outline';
    } else if (notification.type === 'system') {
      return 'information-circle-outline';
    }
    return 'information-circle-outline';
  }

  getStatusText(notification: NotificationItem): string {
    if (notification.type === 'report_validated') {
      return 'Validated';
    } else if (notification.type === 'new_zone') {
      return 'New Zone';
    } else if (notification.type === 'zone_alert') {
      return 'Zone Alert';
    } else if (notification.type === 'system') {
      return 'System';
    }
    return 'Notification';
  }

  getNotificationTypeLabel(type: string): string {
    switch (type) {
      case 'report_validated':
        return 'Your Report Validated';
      case 'new_zone':
        return 'New Zone Alert';
      case 'zone_alert':
        return 'Zone Alert';
      case 'system':
        return 'System Notification';
      default:
        return 'Notification';
    }
  }

  getRiskLevelText(level: number): string {
    switch (level) {
      case 1: return 'Low';
      case 2: return 'Moderate';
      case 3: return 'High';
      case 4: return 'Critical';
      case 5: return 'Extreme';
      default: return 'Unknown';
    }
  }

  getRiskLevelColor(level: number): string {
    switch (level) {
      case 1: return 'linear-gradient(90deg, #22c55e, #16a34a)'; // Green gradient
      case 2: return 'linear-gradient(90deg, #eab308, #ca8a04)'; // Yellow gradient
      case 3: return 'linear-gradient(90deg, #f97316, #ea580c)'; // Orange gradient
      case 4: return 'linear-gradient(90deg, #ef4444, #dc2626)'; // Red gradient
      case 5: return 'linear-gradient(90deg, #991b1b, #7f1d1d)'; // Dark red gradient
      default: return 'linear-gradient(90deg, #6b7280, #4b5563)'; // Gray gradient
    }
  }

  getUnreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }

  getReadCount(): number {
    return this.notifications.filter(n => n.read).length;
  }

  getNewCount(): number {
    return this.notifications.filter(n => this.isNewBadge(n)).length;
  }

  getRiskLevelStars(level: number): string[] {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(i <= level ? 'star' : 'star-outline');
    }
    return stars;
  }

  viewNotificationDetails(notification: NotificationItem) {
    // TODO: Implement notification details view
    console.log('Viewing notification details:', notification);
  }

  private createTestNotifications() {
    const testNotifications: NotificationItem[] = [
      {
        id: 'test1',
        type: 'new_zone',
        title: 'New Zone Alert',
        message: 'New security zone added in your area • 1.2 km away • Just now',
        timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago (newest)
        read: false, // NEW notification
        priority: 'medium',
        data: {
          locationAddress: 'Downtown Cebu',
          distanceMeters: 1200,
          adminLevel: 2 // Level 2 - should show yellow
        }
      },
      {
        id: 'test2',
        type: 'new_zone',
        title: 'New Zone Alert',
        message: 'New security zone added in your area • 2.4 km away • 3 hours ago',
        timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        read: false, // NEW notification
        priority: 'low',
        data: {
          locationAddress: 'Babag, Cebu City',
          distanceMeters: 2400,
          adminLevel: 3 // Level 3 - should show orange
        }
      },
      {
        id: 'test3',
        type: 'new_zone',
        title: 'New Zone Alert',
        message: 'New security zone added in your area • 800 m away • 1 day ago',
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago (oldest)
        read: true, // Already read
        priority: 'high',
        data: {
          locationAddress: 'Lahug, Cebu City',
          distanceMeters: 800,
          adminLevel: 4 // Level 4 - should show red
        }
      }
    ];

    this.notifications = testNotifications;
    this.saveNotifications();
    console.log('📱 Created NEW ZONE ONLY test notifications:', this.notifications.length);
    console.log('📱 All notifications are now New Zone Alerts with heatmap levels');
  }




  private applyFiltersAndSort() {
    let list = [...this.notifications];

    // Sort by timestamp (newest first)
    list.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    this.filteredNotifications = list;
  }

  getDistanceText(notification: NotificationItem): string {
    const meters = (notification as any)?.data?.distanceMeters ?? (notification as any)?.distanceMeters;
    if (meters == null) return '';
    return meters < 1000 ? `${Math.round(meters)} m away` : `${(meters / 1000).toFixed(1)} km away`;
  }

  formatNotificationMessage(notification: NotificationItem): string {
    const message = notification.message;
    
    // Improve text formatting
    let formattedMessage = message
      // Capitalize first letter of incident types
      .replace(/\b(crime-theft|vandalism|assault|theft|verbal threats|lost item)\b/g, (match) => {
        return match.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('-');
      })
      // Add space before km/m units and make them more prominent
      .replace(/(\d+\.?\d*)\s*(km|m)\s+(away)/g, '<strong>$1 $2 $3</strong>')
      // Capitalize time references and make them prominent
      .replace(/\b(just now|minutes? ago|hours? ago|days? ago|weeks? ago|months? ago)\b/g, (match) => {
        const capitalized = match.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        return `<strong>${capitalized}</strong>`;
      })
      // Make incident types prominent
      .replace(/\b(Crime-Theft|Vandalism|Assault|Theft|Verbal Threats|Lost Item)\b/g, '<strong>$1</strong>');
    
    return formattedMessage;
  }

  markAsRead(notification: NotificationItem) {
    console.log(`📱 Attempting to mark notification ${notification.id} as read. Current read status: ${notification.read}`);
    
    if (!notification.read) {
      notification.read = true;
      console.log(`📱 Set notification ${notification.id} read status to: ${notification.read}`);
      
      this.saveNotifications();
      
      // Force immediate update of tabs badge
      this.updateTabsBadgeCount();
      
      console.log(`📱 Marked notification ${notification.id} as read`);
      
      // Update the filtered notifications to reflect the change
      this.applyFiltersAndSort();
    } else {
      console.log(`📱 Notification ${notification.id} is already read`);
    }
  }

  markAllAsRead() {
    let hasChanges = false;
    this.notifications.forEach(notification => {
      if (!notification.read) {
        notification.read = true;
        hasChanges = true;
      }
    });
    
    if (hasChanges) {
      this.saveNotifications();
      this.updateTabsBadgeCount();
      console.log(`📱 Marked all notifications as read`);
    }
  }

  private updateTabsBadgeCount() {
    // Force update tabs badge count by triggering storage event
    const currentNotifications = this.notifications.filter(n => !n.read);
    
    // Update localStorage with current notifications
    localStorage.setItem('guardian_care_notifications', JSON.stringify(this.notifications));
    
    // Trigger multiple storage events to ensure tabs page gets the update
    setTimeout(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'guardian_care_notifications',
        newValue: JSON.stringify(this.notifications),
        oldValue: null
      }));
    }, 50);
    
    setTimeout(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'guardian_care_notifications',
        newValue: JSON.stringify(this.notifications),
        oldValue: null
      }));
    }, 100);
    
    // Also trigger a custom event
    window.dispatchEvent(new CustomEvent('notificationUpdate', {
      detail: { unreadCount: currentNotifications.length }
    }));
    
    console.log(`📊 Updated badge count: ${currentNotifications.length} unread notifications`);
  }

  async deleteNotification(notification: NotificationItem) {
    const alert = await this.alertController.create({
      header: 'Delete Notification',
      message: 'Are you sure you want to delete this notification?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            const index = this.notifications.findIndex(n => n.id === notification.id);
            if (index > -1) {
              this.notifications.splice(index, 1);
              this.saveNotifications();
            }
          }
        }
      ]
    });
    
    await alert.present();
  }


  getNotificationIcon(type: string): string {
    switch (type) {
      case 'report_validated':
        return 'checkmark-circle';
      case 'new_zone':
        return 'warning';
      case 'zone_alert':
        return 'alert-circle';
      case 'system':
        return 'information-circle';
      default:
        return 'notifications';
    }
  }

  getNotificationColor(type: string): string {
    switch (type) {
      case 'report_validated':
        return 'success';
      case 'new_zone':
        return 'warning';
      case 'zone_alert':
        return 'danger';
      case 'system':
        return 'primary';
      default:
        return 'medium';
    }
  }


  formatTimestamp(timestamp: Date): string {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hr ago`;
    if (days < 7) return `${days} day ago`;
    
    return timestamp.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async handleRefresh(event: any) {
    await this.loadNotifications();
    event.target.complete();
  }



  trackByNotificationId(index: number, notification: NotificationItem): string {
    return notification.id;
  }

  private convertNotificationType(managerType: string): 'report_validated' | 'new_zone' | 'zone_alert' | 'system' {
    switch (managerType) {
      case 'report':
        return 'report_validated';
      case 'location':
        return 'new_zone';
      case 'safety':
        return 'zone_alert';
      default:
        return 'system';
    }
  }

  getTimeAgo(timestamp: Date): string {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return timestamp.toLocaleDateString();
  }

  private getLastNotificationCheckTime(): Date {
    const stored = localStorage.getItem('guardian_care_last_notification_check');
    if (stored) {
      return new Date(stored);
    }
    // First sign-in or no history: baseline to NOW to avoid old report spam
    return new Date();
  }

  private updateLastNotificationCheckTime(): void {
    localStorage.setItem('guardian_care_last_notification_check', new Date().toISOString());
  }

  private formatDetailedTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    // If less than 1 hour ago, show minutes
    if (minutes < 60) {
      if (minutes < 1) return 'just now';
      return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    }

    // If less than 24 hours ago, show hours
    if (hours < 24) {
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }

    // If less than 7 days ago, show days
    if (days < 7) {
      return `${days} day${days !== 1 ? 's' : ''} ago`;
    }

    // Otherwise show date and time
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  // Update check time when user views notifications
  ionViewDidEnter() {
    this.updateLastNotificationCheckTime();
    
    // Check if user just logged back in and sync missed notifications
    this.checkForMissedNotificationsOnLogin();
  }

  ionViewWillLeave() {
    this.updateLastNotificationCheckTime();
  }

  private async checkForMissedNotificationsOnLogin() {
    // Check if there's a stored last login time
    const lastLoginTime = localStorage.getItem('guardian_care_last_login_time');
    if (!lastLoginTime || !this.currentUser) return;

    const lastLogin = new Date(lastLoginTime);
    const now = new Date();
    const timeDiff = now.getTime() - lastLogin.getTime();
    
    // If user was away for more than 5 minutes, sync missed notifications
    if (timeDiff > 5 * 60 * 1000) {
      console.log('🔄 User was away for', Math.round(timeDiff / 60000), 'minutes - syncing missed notifications');
      await this.syncMissedNotifications();
    }
    
    // Update last login time
    localStorage.setItem('guardian_care_last_login_time', now.toISOString());
  }

  private subscribeToAdminValidations() {
    // Subscribe to real-time admin validation events
    this.subscriptions.push(
      this.adminNotificationService.validationEvents$.subscribe(events => {
        // Admin validation events are automatically processed by the service
        // This ensures real-time notifications when admin validates reports
        console.log('🔔 Admin validation events updated:', events.length);
        
        // Force refresh of notifications when new admin validations arrive
        this.loadReportValidationNotifications();
      })
    );
  }

  getPriorityColor(priority: string): string {
    switch (priority) {
      case 'critical': return 'danger';
      case 'high': return 'warning';
      case 'medium': return 'primary';
      case 'low': return 'medium';
      default: return 'medium';
    }
  }

  getPriorityIcon(priority: string): string {
    switch (priority) {
      case 'critical': return 'alert-circle';
      case 'high': return 'warning';
      case 'medium': return 'information-circle';
      case 'low': return 'checkmark-circle';
      default: return 'information-circle';
    }
  }

  // Distance calculation methods
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lng2-lng1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
  }

  private parseDistanceToMeters(distanceText: string): number {
    if (distanceText.includes('km')) {
      const km = parseFloat(distanceText.replace('km away', ''));
      return km * 1000;
    } else if (distanceText.includes('m away')) {
      return parseFloat(distanceText.replace('m away', ''));
    }
    return 0;
  }

  // Manual sync method for when user is offline
  async manualSync() {
    if (this.isOnline) {
      console.log('🔄 Manual sync requested but user is already online');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Syncing notifications...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Force sync missed notifications
      await this.syncMissedNotifications();
      
      await loading.dismiss();
      
      // Show success message
      const toast = await this.alertController.create({
        header: 'Sync Complete',
        message: 'Notifications have been synced successfully.',
        buttons: ['OK']
      });
      await toast.present();
    } catch (error) {
      console.error('Error during manual sync:', error);
      await loading.dismiss();
      
      const alert = await this.alertController.create({
        header: 'Sync Failed',
        message: 'Unable to sync notifications. Please check your internet connection.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }
}
