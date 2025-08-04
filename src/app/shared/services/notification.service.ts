import { Injectable, ComponentRef, createComponent, ApplicationRef, Injector, Type, EnvironmentInjector } from '@angular/core';
import { NotificationBannerComponent, NotificationBanner } from '../components/notification-banner/notification-banner.component';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private notifications: ComponentRef<NotificationBannerComponent>[] = [];

  constructor(
    private appRef: ApplicationRef,
    private injector: Injector,
    private environmentInjector: EnvironmentInjector
  ) {}

  show(notification: NotificationBanner): void {
    const componentRef = createComponent(NotificationBannerComponent, {
      environmentInjector: this.environmentInjector,
      elementInjector: this.injector
    });

    componentRef.instance.notification = notification;
    
    // Handle dismiss
    componentRef.instance.dismiss.subscribe(() => {
      this.dismiss(componentRef);
    });

    // Handle action
    componentRef.instance.action.subscribe(() => {
      this.dismiss(componentRef);
    });

    // Add to DOM
    document.body.appendChild(componentRef.location.nativeElement);
    this.appRef.attachView(componentRef.hostView);
    this.notifications.push(componentRef);

    // Auto dismiss after duration
    if (notification.duration !== 0) {
      const duration = notification.duration || 5000;
      setTimeout(() => {
        this.dismiss(componentRef);
      }, duration);
    }
  }

  private dismiss(componentRef: ComponentRef<NotificationBannerComponent>): void {
    const element = componentRef.location.nativeElement;
    element.classList.add('dismissing');
    
    setTimeout(() => {
      const index = this.notifications.indexOf(componentRef);
      if (index > -1) {
        this.notifications.splice(index, 1);
      }
      
      this.appRef.detachView(componentRef.hostView);
      componentRef.destroy();
      
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }, 300);
  }

  // Convenience methods
  success(title: string, message: string, actionText?: string, duration?: number): void {
    this.show({
      type: 'success',
      title,
      message,
      actionText,
      duration
    });
  }

  error(title: string, message: string, actionText?: string, duration?: number): void {
    this.show({
      type: 'error',
      title,
      message,
      actionText,
      duration
    });
  }

  warning(title: string, message: string, actionText?: string, duration?: number): void {
    this.show({
      type: 'warning',
      title,
      message,
      actionText,
      duration
    });
  }

  info(title: string, message: string, actionText?: string, duration?: number): void {
    this.show({
      type: 'info',
      title,
      message,
      actionText,
      duration
    });
  }

  // Dismiss all notifications
  dismissAll(): void {
    this.notifications.forEach(componentRef => {
      this.dismiss(componentRef);
    });
  }
} 