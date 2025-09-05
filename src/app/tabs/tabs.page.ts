import { Component, OnInit } from '@angular/core';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';

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
    ]),
    trigger('tabButtonAnimation', [
      transition(':enter', [
        style({ transform: 'scale(0.8)', opacity: 0 }),
        animate('200ms ease-out', style({ transform: 'scale(1)', opacity: 1 }))
      ]),
      transition('* => *', [
        animate('150ms ease-in-out')
      ])
    ])
  ]
})
export class TabsPage implements OnInit {

  constructor() { }

  ngOnInit() {
    // Clear any stuck hover states on mobile
    this.clearStuckHoverStates();
  }

  private clearStuckHoverStates() {
    // Force clear any stuck hover states by removing focus and hover classes
    setTimeout(() => {
      const tabButtons = document.querySelectorAll('ion-tab-button');
      tabButtons.forEach(button => {
        // Remove any stuck hover states
        button.classList.remove('hover', 'active', 'pressed', 'ion-activatable', 'ion-focused');
        
        // Force reflow to clear any CSS transitions
        button.style.transform = '';
        button.style.boxShadow = '';
        button.style.background = '';
        
        // Force remove any Ionic-specific classes
        const element = button as HTMLElement;
        element.removeAttribute('aria-pressed');
        element.removeAttribute('aria-selected');
        
        // Reset after a brief moment
        setTimeout(() => {
          button.style.transform = '';
          button.style.boxShadow = '';
          button.style.background = '';
        }, 100);
      });
      
      // Also try to reset the tab bar itself
      const tabBar = document.querySelector('ion-tab-bar');
      if (tabBar) {
        tabBar.classList.remove('ion-activatable');
      }
    }, 100);
  }

}
