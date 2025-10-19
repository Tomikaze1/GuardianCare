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
    
    const stored = localStorage.getItem('guardian_care_notifications');
    if (stored) {
      try {
        const storedNotifications = JSON.parse(stored);
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
    
    this.loadReportValidationNotifications();
    
    this.isLoading = false;
  }

  clearAllNotifications() {
    this.notifications = [];
    this.filteredNotifications = [];
    
    localStorage.removeItem('guardian_care_notifications');
    localStorage.removeItem('guardian_care_last_notification_check');
    
    this.adminNotificationService.clearProcessedReports();
    
    console.log('🧹 Cleared all notifications');
  }

  private loadReportValidationNotifications() {
    console.log('👤 Current user for notifications:', this.currentUser);
    if (this.currentUser) {
      this.subscriptions.push(
        this.reportService.getValidatedReports().subscribe(reports => {
          console.log('📊 Loading validated reports from service:', reports.length);
          console.log('📊 Reports from service:', reports.map(r => ({
            id: r.id,
            type: r.type,
            status: r.status,
            validatedAt: r.validatedAt,
            reporterName: r.reporterName
          })));
          
          const lastCheckTime = this.getLastNotificationCheckTime();
          
          const validatedReports = reports.filter(report => {
            if (report.status !== 'Validated' || !report.validatedAt) return false;
            
            const isUserReport = report.userId === this.currentUser.uid;
            return true;
          });
          
          console.log('✅ All validated reports found:', validatedReports.length);
          
          const specificReport = validatedReports.find(report => 
            report.type === 'crime-theft' && 
            (report.reporterName === 'dasdadasd' || report.userId === 'dasdadasd' || 
             report.locationAddress?.includes('General Lim Street'))
          );
          console.log('🔍 Looking for crime-theft report from dasdadasd:', specificReport);
          
          console.log('📊 All report details:', validatedReports.map(r => ({
            id: r.id,
            type: r.type,
            reporterName: r.reporterName,
            userId: r.userId,
            locationAddress: r.locationAddress,
            status: r.status
          })));
          console.log('📅 Last notification check time:', lastCheckTime);
          
          validatedReports.forEach(report => {
            const existingNotification = this.notifications.find(n => 
              n.data?.reportId === report.id
            );
            
            console.log(`🔍 Processing report ${report.id}:`, {
              exists: !!existingNotification,
              userId: report.userId,
              currentUserId: this.currentUser?.uid,
              status: report.status,
              validatedAt: report.validatedAt,
              type: report.type,
              reporterName: report.reporterName,
              locationAddress: report.locationAddress
            });
            

            if (existingNotification) {
              const existingIndex = this.notifications.findIndex(n => n.data?.reportId === report.id);
              if (existingIndex !== -1) {
                this.notifications.splice(existingIndex, 1);
                console.log(`🗑️ Removed existing notification for report ${report.id}`);
              }
            }
            

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

            const isNewNotification = validatedDate > lastCheckTime;

            const notification: NotificationItem = {
              id: `validated_${report.id}`,
              type: isUserReport ? 'report_validated' : 'new_zone',
              title: isUserReport ? `Your Report Validated` : `New Zone Alert`,
              message: `${report.type} • ${report.locationAddress || report.location?.fullAddress || report.location?.simplifiedAddress || 'Unknown Location'} • Level ${riskLevel} - ${riskText} Risk • ${timeStr}`,
              timestamp: validatedDate,
              read: !isNewNotification,
              data: {
                reportId: report.id,
                reportType: report.type,
                riskLevel: riskLevel,
                adminLevel: riskLevel,
                location: report.location,
                locationAddress: report.locationAddress || report.location?.fullAddress || report.location?.simplifiedAddress || 'Unknown Location',
                validatedTime: timeStr,
                seenByUser: !isNewNotification,
                isUserReport: isUserReport,
                validatedAt: report.validatedAt,
                userId: report.userId
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
          });
          
          this.saveNotifications();
          this.sortNotifications();
          
          console.log(`📊 FINAL NOTIFICATION COUNT: ${this.notifications.length} notifications created from ${validatedReports.length} validated reports`);
          console.log(`📊 Notification breakdown:`, {
            totalNotifications: this.notifications.length,
            totalValidatedReports: validatedReports.length,
            userReports: this.notifications.filter(n => n.data?.isUserReport).length,
            otherUserReports: this.notifications.filter(n => !n.data?.isUserReport).length
          });
        })
      );
    }
  }

  getRiskLevelText(riskLevel: number | null | undefined): string {
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

    this.subscriptions.push(
      this.notificationManager.notifications$.subscribe(newNotifications => {
        const filteredNotifications = newNotifications.filter(notification => 
          notification.type !== 'system' && 
          notification.type !== 'engagement'
        );
        
        filteredNotifications.forEach(notification => {
          if (notification.type === 'report') {
            const convertedType = this.convertNotificationType(notification.type);
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
    
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'guardian_care_notifications',
      newValue: JSON.stringify(this.notifications)
    }));
  }

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

    if (this.activeFilter === 'new') {
      list = list.filter(n => this.isNewBadge(n));
    } else if (this.activeFilter === 'unread') {
      list = list.filter(n => !n.read);
    }

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
    this.markAsRead(notification);
    
    this.navigateToLocation(notification);
  }

  navigateToLocation(notification: NotificationItem) {
    const location = notification.data?.location;
    const locationAddress = notification.data?.locationAddress;
    
    if (location && location.lat && location.lng) {
      this.navController.navigateRoot('/tabs/home');
      
      const mapLocationData = {
        lat: location.lat,
        lng: location.lng,
        address: locationAddress || 'Notification Location',
        reportType: notification.data?.reportType,
        riskLevel: notification.data?.riskLevel || notification.data?.adminLevel,
        timestamp: notification.timestamp
      };
      
      localStorage.setItem('guardian_care_navigate_to_location', JSON.stringify(mapLocationData));
      
      console.log('🗺️ Navigating to location:', mapLocationData);
    } else {
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
        return 'checkmark-circle'; 
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
        return 'success'; 
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

    const level = Number(riskLevel ?? 1);
    
    switch (level) {
      case 1: return '#28a745'; 
      case 2: return '#ffc107'; 
      case 3: return '#fd7e14'; 
      case 4: return '#dc3545';
      case 5: return '#8B0000'; 
      default: return '#6c757d'; 
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
        return 'new_zone';
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

    if (minutes < 60) {
      if (minutes < 1) return 'just now';
      return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    }

    if (hours < 24) {
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }

    if (days === 1) {
      return '1 day ago';
    }

    if (days < 7) {
      return `${days} days ago`;
    }

    if (weeks === 1) {
      return '1 week ago';
    }

    if (weeks < 4) {
      return `${weeks} weeks ago`;
    }

    if (months === 1) {
      return '1 month ago';
    }

    if (months < 12) {
      return `${months} months ago`;
    }

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  ionViewDidEnter() {
    this.updateLastNotificationCheckTime();
    
    this.markAllNotificationsAsSeen();
  }

  ionViewWillLeave() {
    this.updateLastNotificationCheckTime();
  }

  private markAllNotificationsAsSeen() {
    let hasChanges = false;
    this.notifications.forEach(notification => {
      if (!notification.read || !notification.data?.seenByUser) {

        notification.read = true;
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


  shouldShowNewBadge(notification: NotificationItem): boolean {
    return false;
  }

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
    return 'success';
  }

  getStatusIcon(notification: NotificationItem): string {
    return 'checkmark-circle-outline';
  }

  getStatusText(notification: NotificationItem): string {
    return 'Validated';
  }



  formatNotificationMessage(notification: NotificationItem): string {
    const message = notification.message;
    let formattedMessage = message
      .replace(/\b(crime-theft|vandalism|assault|theft|verbal threats|lost item|suspicious-activity)\b/g, (match) => {
        return match.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('-');
      })
      .replace(/(\d+\.?\d*)\s*(km|m)\s+(away)/g, '<strong>$1 $2 $3</strong>')
      .replace(/\b(Level \d+ - (Low|Moderate|High|Critical|Extreme) Risk)\b/g, '<strong style="color: var(--primary-purple);">$1</strong>')
      .replace(/\b(just now|minutes? ago|hours? ago|days? ago|weeks? ago|months? ago)\b/g, (match) => {
        const capitalized = match.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        return `<strong>${capitalized}</strong>`;
      })
      .replace(/\b(Crime-Theft|Vandalism|Assault|Theft|Verbal Threats|Lost Item|Suspicious-Activity)\b/g, '<strong>$1</strong>');
    
    return formattedMessage;
  }

  private createTestNotifications() {
    const testNotifications: NotificationItem[] = [
      {
        id: 'test1',
        type: 'new_zone',
        title: 'New Zone Alert',
        message: 'suspicious-activity • OPRRA, Cebu City • Level 4 - Critical Risk • 4 mins ago',
        timestamp: new Date(Date.now() - 4 * 60 * 1000),
        read: false, 
        priority: 'critical',
        data: {
          reportType: 'suspicious-activity',
          locationAddress: 'OPRRA, Cebu City, Central Visayas, 6000, Philippines',
          distanceMeters: 10200,
          riskLevel: 4, 
          adminLevel: 4,
          seenByUser: false 
        }
      },
      {
        id: 'test2',
        type: 'new_zone',
        title: 'New Zone Alert',
        message: 'theft • Babag, Cebu City, Central Visayas, Philippines • Level 2 - Moderate Risk • 3 hrs ago',
        timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000), 
        read: false, 
        priority: 'medium',
        data: {
          reportType: 'theft',
          locationAddress: 'Babag, Cebu City, Central Visayas, Philippines',
          distanceMeters: 2400,
          riskLevel: 2, 
          adminLevel: 2, 
          seenByUser: false 
        }
      },
      {
        id: 'test3',
        type: 'new_zone',
        title: 'New Zone Alert',
        message: 'vandalism • Lahug, Cebu City, Central Visayas, Philippines • Level 3 - High Risk • 1 day ago',
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), 
        read: true, 
        priority: 'high',
        data: {
          reportType: 'vandalism',
          locationAddress: 'Lahug, Cebu City, Central Visayas, Philippines',
          distanceMeters: 800,
          riskLevel: 3, 
          adminLevel: 3, 
          seenByUser: true 
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
    this.subscriptions.push(
      this.adminNotificationService.validationEvents$.subscribe(events => {
        console.log('🔔 Admin validation events updated:', events.length);
        
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

  private clearTestNotifications() {
    try {
      localStorage.removeItem('guardian_care_notifications');
      console.log('🧹 Cleared test notifications');
    } catch (error) {
      console.error('Error clearing test notifications:', error);
    }
  }

  private clearAllRepeatedNotifications() {
    try {
      localStorage.removeItem('guardian_care_notifications');
      
      this.notifications = [];
      this.filteredNotifications = [];
      
      this.applyFiltersAndSort();
      
      console.log('🧹 Cleared all repeated notifications');
    } catch (error) {
      console.error('Error clearing repeated notifications:', error);
    }
  }
}
