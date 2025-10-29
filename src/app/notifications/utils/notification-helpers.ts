export interface NotificationItem {
  id: string;
  type: 'report_validated' | 'new_zone';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  data?: any;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export class NotificationHelpers {
  static formatTimestamp(timestamp: Date): string {
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

  static getRiskLevelColor(riskLevel: number | null | undefined): string {
    const level = Number(riskLevel ?? 1);
    
    switch (level) {
      case 1: return '#28a745'; // Green
      case 2: return '#ffc107'; // Yellow
      case 3: return '#fd7e14'; // Orange
      case 4: return '#dc3545'; // Red
      case 5: return '#8B0000'; // Dark red
      default: return '#6c757d'; // Gray
    }
  }

  static getRiskLevelText(riskLevel: number | null | undefined): string {
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

  static getNotificationIcon(type: string): string {
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

  static getNotificationColor(type: string): string {
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

  static getNotificationTypeLabel(type: string): string {
    switch (type) {
      case 'report_validated':
        return 'Your Report Validated';
      case 'new_zone':
        return 'New Zone Alert';
      default:
        return 'Notification';
    }
  }

  static getPriorityColor(priority: string): string {
    switch (priority) {
      case 'critical': return 'danger';
      case 'high': return 'warning';
      case 'medium': return 'primary';
      case 'low': return 'medium';
      default: return 'medium';
    }
  }

  static getPriorityIcon(priority: string): string {
    switch (priority) {
      case 'critical': return 'alert-circle';
      case 'high': return 'warning';
      case 'medium': return 'information-circle';
      case 'low': return 'checkmark-circle';
      default: return 'information-circle';
    }
  }

  static getTimeAgo(timestamp: Date): string {
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

  static formatDetailedTime(date: Date): string {
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

  static getGroupedNotifications(notifications: NotificationItem[]): { label: string, notifications: NotificationItem[] }[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const groups = {
      'Today': [] as NotificationItem[],
      'Yesterday': [] as NotificationItem[],
      'This Week': [] as NotificationItem[],
      'Earlier': [] as NotificationItem[]
    };
    
    notifications.forEach(notification => {
      const timestamp = notification.timestamp.getTime();
      
      if (timestamp >= today.getTime()) {
        groups['Today'].push(notification);
      } else if (timestamp >= yesterday.getTime()) {
        groups['Yesterday'].push(notification);
      } else if (timestamp >= weekAgo.getTime()) {
        groups['This Week'].push(notification);
      } else {
        groups['Earlier'].push(notification);
      }
    });
    
    return Object.entries(groups)
      .filter(([_, notifications]) => notifications.length > 0)
      .map(([label, notifications]) => ({ label, notifications }));
  }
}
