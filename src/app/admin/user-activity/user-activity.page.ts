import { Component, OnInit } from '@angular/core';
import { AdminService } from '../../services/admin.service';
import { AlertController } from '@ionic/angular';

@Component({
  selector: 'app-user-activity',
  templateUrl: './user-activity.page.html',
  styleUrls: ['./user-activity.page.scss'],
  standalone: false,
})
export class UserActivityPage implements OnInit {
  activities: any[] = [];
  loading = true;
  searchQuery = '';

  constructor(
    private adminService: AdminService,
    private alertController: AlertController
  ) {}

  ngOnInit() {
    this.loadActivities();
  }

  loadActivities() {
    this.loading = true;
    this.adminService.getUserActivity().subscribe(activities => {
      this.activities = activities;
      this.loading = false;
    });
  }

  async showActivityDetails(activity: any) {
    const alert = await this.alertController.create({
      header: 'Activity Details',
      message: `
        <p><strong>User:</strong> ${activity.userName || 'System'}</p>
        <p><strong>Action:</strong> ${activity.action}</p>
        <p><strong>Timestamp:</strong> ${new Date(activity.timestamp).toLocaleString()}</p>
        <p><strong>Details:</strong> ${activity.details || 'No additional details'}</p>
      `,
      buttons: ['OK']
    });
    await alert.present();
  }

  filterActivities() {
    if (!this.searchQuery) {
      return this.activities;
    }
    return this.activities.filter(activity => 
      activity.userName?.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
      activity.action.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
      activity.details?.toLowerCase().includes(this.searchQuery.toLowerCase())
    );
  }

  formatActionType(type: string): string {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
}