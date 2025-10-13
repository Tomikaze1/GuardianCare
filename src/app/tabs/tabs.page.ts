import { Component, OnInit, OnDestroy } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';

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
  private storageListener = (e: StorageEvent) => {
    if (e.key === 'guardian_care_notifications') {
      this.updateUnreadFromLocal();
    }
  };
  private intervalId: any;

  constructor() {}

  ngOnInit() {
    this.clearStuckHoverStates();
    this.updateUnreadFromLocal();
    window.addEventListener('storage', this.storageListener);
    // Refresh periodically in case other parts update without storage events
    this.intervalId = setInterval(() => this.updateUnreadFromLocal(), 4000);
  }

  ngOnDestroy() {
    window.removeEventListener('storage', this.storageListener);
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private updateUnreadFromLocal() {
    try {
      const raw = localStorage.getItem('guardian_care_notifications');
      if (!raw) {
        this.unreadCount = 0;
        return;
      }
      const arr = JSON.parse(raw) as Array<{ read?: boolean }>; 
      this.unreadCount = Array.isArray(arr) ? arr.filter(n => !n.read).length : 0;
    } catch {
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
