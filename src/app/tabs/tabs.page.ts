import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { NotificationManagerService } from '../services/notification-manager.service';
import { ReportService } from '../services/report.service';
import { AuthService } from '../services/auth.service';
import { AdminNotificationService } from '../services/admin-notification.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-tabs',
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
  standalone: false,
  animations: [
    trigger('pageTransition', [
      transition(':enter', [
        style({ transform: 'translateX(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateX(0%)', opacity: 1 }))
      ]),
      transition(':leave', [
        style({ transform: 'translateX(0%)', opacity: 1 }),
        animate('300ms ease-in', style({ transform: 'translateX(-100%)', opacity: 0 }))
      ])
    ])
  ]
})
export class TabsPage implements OnInit, OnDestroy {
  unreadCount = 0;
  newValidatedReportsCount = 0;
  private notificationSubscription?: Subscription;
  private reportsSubscription?: Subscription;
  private lastSeenValidatedReports: Set<string> = new Set();
  private pollingInterval?: any;
  private notificationEventListeners: Array<{ event: string; listener: (e: any) => void }> = [];

  constructor(
    private notificationManager: NotificationManagerService,
    private reportService: ReportService,
    private authService: AuthService,
    private adminNotificationService: AdminNotificationService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit() {
    console.log('🔔 TabsPage ngOnInit started');
    this.clearStuckHoverStates();
    
    // Don't clear notifications - let them persist
    console.log('📱 Tabs page initialized - preserving existing notifications');
    
    this.loadLastSeenData();
    this.subscribeToValidatedReports();
    this.subscribeToNotifications();
    this.subscribeToAdminValidations();
    
    // Update badge count immediately and then again after a delay
    this.updateNotificationBadgeCount();
    
    // Start polling for new validated reports every 3 seconds
    this.startPollingForValidatedReports();
    
    // Force refresh badge count after a short delay to ensure it's updated
    setTimeout(() => {
      this.updateNotificationBadgeCount();
      console.log('🔔 Forced badge count refresh on init');
    }, 500);
    
    // Listen for window visibility change (when user switches tabs or app)
    document.addEventListener('visibilitychange', () => {
      console.log('🔔 Document visibility changed, updating badge count');
      this.updateNotificationBadgeCount();
      this.cdr.detectChanges();
    });
    
    // Listen for storage changes (cross-tab communication)
    window.addEventListener('storage', () => {
      console.log('🔔 Storage event detected, updating badge count');
      this.updateNotificationBadgeCount();
      this.cdr.detectChanges();
    });
    
    // Listen for custom notifications updated event
    const handleNotificationsUpdated = () => {
      console.log('🔔 Custom notifications updated event detected, updating badge count');
      
      // CRITICAL: Run inside Angular zone to trigger change detection on mobile
      this.ngZone.run(() => {
        // Force immediate update
        this.updateNotificationBadgeCount();
        
        // Update again after delays to ensure mobile compatibility
        setTimeout(() => {
          console.log('🔔 Secondary update (100ms)');
          this.updateNotificationBadgeCount();
        }, 100);
        
        setTimeout(() => {
          console.log('🔔 Tertiary update (300ms)');
          this.updateNotificationBadgeCount();
        }, 300);
        
        setTimeout(() => {
          console.log('🔔 Final update (500ms)');
          this.updateNotificationBadgeCount();
        }, 500);
      });
    };
    
    window.addEventListener('notificationsUpdated', handleNotificationsUpdated);
    
    // Store listener reference for cleanup
    this.notificationEventListeners = this.notificationEventListeners || [];
    this.notificationEventListeners.push({ event: 'notificationsUpdated', listener: handleNotificationsUpdated });
    
    // Listen for focus event (when user returns to app/tab)
    window.addEventListener('focus', () => {
      console.log('🔔 Window focused, updating badge count');
      this.updateNotificationBadgeCount();
      this.cdr.detectChanges();
    });
    
    console.log('🔔 TabsPage ngOnInit completed');
    
    // Expose test method globally for debugging
    (window as any).testBadgeUpdate = () => this.testBadgeUpdate();
  }

  // Ionic lifecycle hook - called when navigating to tabs route
  ionViewWillEnter() {
    console.log('🔔 TabsPage ionViewWillEnter - updating badge count');
    this.updateNotificationBadgeCount();
    this.cdr.detectChanges();
  }

  // Called when navigating to tabs route
  ionViewDidEnter() {
    console.log('🔔 TabsPage ionViewDidEnter - updating badge count');
    this.updateNotificationBadgeCount();
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    console.log('🔔 TabsPage ngOnDestroy - cleaning up subscriptions');
    
    if (this.notificationSubscription) {
      this.notificationSubscription.unsubscribe();
    }
    if (this.reportsSubscription) {
      this.reportsSubscription.unsubscribe();
    }
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      console.log('🔔 Cleared polling interval');
    }
    
    // Remove event listeners
    if (this.notificationEventListeners) {
      this.notificationEventListeners.forEach(({ event, listener }) => {
        window.removeEventListener(event, listener);
      });
      this.notificationEventListeners = [];
    }
  }
  
