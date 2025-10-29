import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ReportService } from '../../services/report.service';
import { NotificationHelpers, NotificationItem } from '../utils/notification-helpers';

@Injectable({ providedIn: 'root' })
export class NotificationsPageService {
  private notificationsSubject = new BehaviorSubject<NotificationItem[]>([]);
  public notifications$ = this.notificationsSubject.asObservable();
  
  private isLoading = new BehaviorSubject<boolean>(false);
  public isLoading$ = this.isLoading.asObservable();

  constructor(
    private reportService: ReportService,
    private authService: AuthService
  ) {}

  loadNotifications(): NotificationItem[] {
    const stored = localStorage.getItem('guardian_care_notifications');
    if (stored) {
      try {
        const storedNotifications = JSON.parse(stored);
        return storedNotifications.map((n: any) => ({
          ...n,
          timestamp: new Date(n.timestamp)
        }));
      } catch (error) {
        console.error('Error loading notifications from localStorage:', error);
        return [];
      }
    }
    return [];
  }

  saveNotifications(notifications: NotificationItem[]): void {
    localStorage.setItem('guardian_care_notifications', JSON.stringify(notifications));
    
    window.dispatchEvent(new CustomEvent('notificationsUpdated', {
      detail: { count: notifications.length }
    }));
    
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'guardian_care_notifications',
      newValue: JSON.stringify(notifications)
    }));
  }

  sortNotifications(notifications: NotificationItem[]): NotificationItem[] {
    return [...notifications].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  getFilteredNotifications(
    notifications: NotificationItem[], 
    filterType: 'all' | 'unread' | 'report' | 'zone',
    searchQuery: string = '',
    statusFilter: 'all' | 'unread' | 'read' | 'validated' | 'zone' = 'all',
    riskFilter: 'all' | 'low' | 'moderate' | 'high' | 'critical' = 'all',
    sortBy: 'recent' | 'priority' | 'type' = 'recent'
  ): NotificationItem[] {
    let filtered = notifications;
    
    // Backward-compatible main filter (from old UI)
    if (filterType === 'unread') {
      filtered = filtered.filter(n => !n.read);
    } else if (filterType === 'report') {
      filtered = filtered.filter(n => n.type === 'report_validated');
    } else if (filterType === 'zone') {
      filtered = filtered.filter(n => n.type === 'new_zone');
    }

    // STATUS filter from new panel
    switch (statusFilter) {
      case 'unread':
        filtered = filtered.filter(n => !n.read);
        break;
      case 'read':
        filtered = filtered.filter(n => n.read);
        break;
      case 'validated':
        filtered = filtered.filter(n => n.type === 'report_validated');
        break;
      case 'zone':
        filtered = filtered.filter(n => n.type === 'new_zone');
        break;
      default:
        break;
    }
    
    // RISK LEVEL filter
    if (riskFilter !== 'all') {
      const levelFor = (n: NotificationItem): number => {
        const level = Number(n.data?.adminLevel ?? n.data?.riskLevel ?? 0);
        return isNaN(level) ? 0 : level;
      };
      const inBucket = (lvl: number) => {
        switch (riskFilter) {
          case 'low': return lvl === 1;
          case 'moderate': return lvl === 2;
          case 'high': return lvl === 3;
          case 'critical': return lvl >= 4; // 4-5
          default: return true;
        }
      };
      filtered = filtered.filter(n => inBucket(levelFor(n)));
    }
    
    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(n => 
        n.title.toLowerCase().includes(query) ||
        n.message.toLowerCase().includes(query) ||
        n.data?.locationAddress?.toLowerCase().includes(query) ||
        n.data?.reportType?.toLowerCase().includes(query)
      );
    }
    
    // Sort
    if (sortBy === 'priority') {
      const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      filtered = [...filtered].sort((a, b) => (rank[b.priority] || 0) - (rank[a.priority] || 0));
    } else if (sortBy === 'type') {
      filtered = [...filtered].sort((a, b) => (a.type || '').localeCompare(b.type || ''));
    } else {
      filtered = this.sortNotifications(filtered);
    }

    return filtered;
  }

  getPaginatedNotifications(notifications: NotificationItem[], page: number, itemsPerPage: number = 20): NotificationItem[] {
    const end = (page + 1) * itemsPerPage;
    return notifications.slice(0, end);
  }

  hasMoreNotifications(notifications: NotificationItem[], currentPage: number, itemsPerPage: number = 20): boolean {
    const displayed = (currentPage + 1) * itemsPerPage;
    return notifications.length > displayed;
  }

  loadReportValidationNotifications(currentUser: any, existingNotifications: NotificationItem[]): Observable<NotificationItem[]> {
    return new Observable(observer => {
      this.reportService.getValidatedReports().subscribe(reports => {
        const lastCheckTime = this.getLastNotificationCheckTime();
        
        const validatedReports = reports.filter(report => 
          report.status === 'Validated' && report.validatedAt
        );
        
        // Remove notifications for deleted reports
        const updatedNotifications = this.removeNotificationsForDeletedReports(
          existingNotifications, 
          validatedReports
        );
        
        const newNotifications: NotificationItem[] = [];
        
        validatedReports.forEach(report => {
          const existingNotification = updatedNotifications.find(n => 
            n.data?.reportId === report.id
          );
          
          if (existingNotification) {
            const existingIndex = updatedNotifications.findIndex(n => n.data?.reportId === report.id);
            if (existingIndex !== -1) {
              updatedNotifications.splice(existingIndex, 1);
            }
          }
          
          const adminLevel = report.level ?? report.validationLevel ?? report.riskLevel ?? 1;
          const riskLevel = Number(adminLevel);
          const validatedDate = new Date(report.validatedAt);
          const timeStr = NotificationHelpers.formatDetailedTime(validatedDate);
          const isUserReport = report.userId === currentUser.uid;
          const isNewNotification = validatedDate > lastCheckTime;

          const notification: NotificationItem = {
            id: `validated_${report.id}`,
            type: isUserReport ? 'report_validated' : 'new_zone',
            title: isUserReport ? `Your Report Validated` : `New Zone Alert`,
            message: `${report.type}`,
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
          
          newNotifications.push(notification);
        });
        
        const allNotifications = [...updatedNotifications, ...newNotifications];
        observer.next(allNotifications);
        observer.complete();
      });
    });
  }

  private removeNotificationsForDeletedReports(notifications: NotificationItem[], validatedReports: any[]): NotificationItem[] {
    const existingReportIds = new Set(validatedReports.map(report => report.id));
    return notifications.filter(notification => {
      const reportId = notification.data?.reportId;
      return !reportId || existingReportIds.has(reportId);
    });
  }

  getLastNotificationCheckTime(): Date {
    const stored = localStorage.getItem('guardian_care_last_notification_check');
    if (stored) {
      return new Date(stored);
    }
    return new Date('2020-01-01');
  }

  updateLastNotificationCheckTime(): void {
    localStorage.setItem('guardian_care_last_notification_check', new Date().toISOString());
  }

  markNotificationAsRead(notification: NotificationItem, notifications: NotificationItem[]): NotificationItem[] {
    const index = notifications.findIndex(n => n.id === notification.id);
    if (index !== -1) {
      notifications[index].read = true;
      if (!notifications[index].data) {
        notifications[index].data = {};
      }
      notifications[index].data.seenByUser = true;
    }
    return notifications;
  }

  markAllNotificationsAsSeen(notifications: NotificationItem[]): NotificationItem[] {
    return notifications.map(notification => {
      if (!notification.read || !notification.data?.seenByUser) {
        notification.read = true;
        notification.data = notification.data || {};
        notification.data.seenByUser = true;
      }
      return notification;
    });
  }

  deleteNotification(notification: NotificationItem, notifications: NotificationItem[]): NotificationItem[] {
    return notifications.filter(n => n.id !== notification.id);
  }

  clearAllNotifications(): void {
    localStorage.removeItem('guardian_care_notifications');
    localStorage.removeItem('guardian_care_last_notification_check');
  }

  getUnreadCount(notifications: NotificationItem[]): number {
    return notifications.filter(n => !n.read).length;
  }
}
