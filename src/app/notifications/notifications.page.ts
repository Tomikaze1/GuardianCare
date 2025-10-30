import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { AlertController, NavController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from '../services/auth.service';
import { ReportService } from '../services/report.service';
import { NotificationManagerService } from '../services/notification-manager.service';
import { AdminNotificationService } from '../services/admin-notification.service';
import { Subscription } from 'rxjs';
import { NotificationHelpers, NotificationItem } from './utils/notification-helpers';
import { NotificationsPageService } from './services/notifications-page.service';

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotificationsPage implements OnInit, OnDestroy {
  notifications: NotificationItem[] = [];
  filteredNotifications: NotificationItem[] = [];
  displayedNotifications: NotificationItem[] = [];
  isLoading = false;
  currentUser: any = null;
  expandedGroups: { [label: string]: boolean } = {};
  
  // Filter and search
  filterType: 'all' | 'unread' | 'report' | 'zone' = 'all';
  searchQuery: string = '';
  statusFilter: 'all' | 'unread' | 'read' | 'validated' | 'zone' = 'all';
  riskFilter: 'all' | 'low' | 'moderate' | 'high' | 'critical' = 'all';
  sortBy: 'recent' | 'priority' | 'type' = 'recent';
  timeRange: 'recent' | 'week' | 'month' | 'old' = 'recent';
  
  // Pagination removed (show all)
  currentPage = 0;
  itemsPerPage = 0;
  hasMore = false;
  
  private subscriptions: Subscription[] = [];
  private processedReportIds = new Set<string>();
  private isLoadingNotifications = false;

  incidentTypes = [
    { value: 'crime-theft', label: 'Crime / Theft', icon: 'shield-outline' },
    { value: 'accident', label: 'Accident', icon: 'car-outline' },
    { value: 'emergency', label: 'Emergency', icon: 'medical-outline' },
    { value: 'suspicious-activity', label: 'Suspicious Activity', icon: 'eye-outline' },
    { value: 'lost-item', label: 'Lost Item', icon: 'search-outline' },
    { value: 'vandalism', label: 'Vandalism', icon: 'construct-outline' },
    { value: 'assault', label: 'Assault', icon: 'warning-outline' },
    { value: 'theft', label: 'Theft', icon: 'bag-outline' },
    { value: 'verbal-threats', label: 'Verbal Threats', icon: 'chatbubbles-outline' }
  ];

  constructor(
    private alertController: AlertController,
    private toastController: ToastController,
    private translateService: TranslateService,
    private authService: AuthService,
    private reportService: ReportService,
    private notificationManager: NotificationManagerService,
    private adminNotificationService: AdminNotificationService,
    private navController: NavController,
    private notificationsPageService: NotificationsPageService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    await this.loadUserProfile();
    this.loadNotifications();
    this.subscribeToNotifications();
    this.subscribeToAdminValidations();
    
      // Ensure existing notifications have correct seenByUser property
      this.ensureNotificationsHaveSeenByUser();
    
    this.updateDisplayedNotifications();
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
    this.notifications = this.notificationsPageService.loadNotifications();
    this.notifications = this.notificationsPageService.sortNotifications(this.notifications);
    this.loadReportValidationNotifications();
    this.isLoading = false;
  }

  async clearAllNotifications() {
    const alert = await this.alertController.create({
      header: 'Clear All Notifications',
      message: 'This will permanently remove all notifications. Continue?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Clear', role: 'destructive', handler: () => {
            this.notifications = [];
            this.notificationsPageService.clearAllNotifications();
            this.adminNotificationService.clearProcessedReports();
            this.updateDisplayedNotifications();
            this.presentToast('All notifications cleared');
          }
        }
      ]
    });
    await alert.present();
  }

  private loadReportValidationNotifications() {
    if (this.currentUser && !this.isLoadingNotifications) {
      this.isLoadingNotifications = true;
      this.subscriptions.push(
        this.notificationsPageService.loadReportValidationNotifications(this.currentUser, this.notifications).subscribe(newNotifications => {
          this.notifications = newNotifications;
          this.notificationsPageService.saveNotifications(this.notifications);
          this.notifications = this.notificationsPageService.sortNotifications(this.notifications);
          this.updateDisplayedNotifications();
          this.isLoadingNotifications = false;
          
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('notificationsUpdated'));
            const tabsPage = document.querySelector('app-tabs');
            if (tabsPage && (tabsPage as any).forceBadgeCountUpdate) {
              (tabsPage as any).forceBadgeCountUpdate();
            }
          }, 100);
        })
      );
    }
  }

  // Delegation to helpers
  getRiskLevelText(riskLevel: number | null | undefined): string {
    return NotificationHelpers.getRiskLevelText(riskLevel);
  }
  
  getRiskLevelColor(riskLevel: number | null | undefined): string {
    return NotificationHelpers.getRiskLevelColor(riskLevel);
  }
  
  formatTimestamp(timestamp: Date): string {
    return NotificationHelpers.formatTimestamp(timestamp);
  }
  
  getNotificationIcon(type: string): string {
    return NotificationHelpers.getNotificationIcon(type);
  }
  
  getNotificationColor(type: string): string {
    return NotificationHelpers.getNotificationColor(type);
  }
  
  getNotificationTypeLabel(type: string): string {
    return NotificationHelpers.getNotificationTypeLabel(type);
  }
  
  getPriorityColor(priority: string): string {
    return NotificationHelpers.getPriorityColor(priority);
  }
  
  getPriorityIcon(priority: string): string {
    return NotificationHelpers.getPriorityIcon(priority);
  }
  
  formatDetailedTime(date: Date): string {
    return NotificationHelpers.formatDetailedTime(date);
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
        
        this.notificationsPageService.saveNotifications(this.notifications);
        this.notifications = this.notificationsPageService.sortNotifications(this.notifications);
        this.updateDisplayedNotifications();
      })
    );
  }

  // New methods for filter, search, and pagination
  updateDisplayedNotifications() {
    this.filteredNotifications = this.notificationsPageService.getFilteredNotifications(
      this.notifications, 
      this.filterType,
      this.searchQuery,
      this.statusFilter,
      this.riskFilter,
      this.sortBy,
      this.timeRange
    );
    // Flat list directly based on current filters
    this.displayedNotifications = [...this.filteredNotifications];
    this.hasMore = false;
    
    this.cdr.markForCheck();
  }
  
  onFilterChange(filterType: 'all' | 'unread' | 'report' | 'zone') {
    this.filterType = filterType;
    this.updateDisplayedNotifications();
  }
  
  onSearchQueryChange() {
    this.updateDisplayedNotifications();
  }

  onStatusFilterChange(value: 'all' | 'unread' | 'read' | 'validated' | 'zone') {
    this.statusFilter = value;
    this.updateDisplayedNotifications();
  }

  onRiskFilterChange(value: 'all' | 'low' | 'moderate' | 'high' | 'critical') {
    this.riskFilter = value;
    this.updateDisplayedNotifications();
  }

  onSortByChange(value: 'recent' | 'priority' | 'type') {
    this.sortBy = value;
    this.updateDisplayedNotifications();
  }

  onTimeRangeChange(value: 'recent' | 'week' | 'month' | 'old') {
    this.timeRange = value;
    this.updateDisplayedNotifications();
  }
  
  // loadMore removed
  
  // Grouping removed for flat filtered list

  private saveNotifications() {
    this.notificationsPageService.saveNotifications(this.notifications);
  }

  private sortNotifications() {
    this.notifications = this.notificationsPageService.sortNotifications(this.notifications);
  }

  isNewBadge(notification: NotificationItem): boolean {
    return !notification.data?.seenByUser;
  }

  shouldShowNewBadge(notification: NotificationItem): boolean {
    return this.isNewBadge(notification);
  }

  getDistanceText(notification: NotificationItem): string {
    const meters = (notification as any)?.data?.distanceMeters ?? (notification as any)?.distanceMeters;
    if (meters == null) return '';
    return meters < 1000 ? `${Math.round(meters)}m away` : `${(meters / 1000).toFixed(1)}km away`;
  }

  markAsRead(notification: NotificationItem) {
    this.notifications = this.notificationsPageService.markNotificationAsRead(notification, this.notifications);
    this.saveNotifications();
    this.updateDisplayedNotifications();
  }

  handleNotificationClick(notification: NotificationItem) {
    // Mark as read and seen
    this.notifications = this.notificationsPageService.markNotificationAsRead(notification, this.notifications);
    this.saveNotifications();
    this.updateDisplayedNotifications();
    
    // Update last check time when user clicks on a notification
    this.notificationsPageService.updateLastNotificationCheckTime();
    
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
    } else {
      this.navController.navigateRoot('/tabs/home');
    }
  }

  markAllAsRead() {
    this.notifications = this.notificationsPageService.markAllNotificationsAsSeen(this.notifications);
    this.notificationsPageService.saveNotifications(this.notifications);
    this.notificationsPageService.updateLastNotificationCheckTime();
    this.updateDisplayedNotifications();
    this.presentToast('All notifications marked as read');
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
            this.notifications = this.notificationsPageService.deleteNotification(notification, this.notifications);
              this.saveNotifications();
            this.updateDisplayedNotifications();
          }
        }
      ]
    });
    
    await alert.present();
  }

  private async presentToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 1600,
      position: 'top',
      color: 'dark',
      buttons: [{ text: 'OK', role: 'cancel' }]
    });
    await toast.present();
  }



  async handleRefresh(event: any) {
    await this.loadNotifications();
    event.target.complete();
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


  ionViewDidEnter() {
    this.notifications = this.notificationsPageService.markAllNotificationsAsSeen(this.notifications);
    this.notificationsPageService.saveNotifications(this.notifications);
    
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('notificationsUpdated'));
      const tabsPage = document.querySelector('app-tabs');
      if (tabsPage && (tabsPage as any).forceBadgeCountUpdate) {
        (tabsPage as any).forceBadgeCountUpdate();
      }
    }, 300);
  }

  ionViewWillLeave() {
    this.notificationsPageService.updateLastNotificationCheckTime();
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

  private ensureNotificationsHaveSeenByUser() {
    let hasChanges = false;
    this.notifications.forEach(notification => {
      if (!notification.data) {
        notification.data = {};
        hasChanges = true;
      }
      if (notification.data.seenByUser === undefined) {
        notification.data.seenByUser = false;
        hasChanges = true;
      }
    });
    
    if (hasChanges) {
      this.saveNotifications();
    }
  }

  getUnreadCount(): number {
    return this.notificationsPageService.getUnreadCount(this.notifications);
  }
  
  getTotalNotificationCount(): number {
    return this.notifications.length;
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

  getEmptyTitle(): string {
    switch (this.timeRange) {
      case 'recent':
        return 'No Recent Notifications';
      case 'week':
        return 'No Notifications This Week';
      case 'month':
        return 'No Notifications This Month';
      case 'old':
        return 'No Older Notifications';
      default:
        return 'No Notifications Yet';
    }
  }

  getEmptySubtitle(): string {
    switch (this.timeRange) {
      case 'recent':
        return "You're all caught up in the last 24 hours.";
      case 'week':
        return "You're all caught up for the past 7 days.";
      case 'month':
        return "You're all caught up for the past 30 days.";
      case 'old':
        return 'There are no notifications older than 30 days.';
      default:
        return "You don't have any notifications yet. New incident reports and validations will appear here.";
    }
  }

  private subscribeToAdminValidations() {
    this.subscriptions.push(
      this.adminNotificationService.validationEvents$.subscribe(() => {
        this.loadReportValidationNotifications();
        
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('notificationsUpdated'));
          const tabsPage = document.querySelector('app-tabs');
          if (tabsPage && (tabsPage as any).forceBadgeCountUpdate) {
            (tabsPage as any).forceBadgeCountUpdate();
          }
        }, 100);
      })
    );
  }

  getIncidentTypeIcon(type: string): string {
    const typeObj = this.incidentTypes.find(t => t.value === type);
    return typeObj?.icon || 'alert-circle-outline';
  }

  getIncidentTypeLabel(type: string): string {
    const typeObj = this.incidentTypes.find(t => t.value === type);
    return typeObj?.label || type;
  }

}