  private startPollingForValidatedReports() {
    console.log('🔔 Starting polling for validated reports every 2 seconds for mobile compatibility');
    
    // Poll every 2 seconds for mobile - more frequent for better responsiveness
    this.pollingInterval = setInterval(() => {
      console.log('🔔 Polling interval triggered');
      
      // CRITICAL: Run inside Angular zone to trigger change detection
      this.ngZone.run(() => {
        // Force badge update
        this.updateNotificationBadgeCount();
      });
      
    }, 2000);
  }

  private clearTestNotifications() {
    try {
      localStorage.removeItem('guardian_care_notifications');
      console.log('🧹 Cleared test notifications from tabs');
    } catch (error) {
      console.warn('Could not clear test notifications:', error);
    }
  }


  private clearStuckHoverStates() {
    setTimeout(() => {
      const tabButtons = document.querySelectorAll('ion-tab-button');
      tabButtons.forEach(button => {
        button.classList.remove('hover', 'active', 'pressed', 'ion-activatable', 'ion-focused');
        const element = button as HTMLElement;
        element.removeAttribute('aria-pressed');
        element.removeAttribute('aria-selected');
        setTimeout(() => {
          (button as HTMLElement).style.transform = '';
        }, 100);
      });
      const tabBar = document.querySelector('ion-tab-bar');
      if (tabBar) {
        tabBar.classList.remove('ion-activatable');
      }
    }, 100);
  }

  private loadLastSeenData() {
    try {
      const lastSeenValidatedReports = localStorage.getItem('lastSeenValidatedReports');
      console.log('🔔 Loading last seen data from localStorage:', lastSeenValidatedReports);
      
      if (lastSeenValidatedReports) {
        this.lastSeenValidatedReports = new Set(JSON.parse(lastSeenValidatedReports));
        console.log('🔔 Loaded last seen reports:', [...this.lastSeenValidatedReports]);
      } else {
        console.log('🔔 No last seen data found in localStorage');
      }
    } catch (error) {
      console.warn('Could not load last seen data:', error);
    }
  }

  private saveLastSeenData() {
    try {
      const dataToSave = JSON.stringify([...this.lastSeenValidatedReports]);
      localStorage.setItem('lastSeenValidatedReports', dataToSave);
      console.log('🔔 Saved last seen data to localStorage:', dataToSave);
    } catch (error) {
      console.warn('Could not save last seen data:', error);
    }
  }

