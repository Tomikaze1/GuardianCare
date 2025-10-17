import { Component, OnInit, OnDestroy } from '@angular/core';
import { AlertController, LoadingController, NavController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from '../services/auth.service';
import { ReportService } from '../services/report.service';
import { NotificationManagerService } from '../services/notification-manager.service';
import { AdminNotificationService } from '../services/admin-notification.service';
import { Subscription } from 'rxjs';

interface NotificationItem {
  id: string;
  type: 'report_validated' | 'new_zone';
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
  
  activeFilter: 'all' | 'new' | 'unread' = 'all';
  
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
    private navController: NavController
  ) {}

  async ngOnInit() {
    await this.loadUserProfile();
    this.loadNotifications();
    this.subscribeToNotifications();
    this.subscribeToAdminValidations();
    
    // Test notifications disabled - no demo data
    this.clearTestNotifications();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private async loadUserProfile() {
    try {
      this.currentUser = await this.authService.getCurrentUser();
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  }

  private loadNotifications() {
    this.isLoading = true;
    
    // Load existing notifications from localStorage to preserve read status
    const stored = localStorage.getItem('guardian_care_notifications');
    if (stored) {
      try {
        const storedNotifications = JSON.parse(stored);
        // Restore notifications with proper Date objects
        this.notifications = storedNotifications.map((n: any) => ({
          ...n,
          timestamp: new Date(n.timestamp)
        }));
        console.log('📥 Loaded existing notifications from localStorage:', this.notifications.length);
      } catch (error) {
        console.error('Error loading notifications from localStorage:', error);
        this.notifications = [];
      }
    } else {
      this.notifications = [];
    }
    
    // Load all validated reports to show the 11+ reports for existing users
    this.loadReportValidationNotifications();
    
    this.isLoading = false;
  }

  clearAllNotifications() {
    // Clear all notifications from memory
    this.notifications = [];
    this.filteredNotifications = [];
    
    // Clear all stored notifications from localStorage
    localStorage.removeItem('guardian_care_notifications');
    localStorage.removeItem('guardian_care_last_notification_check');
    
    // Clear processed report IDs to start fresh
    this.adminNotificationService.clearProcessedReports();
    
    console.log('🧹 Cleared all notifications');
  }

  private loadReportValidationNotifications() {
    // Show notifications for ALL validated reports (not just user's own)
    if (this.currentUser) {
      this.subscriptions.push(
        this.reportService.getValidatedReports().subscribe(reports => {
          console.log('📊 Loading validated reports:', reports.length);
          
          // Get last check time to determine which reports are NEW
          const lastCheckTime = this.getLastNotificationCheckTime();
          
          // Only show notifications for:
          // 1. User's own reports (regardless of age)
          // 2. Very recent validations (within 24 hours)
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const validatedReports = reports.filter(report => {
            if (report.status !== 'Validated' || !report.validatedAt) return false;
            
            const validatedDate = new Date(report.validatedAt);
            const isUserReport = report.userId === this.currentUser.uid;
            const isRecentValidation = validatedDate > oneDayAgo;
            
            return isUserReport || isRecentValidation;
          });
          
          console.log('✅ Validated reports found:', validatedReports.length);
          console.log('📅 Last notification check time:', lastCheckTime);
          
          validatedReports.forEach(report => {
            // Check for existing notification by report ID (regardless of type)
            const existingNotification = this.notifications.find(n => 
              n.data?.reportId === report.id
            );
            
            if (!existingNotification) {
              // CRITICAL: Admin validation stores risk level in 'level' field (1-5 stars from admin interface)
              // Priority: level (admin-set) > validationLevel (legacy) > riskLevel (auto-calculated)
              const adminLevel = report.level ?? report.validationLevel ?? report.riskLevel ?? 1;
              const riskLevel = Number(adminLevel);
              
              console.log('📊 Report risk level data:', {
                reportId: report.id,
                level: report.level,
                validationLevel: report.validationLevel,
                riskLevel: report.riskLevel,
                finalRiskLevel: riskLevel
              });
              
              const validatedDate = new Date(report.validatedAt);
              const timeStr = this.formatDetailedTime(validatedDate);
              const isUserReport = report.userId === this.currentUser.uid;
              const riskText = this.getRiskLevelText(riskLevel);

              // Determine if this is a TRULY NEW notification (validated after last check)
              const isNewNotification = validatedDate > lastCheckTime;

              // Create notification based on whether it's user's own report or others
              const notification: NotificationItem = {
                id: `validated_${report.id}`,
                type: isUserReport ? 'report_validated' : 'new_zone',
                title: isUserReport ? `Your Report Validated` : `New Zone Alert`,
                message: `${report.type} • ${report.locationAddress || report.location?.fullAddress || report.location?.simplifiedAddress || 'Unknown Location'} • Level ${riskLevel} - ${riskText} Risk • ${timeStr}`,
                timestamp: validatedDate,
                read: !isNewNotification, // Only mark as unread if it's truly new
                data: {
                  reportId: report.id,
                  reportType: report.type,
                  riskLevel: riskLevel, // Store final risk level
                  adminLevel: riskLevel, // Store admin-validated level (same value)
                  location: report.location,
                  locationAddress: report.locationAddress || report.location?.fullAddress || report.location?.simplifiedAddress || 'Unknown Location',
                  validatedTime: timeStr,
                  seenByUser: !isNewNotification // Only mark as unseen if it's truly new
                },
                priority: riskLevel >= 4 ? 'critical' : riskLevel >= 3 ? 'high' : 'medium'
              };
              
              console.log('🔔 Creating notification with correct risk level:', {
                type: notification.type,
                adminLevel: riskLevel,
                color: this.getRiskLevelColor(riskLevel),
                riskText: riskText,
                isNew: isNewNotification,
                validatedDate: validatedDate.toISOString(),
                lastCheckTime: lastCheckTime.toISOString()
              });
              
              this.notifications.unshift(notification);
              if (report.id) this.processedReportIds.add(report.id);
            }
          });
          
          this.saveNotifications();
          this.sortNotifications();
        })
      );
    }
  }

  getRiskLevelText(riskLevel: number | null | undefined): string {
    // Ensure we have a valid number
    const level = Number(riskLevel ?? 1);
    
    switch (level) {
      case 1: return 'Low';
      case 2: return 'Moderate';
      case 3: return 'High';
      case 4: return 'Critical';
      case 5: return 'Extreme';
      default: return 'Unknown';
    }
  }


  private subscribeToNotifications() {
    // Subscribe to real-time notification updates, but filter out system notifications
    this.subscriptions.push(
      this.notificationManager.notifications$.subscribe(newNotifications => {
        // Filter out system notifications completely
        const filteredNotifications = newNotifications.filter(notification => 
          notification.type !== 'system' && 
          notification.type !== 'engagement'
        );
        
        filteredNotifications.forEach(notification => {
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
    localStorage.setItem('guardian_care_notifications', JSON.stringify(this.notifications));
    this.applyFiltersAndSort();
    
    // Trigger storage event to update badge count in tabs
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'guardian_care_notifications',
      newValue: JSON.stringify(this.notifications)
    }));
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

  setFilter(filter: 'all' | 'new' | 'unread') {
    this.activeFilter = filter;
    this.applyFiltersAndSort();
  }


  private applyFiltersAndSort() {
    let list = [...this.notifications];

    // filter
    if (this.activeFilter === 'new') {
      list = list.filter(n => this.isNewBadge(n));
    } else if (this.activeFilter === 'unread') {
      list = list.filter(n => !n.read);
    }

    // Sort by timestamp (newest first) - no sticky behavior
    this.filteredNotifications = list.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  getDistanceText(notification: NotificationItem): string {
    const meters = (notification as any)?.data?.distanceMeters ?? (notification as any)?.distanceMeters;
    if (meters == null) return '';
    return meters < 1000 ? `${Math.round(meters)}m away` : `${(meters / 1000).toFixed(1)}km away`;
  }

  markAsRead(notification: NotificationItem) {
    notification.read = true;
    this.saveNotifications();
  }

  handleNotificationClick(notification: NotificationItem) {
    // Mark as read first
    this.markAsRead(notification);
    
    // Navigate to map and center on location
    this.navigateToLocation(notification);
  }

  navigateToLocation(notification: NotificationItem) {
    // Get location data from notification
    const location = notification.data?.location;
    const locationAddress = notification.data?.locationAddress;
    
    if (location && location.lat && location.lng) {
      // Navigate to home tab (map view)
      this.navController.navigateRoot('/tabs/home');
      
      // Store location data for the map to use
      const mapLocationData = {
        lat: location.lat,
        lng: location.lng,
        address: locationAddress || 'Notification Location',
        reportType: notification.data?.reportType,
        riskLevel: notification.data?.riskLevel || notification.data?.adminLevel,
        timestamp: notification.timestamp
      };
      
      // Store in localStorage for the home page to pick up
      localStorage.setItem('guardian_care_navigate_to_location', JSON.stringify(mapLocationData));
      
      console.log('🗺️ Navigating to location:', mapLocationData);
    } else {
      // Fallback: just navigate to home tab
      this.navController.navigateRoot('/tabs/home');
      console.log('🗺️ Navigating to home tab (no location data)');
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
      console.log('✅ Marked all notifications as read');
    } else {
      console.log('ℹ️ All notifications are already read');
    }
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
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return '1 day ago';
    if (days < 7) return `${days}d ago`;
    if (weeks === 1) return '1 week ago';
    if (weeks < 4) return `${weeks}w ago`;
    if (months === 1) return '1 month ago';
    if (months < 12) return `${months}mo ago`;
    
    return timestamp.toLocaleDateString();
  }

  async handleRefresh(event: any) {
    await this.loadNotifications();
    event.target.complete();
  }


  getRiskLevelColor(riskLevel: number | null | undefined): string {
    // Ensure we have a valid number
    const level = Number(riskLevel ?? 1);
    
    // Match heatmap legend colors exactly from report.service.ts
    switch (level) {
      case 1: return '#28a745'; // Green - Low
      case 2: return '#ffc107'; // Yellow - Moderate
      case 3: return '#fd7e14'; // Orange - High
      case 4: return '#dc3545'; // Red - Critical
      case 5: return '#8B0000'; // Dark Red - Extreme
      default: return '#6c757d'; // Gray - Unknown
    }
  }

  trackByNotificationId(index: number, notification: NotificationItem): string {
    return notification.id;
  }

  private convertNotificationType(managerType: string): 'report_validated' | 'new_zone' {
    switch (managerType) {
      case 'report':
        return 'report_validated';
      case 'location':
        return 'new_zone';
      case 'safety':
        return 'new_zone';
      default:
        return 'new_zone'; // Default to new_zone for all other types
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
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);

    // If less than 1 hour ago, show minutes
    if (minutes < 60) {
      if (minutes < 1) return 'just now';
      return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    }

    // If less than 24 hours ago, show hours
    if (hours < 24) {
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }

    // If exactly 1 day ago
    if (days === 1) {
      return '1 day ago';
    }

    // If less than 7 days ago, show days
    if (days < 7) {
      return `${days} days ago`;
    }

    // If exactly 1 week ago
    if (weeks === 1) {
      return '1 week ago';
    }

    // If less than 4 weeks ago, show weeks
    if (weeks < 4) {
      return `${weeks} weeks ago`;
    }

    // If exactly 1 month ago
    if (months === 1) {
      return '1 month ago';
    }

    // If less than 12 months ago, show months
    if (months < 12) {
      return `${months} months ago`;
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
    
    // When user enters notification tab, mark all notifications as "seen" (remove NEW badges)
    this.markAllNotificationsAsSeen();
  }

  ionViewWillLeave() {
    this.updateLastNotificationCheckTime();
  }

  // Mark all notifications as "seen" when user enters the notification tab
  private markAllNotificationsAsSeen() {
    let hasChanges = false;
    this.notifications.forEach(notification => {
      if (!notification.read || !notification.data?.seenByUser) {
        // Mark as read to update badge count
        notification.read = true;
        // Also mark as seen by user
        notification.data = notification.data || {};
        notification.data.seenByUser = true;
        hasChanges = true;
      }
    });
    
    if (hasChanges) {
      this.saveNotifications();
      console.log('✅ All notifications marked as read and seen - badge count updated');
    }
  }

  // Check if notification should show NEW badge (only if recent AND not seen by user)
  shouldShowNewBadge(notification: NotificationItem): boolean {
    const now = new Date().getTime();
    const notificationTime = new Date(notification.timestamp).getTime();
    const timeDiff = now - notificationTime;
    
    // Show NEW badge only if notification is less than 30 minutes old AND not seen by user
    const isRecent = timeDiff <= 30 * 60 * 1000; // 30 minutes in milliseconds
    const notSeenByUser = !notification.data?.seenByUser;
    
    return isRecent && notSeenByUser;
  }

  // Ensure new notifications are marked as unseen by user
  private ensureNotificationUnseen(notification: NotificationItem): NotificationItem {
    if (!notification.data) {
      notification.data = {};
    }
    if (notification.data.seenByUser === undefined) {
      notification.data.seenByUser = false;
    }
    return notification;
  }

  getUnreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }

  // Missing methods for template compatibility
  getNotificationTypeLabel(type: string): string {
    switch (type) {
      case 'report_validated':
        return 'Your Report Validated';
      case 'new_zone':
        return 'New Zone Alert';
      default:
        return 'Notification';
    }
  }

  getStatusColor(notification: NotificationItem): string {
    if (notification.type === 'report_validated') {
      return 'success';
    } else if (notification.type === 'new_zone') {
      return 'primary';
    }
    return 'medium';
  }

  getStatusIcon(notification: NotificationItem): string {
    if (notification.type === 'report_validated') {
      return 'checkmark-circle-outline';
    } else if (notification.type === 'new_zone') {
      return 'add-circle-outline';
    }
    return 'information-circle-outline';
  }

  getStatusText(notification: NotificationItem): string {
    if (notification.type === 'report_validated') {
      return 'Validated';
    } else if (notification.type === 'new_zone') {
      return 'New Zone';
    }
    return 'Notification';
  }



  formatNotificationMessage(notification: NotificationItem): string {
    const message = notification.message;
    
    // Improve text formatting
    let formattedMessage = message
      // Capitalize first letter of incident types
      .replace(/\b(crime-theft|vandalism|assault|theft|verbal threats|lost item|suspicious-activity)\b/g, (match) => {
        return match.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('-');
      })
      // Add space before km/m units and make them more prominent
      .replace(/(\d+\.?\d*)\s*(km|m)\s+(away)/g, '<strong>$1 $2 $3</strong>')
      // Make risk levels prominent with colors
      .replace(/\b(Level \d+ - (Low|Moderate|High|Critical|Extreme) Risk)\b/g, '<strong style="color: var(--primary-purple);">$1</strong>')
      // Capitalize time references and make them prominent
      .replace(/\b(just now|minutes? ago|hours? ago|days? ago|weeks? ago|months? ago)\b/g, (match) => {
        const capitalized = match.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        return `<strong>${capitalized}</strong>`;
      })
      // Make incident types prominent
      .replace(/\b(Crime-Theft|Vandalism|Assault|Theft|Verbal Threats|Lost Item|Suspicious-Activity)\b/g, '<strong>$1</strong>');
    
    return formattedMessage;
  }

  // Create test notifications for demonstration
  private createTestNotifications() {
    const testNotifications: NotificationItem[] = [
      {
        id: 'test1',
        type: 'new_zone',
        title: 'New Zone Alert',
        message: 'suspicious-activity • OPRRA, Cebu City • Level 4 - Critical Risk • 4 mins ago',
        timestamp: new Date(Date.now() - 4 * 60 * 1000), // 4 minutes ago (newest)
        read: false, // NEW notification - will show NEW badge and count in tab
        priority: 'critical',
        data: {
          reportType: 'suspicious-activity',
          locationAddress: 'OPRRA, Cebu City, Central Visayas, 6000, Philippines',
          distanceMeters: 10200,
          riskLevel: 4, // Admin-validated risk level
          adminLevel: 4, // Level 4 - Critical
          seenByUser: false // Hasn't been seen by user yet
        }
      },
      {
        id: 'test2',
        type: 'new_zone',
        title: 'New Zone Alert',
        message: 'theft • Babag, Cebu City, Central Visayas, Philippines • Level 2 - Moderate Risk • 3 hrs ago',
        timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        read: false, // NEW notification - will show NEW badge and count in tab
        priority: 'medium',
        data: {
          reportType: 'theft',
          locationAddress: 'Babag, Cebu City, Central Visayas, Philippines',
          distanceMeters: 2400,
          riskLevel: 2, // Admin-validated risk level
          adminLevel: 2, // Level 2 - Moderate
          seenByUser: false // Hasn't been seen by user yet
        }
      },
      {
        id: 'test3',
        type: 'new_zone',
        title: 'New Zone Alert',
        message: 'vandalism • Lahug, Cebu City, Central Visayas, Philippines • Level 3 - High Risk • 1 day ago',
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago (oldest)
        read: true, // Already read - no NEW badge, no count in tab
        priority: 'high',
        data: {
          reportType: 'vandalism',
          locationAddress: 'Lahug, Cebu City, Central Visayas, Philippines',
          distanceMeters: 800,
          riskLevel: 3, // Admin-validated risk level
          adminLevel: 3, // Level 3 - High
          seenByUser: true // Already seen by user
        }
      }
    ];

    this.notifications = testNotifications;
    this.saveNotifications();
    console.log('📱 Created test notifications:', this.notifications.length);
    console.log('📱 Tab badge will show "2" (2 unseen notifications)');
    console.log('📱 NEW badges will appear on the right side of unread notifications');
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

  // Clear test notifications
  private clearTestNotifications() {
    try {
      localStorage.removeItem('guardian_care_notifications');
      console.log('🧹 Cleared test notifications');
    } catch (error) {
      console.error('Error clearing test notifications:', error);
    }
  }
}
