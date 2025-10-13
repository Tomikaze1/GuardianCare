import { Component, OnInit, OnDestroy } from '@angular/core';
import { AlertController, LoadingController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from '../services/auth.service';
import { ReportService } from '../services/report.service';
import { NotificationManagerService } from '../services/notification-manager.service';
import { AdminNotificationService } from '../services/admin-notification.service';
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
  
  activeFilter: 'all' | 'new' | 'unread' = 'all';
  stickyNew: boolean = true;
  
  private subscriptions: Subscription[] = [];
  private processedReportIds = new Set<string>();

  constructor(
    private alertController: AlertController,
    private loadingController: LoadingController,
    private translateService: TranslateService,
    private authService: AuthService,
    private reportService: ReportService,
    private notificationManager: NotificationManagerService,
    private adminNotificationService: AdminNotificationService
  ) {}

  async ngOnInit() {
    await this.loadUserProfile();
    this.loadNotifications();
    this.subscribeToNotifications();
    this.subscribeToAdminValidations();
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
    
    // Clear all existing notifications to start fresh
    this.clearAllNotifications();
    
    // Only load new notifications from real-time sources
    this.loadReportValidationNotifications();
    this.loadNewZoneNotifications();
    
    this.isLoading = false;
  }

  clearAllNotifications() {
    // Clear all notifications from memory
    this.notifications = [];
    
    // Clear all stored notifications from localStorage
    localStorage.removeItem('guardian_care_notifications');
    localStorage.removeItem('guardian_care_last_notification_check');
    
    // Clear processed report IDs to start fresh
    this.adminNotificationService.clearProcessedReports();
    
    console.log('🧹 Cleared all existing notifications - starting fresh');
  }

  private loadReportValidationNotifications() {
    // Show notifications for ALL validated reports (not just user's own)
    if (this.currentUser) {
      this.subscriptions.push(
        this.reportService.getValidatedReports().subscribe(reports => {
          // Get the last time user checked notifications
          const lastCheckTime = this.getLastNotificationCheckTime();
          
          // Filter for ALL reports that were validated AFTER last check by ADMIN
          const validatedReports = reports.filter(report => {
            const validatedDate = new Date(report.validatedAt || report.updatedAt);
            return report.status === 'Validated' &&
                   report.validatedAt && // Must have validation timestamp (admin validated)
                   validatedDate > lastCheckTime;
          });
          
          validatedReports.forEach(report => {
            const existingNotification = this.notifications.find(n => 
              n.type === 'report_validated' && n.data?.reportId === report.id
            );
            
            if (!existingNotification) {
              const riskLevel = report.level || report.riskLevel || 1;
              const validatedDate = new Date(report.validatedAt);
              const timeStr = this.formatDetailedTime(validatedDate);
              const isUserReport = report.userId === this.currentUser.uid;
              const riskText = this.getRiskLevelText(riskLevel);

              if (report.id && this.processedReportIds.has(report.id)) {
                return;
              }
              
              const notification: NotificationItem = {
                id: `validated_${report.id}`,
                type: 'report_validated',
                title: isUserReport ? `Your Report Validated` : `New ${report.type} Incident`,
                message: isUserReport 
                  ? `${report.type} • ${report.location.simplifiedAddress || report.locationAddress} • ${timeStr}`
                  : `${report.type} • ${report.location.simplifiedAddress || report.locationAddress} • ${riskText} Risk • ${timeStr}`,
                timestamp: validatedDate,
                read: false,
                data: {
                  reportId: report.id,
                  reportType: report.type,
                  riskLevel: riskLevel,
                  location: report.location,
                  locationAddress: report.locationAddress,
                  validatedTime: timeStr
                },
                priority: riskLevel >= 4 ? 'critical' : riskLevel >= 3 ? 'high' : 'medium'
              };
              
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

  private loadNewZoneNotifications() {
    // Load notifications about new zones added - ONLY AFTER last check (admin validated)
    this.subscriptions.push(
      this.reportService.getValidatedReports().subscribe(reports => {
        // Get the last time user checked notifications
        const lastCheckTime = this.getLastNotificationCheckTime();
        
        // Filter for admin-validated reports AFTER last check (excluding own reports)
        const newZones = reports.filter(report => {
          const validatedDate = new Date(report.validatedAt || report.updatedAt);
          return report.status === 'Validated' && 
                 report.validatedAt && // Must have admin validation timestamp
                 validatedDate > lastCheckTime &&
                 report.userId !== this.currentUser?.uid; // Don't show own reports as new zones
        });
        
        newZones.forEach(report => {
          const existingNotification = this.notifications.find(n => 
            n.type === 'new_zone' && n.data?.reportId === report.id
          );
          
          if (!existingNotification) {
            const riskLevel = report.level || report.riskLevel || 1;
            const validatedDate = new Date(report.validatedAt);
            const timeStr = this.formatDetailedTime(validatedDate);
            
            const notification: NotificationItem = {
              id: `zone_${report.id}`,
              type: 'new_zone',
              title: `New Incident`,
              message: `${report.type} • ${report.location.simplifiedAddress || report.locationAddress} • ${timeStr}`,
              timestamp: validatedDate,
              read: false,
              data: {
                reportId: report.id,
                reportType: report.type,
                riskLevel: riskLevel,
                location: report.location,
                locationAddress: report.locationAddress,
                validatedTime: timeStr
              },
              priority: riskLevel >= 4 ? 'critical' : riskLevel >= 3 ? 'high' : 'medium'
            };
            
            this.notifications.unshift(notification);
          }
        });
        
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
    localStorage.setItem('guardian_care_notifications', JSON.stringify(this.notifications));
    this.applyFiltersAndSort();
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

  toggleStickyNew(ev: any) {
    this.stickyNew = !!ev.detail?.checked;
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

    // sticky NEW to top
    if (this.stickyNew) {
      const now = Date.now();
      const fresh = list.filter(n => (now - n.timestamp.getTime()) <= 5 * 60 * 1000);
      const older = list.filter(n => (now - n.timestamp.getTime()) > 5 * 60 * 1000);
      // keep timestamp order within groups
      this.filteredNotifications = [...fresh, ...older];
    } else {
      this.filteredNotifications = list;
    }
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

  markAllAsRead() {
    this.notifications.forEach(notification => {
      notification.read = true;
    });
    this.saveNotifications();
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
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return timestamp.toLocaleDateString();
  }

  async handleRefresh(event: any) {
    await this.loadNotifications();
    event.target.complete();
  }


  getRiskLevelColor(riskLevel: number): string {
    if (riskLevel >= 5) return 'danger';
    if (riskLevel >= 4) return 'warning';
    if (riskLevel >= 3) return 'primary';
    if (riskLevel >= 2) return 'secondary';
    return 'medium';
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
  }

  ionViewWillLeave() {
    this.updateLastNotificationCheckTime();
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
}