  private subscribeToValidatedReports() {
    console.log('🔔 Subscribing to validated reports...');
    this.reportsSubscription = this.reportService.getValidatedReports().subscribe(reports => {
      console.log('🔔 Received validated reports:', reports.length, 'reports');
      console.log('🔔 Reports details:', reports.map(r => ({ id: r.id, userId: r.userId, validatedAt: r.validatedAt })));
      
      // Update badge count immediately when new validated reports arrive
      this.updateNotificationBadgeCount();
      this.cdr.detectChanges();
      
      this.updateValidatedReportsCount(reports);
    });
  }

  private async updateValidatedReportsCount(reports: any[]) {
    const currentUser = await this.authService.getCurrentUser();
    if (!currentUser) {
      console.log('🔔 No current user found, skipping badge update');
      return;
    }

    console.log('🔔 Current user:', currentUser.uid);
    console.log('🔔 Last seen reports:', [...this.lastSeenValidatedReports]);
    
    // Clean up lastSeenValidatedReports for reports that no longer exist
    this.cleanupDeletedReportsFromSeenList(reports);
    
    let newCount = 0;
    
    reports.forEach(report => {
      if (report.id && !this.lastSeenValidatedReports.has(report.id)) {
        // Check if this is a new validated report from the current user
        if (report.userId === currentUser.uid) {
          console.log('🔔 New validated report found:', report.id, report.type);
          newCount++;
        }
      }
    });

    console.log('🔔 New validated reports count:', newCount);
    console.log('🔔 Previous count:', this.newValidatedReportsCount);
    
    this.newValidatedReportsCount = newCount;
    
    // DON'T update unreadCount here - let the notification badge system handle it
    // The badge should show unseen notifications, not new validated reports
    
    console.log('🔔 Updated validated reports count:', this.newValidatedReportsCount);
    console.log('🔔 Badge count will be updated by notification system');
  }

  private subscribeToNotifications() {
    console.log('🔔 Subscribing to notifications...');
    
    // Get notifications from localStorage (where NotificationsPage stores them)
    this.updateNotificationBadgeCount();
    
    // Listen for storage changes
    window.addEventListener('storage', (event) => {
      if (event.key === 'guardian_care_notifications') {
        console.log('🔔 Storage event detected for notifications');
        this.updateNotificationBadgeCount();
      }
    });
    
    // Listen for custom notifications updated event
    window.addEventListener('notificationsUpdated', () => {
      console.log('🔔 Custom notifications updated event detected in subscribeToNotifications');
      this.updateNotificationBadgeCount();
    });
    
    // Also listen to NotificationManagerService for real-time updates
    this.notificationSubscription = this.notificationManager.notifications$.subscribe(notifications => {
      console.log('🔔 Received notifications from manager:', notifications.length);
      this.updateNotificationBadgeCount();
    });
  }

  private subscribeToAdminValidations() {
    console.log('🔔 Subscribing to admin validations in tabs page...');
    
    // Subscribe to admin validation events to trigger immediate badge updates
    this.adminNotificationService.validationEvents$.subscribe(events => {
      console.log('🔔 Admin validation events detected in tabs page:', events.length);
      
      // Force badge count update when admin validations are detected
      setTimeout(() => {
        this.updateNotificationBadgeCount();
        console.log('🔔 Badge count updated after admin validation in tabs page');
      }, 150);
    });
  }

  private updateNotificationBadgeCount() {
    // Run inside Angular zone to ensure change detection works
    this.ngZone.run(() => {
      try {
        const stored = localStorage.getItem('guardian_care_notifications');
        
        if (stored) {
          const notifications = JSON.parse(stored);
          
          // Count unread notifications (notifications that are not marked as read)
          const unreadNotifications = notifications.filter((n: any) => !n.read);
          
          const oldCount = this.unreadCount;
          this.unreadCount = unreadNotifications.length;
          
          // Log changes
          if (oldCount !== this.unreadCount) {
            console.log('🔔 BADGE COUNT CHANGED:', oldCount, '→', this.unreadCount);
          }
          
          // CRITICAL: Force change detection inside Angular zone
          this.cdr.detectChanges();
          this.cdr.markForCheck();
          
          console.log('🔔 Badge update (inside ngZone):', {
            unreadCount: this.unreadCount,
            willShow: this.unreadCount > 0
          });
        } else {
          const oldCount = this.unreadCount;
          this.unreadCount = 0;
          
          if (oldCount !== this.unreadCount) {
            console.log('🔔 Badge count changed to 0');
          }
          
          this.cdr.detectChanges();
          this.cdr.markForCheck();
        }
      } catch (error) {
        console.error('❌ Error updating badge count:', error);
        this.unreadCount = 0;
        this.cdr.detectChanges();
        this.cdr.markForCheck();
      }
    });
  }

