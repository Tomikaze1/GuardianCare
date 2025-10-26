import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

export interface NotificationBanner {
  type: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message: string;
  actionText?: string;
  acknowledgeText?: string;
  duration?: number;
  dismissible?: boolean;
}

@Component({
  selector: 'app-notification-banner',
  templateUrl: './notification-banner.component.html',
  styleUrls: ['./notification-banner.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class NotificationBannerComponent {
  @Input() notification!: NotificationBanner;
  @Output() dismiss = new EventEmitter<void>();
  @Output() action = new EventEmitter<void>();
  @Output() acknowledge = new EventEmitter<void>();

  getIcon(): string {
    switch (this.notification.type) {
      case 'info': return 'information-circle';
      case 'success': return 'checkmark-circle';
      case 'error': return 'close-circle';
      case 'warning': return 'warning';
      default: return 'information-circle';
    }
  }

  getColorClass(): string {
    return `notification-${this.notification.type}`;
  }

  onDismiss(): void {
    this.dismiss.emit();
  }

  onAction(): void {
    this.action.emit();
  }

  onAcknowledge(): void {
    this.acknowledge.emit();
  }
} 