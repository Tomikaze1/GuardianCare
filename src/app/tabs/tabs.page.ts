import { Component, OnInit, OnDestroy } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { NotificationManagerService } from '../services/notification-manager.service';
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
  private notificationSubscription?: Subscription;

  constructor(private notificationManager: NotificationManagerService) {}

  ngOnInit() {
    this.clearStuckHoverStates();
    
    // Clear any existing test notifications
    this.clearTestNotifications();
    
    // Calculate badge count based on NEW notifications (not all unread)
    this.updateBadgeCount();
    
    // Listen for storage changes to update badge in real-time
    window.addEventListener('storage', () => {
      this.updateBadgeCount();
    });
  }

  ngOnDestroy() {
    if (this.notificationSubscription) {
      this.notificationSubscription.unsubscribe();
    }
  }

  private clearTestNotifications() {
    try {
      // Clear localStorage to remove test notifications
      localStorage.removeItem('guardian_care_notifications');
      console.log('🧹 Cleared test notifications from tabs');
    } catch (error) {
      console.warn('Could not clear test notifications:', error);
    }
  }

  private updateBadgeCount() {
    try {
      // Get notifications from localStorage (same source as notifications page)
      const stored = localStorage.getItem('guardian_care_notifications');
      if (stored) {
        const notifications = JSON.parse(stored);
        
        // Count only NEW notifications (not seen by user)
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
}