  onNotificationsTabClick() {
    console.log('🔔 Notifications tab clicked, updating badge count...');
    
    // Update badge count immediately
    this.updateNotificationBadgeCount();
    
    // Force a refresh of the badge count after a short delay
    setTimeout(() => {
      this.updateNotificationBadgeCount();
      console.log('🔔 Forced badge count refresh after tab click');
    }, 100);
    
    // Mark all validated reports as seen when user clicks notifications tab
    this.markAllValidatedReportsAsSeen();
    
    console.log('🔔 Notifications tab clicked - marked reports as seen');
    
    // The actual badge clearing will happen in ionViewDidEnter of notifications page
    // This ensures the badge disappears as soon as user enters the notifications page
  }

  // Method to handle when user switches away from notifications tab
  onTabChange(event: any) {
    console.log('🔔 Tab changed to:', event.detail?.tab, event.tab);
    
    // Always update badge count when switching tabs
    setTimeout(() => {
      this.updateNotificationBadgeCount();
      this.cdr.detectChanges();
      console.log('🔔 Updated badge count after tab change');
    }, 100);
    
    // Update again after a longer delay for mobile
    setTimeout(() => {
      this.updateNotificationBadgeCount();
      this.cdr.detectChanges();
      console.log('🔔 Secondary badge count update after tab change');
    }, 300);
  }

  // Public method to force badge count update (can be called from other components)
  public forceBadgeCountUpdate() {
    console.log('🔔 Force badge count update called');
    this.updateNotificationBadgeCount();
  }

  // Method to manually test badge updates (for debugging)
  public testBadgeUpdate() {
    console.log('🔔 TEST: Manual badge count update triggered');
    this.updateNotificationBadgeCount();
    
    // Also check localStorage directly
    const stored = localStorage.getItem('guardian_care_notifications');
    console.log('🔔 TEST: Current localStorage notifications:', stored);
  }

  private async markAllValidatedReportsAsSeen() {
    // Get current validated reports and mark them all as seen
    const currentUser = await this.authService.getCurrentUser();
    if (currentUser) {
      this.reportService.getValidatedReports().subscribe(reports => {
        reports.forEach(report => {
          if (report.userId === currentUser.uid && report.id) {
            this.lastSeenValidatedReports.add(report.id);
          }
        });
        this.saveLastSeenData();
        console.log('🔔 Marked all validated reports as seen');
      });
    }
  }

  private cleanupDeletedReportsFromSeenList(reports: any[]) {
    // Get all current report IDs
    const currentReportIds = new Set(reports.map(report => report.id));
    
    // Remove report IDs from lastSeenValidatedReports that no longer exist
    const reportsToRemove: string[] = [];
    this.lastSeenValidatedReports.forEach(reportId => {
      if (!currentReportIds.has(reportId)) {
        reportsToRemove.push(reportId);
      }
    });
    
    // Remove deleted reports from the seen list
    reportsToRemove.forEach(reportId => {
      this.lastSeenValidatedReports.delete(reportId);
      console.log(`🗑️ Removed deleted report ${reportId} from seen list`);
    });
    
    if (reportsToRemove.length > 0) {
      this.saveLastSeenData();
      console.log(`🗑️ Cleaned up ${reportsToRemove.length} deleted reports from seen list`);
    }
  }
}
