import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

export interface HeatmapZoneNotificationData {
  title: string;
  message: string;
  location: string;
  riskLevel: number;
  incident: string;
  reportedDate: string;
  type: 'heatmap' | 'caution' | 'danger';
}

@Component({
  selector: 'app-heatmap-zone-notification',
  templateUrl: './heatmap-zone-notification.component.html',
  styleUrls: ['./heatmap-zone-notification.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class HeatmapZoneNotificationComponent implements OnInit {
  @Input() data!: HeatmapZoneNotificationData;
  @Output() dismiss = new EventEmitter<void>();
  @Output() viewSafetyTips = new EventEmitter<void>();

  ngOnInit() {
    // Auto-dismiss after 10 seconds if user doesn't interact
    setTimeout(() => {
      this.onDismiss();
    }, 10000);
  }

  getIcon(): string {
    switch (this.data.type) {
      case 'danger': return 'warning';
      case 'caution': return 'warning-outline';
      case 'heatmap': 
      default: return 'location';
    }
  }

  getColorClass(): string {
    switch (this.data.type) {
      case 'danger': return 'notification-danger';
      case 'caution': return 'notification-caution';
      case 'heatmap':
      default: return 'notification-heatmap';
    }
  }

  getRiskLevelText(): string {
    switch (this.data.riskLevel) {
      case 5: return 'Critical';
      case 4: return 'High';
      case 3: return 'Moderate';
      case 2: return 'Unknown';
      case 1:
      default: return 'Low';
    }
  }

  onDismiss(): void {
    this.dismiss.emit();
  }

  onViewSafetyTips(): void {
    this.viewSafetyTips.emit();
  }
}

