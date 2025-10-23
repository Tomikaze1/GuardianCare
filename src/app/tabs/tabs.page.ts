import { Component, OnInit, OnDestroy } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { NotificationManagerService } from '../services/notification-manager.service';
import { ReportService } from '../services/report.service';
import { AuthService } from '../services/auth.service';
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

  constructor(
    private notificationManager: NotificationManagerService,
    private reportService: ReportService,
    private authService: AuthService
  ) {}

  ngOnInit() {
    this.clearStuckHoverStates();
    
    this.clearTestNotifications();
    
    this.updateBadgeCount();
    this.loadLastSeenData();
    this.subscribeToValidatedReports();
    
    window.addEventListener('storage', () => {
      this.updateBadgeCount();
    });
  }

  ngOnDestroy() {
    if (this.notificationSubscription) {
      this.notificationSubscription.unsubscribe();
    }
    if (this.reportsSubscription) {
      this.reportsSubscription.unsubscribe();
    }
  }

  private clearTestNotifications() {
    try {
      localStorage.removeItem('guardian_care_notifications');
      console.log('🧹 Cleared test notifications from tabs');
    } catch (error) {
      console.warn('Could not clear test notifications:', error);
    }
  }

  private updateBadgeCount() {
    try {
      const stored = localStorage.getItem('guardian_care_notifications');
      if (stored) {
        const notifications = JSON.parse(stored);
        
        this.unreadCount = notifications.filter((n: any) => {
          return !n.read && !n.data?.seenByUser;
        }).length;
      } else {
        this.unreadCount = 0;
      }
    } catch (error) {
      console.warn('Could not update badge count:', error);
      this.unreadCount = 0;
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
      
      if (lastSeenValidatedReports) {
        this.lastSeenValidatedReports = new Set(JSON.parse(lastSeenValidatedReports));
      }
    } catch (error) {
      console.warn('Could not load last seen data:', error);
    }
  }

  private saveLastSeenData() {
    try {
      localStorage.setItem('lastSeenValidatedReports', JSON.stringify([...this.lastSeenValidatedReports]));
    } catch (error) {
      console.warn('Could not save last seen data:', error);
    }
  }

  private subscribeToValidatedReports() {
    this.reportsSubscription = this.reportService.getValidatedReports().subscribe(reports => {
      this.updateValidatedReportsCount(reports);
    });
  }

  private async updateValidatedReportsCount(reports: any[]) {
    const currentUser = await this.authService.getCurrentUser();
    if (!currentUser) return;

    let newCount = 0;
    
    reports.forEach(report => {
      if (report.id && !this.lastSeenValidatedReports.has(report.id)) {
        // Check if this is a new validated report from the current user
        if (report.userId === currentUser.uid) {
          newCount++;
        }
      }
    });

    this.newValidatedReportsCount = newCount;
  }

  onNotificationsTabClick() {
    // Mark all validated reports as seen
    this.reportsSubscription = this.reportService.getValidatedReports().subscribe(async reports => {
      const currentUser = await this.authService.getCurrentUser();
      if (currentUser) {
        reports.forEach(report => {
          if (report.id && report.userId === currentUser.uid) {
            this.lastSeenValidatedReports.add(report.id);
          }
        });
        this.saveLastSeenData();
        this.newValidatedReportsCount = 0;
      }
    });
  }
}
