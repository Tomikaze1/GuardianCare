import { Component, OnInit } from '@angular/core';
import { AdminService } from '../../services/admin.service';
import { AlertController, LoadingController } from '@ionic/angular';
import { DangerZone } from '../../models/zone.model';

@Component({
  selector: 'app-zone-management',
  templateUrl: './zone-management.page.html',
  styleUrls: ['./zone-management.page.scss'],
  standalone: false,
})
export class ZoneManagementPage implements OnInit {
  zones: DangerZone[] = [];
  editingZone: DangerZone | null = null;
  loading = true;
  newZoneMode = false;

  constructor(
    private adminService: AdminService,
    private alertController: AlertController,
    private loadingController: LoadingController
  ) {}

  ngOnInit() {
    this.loadZones();
  }

  loadZones() {
    this.loading = true;
    this.adminService.getZones().subscribe(zones => {
      this.zones = zones;
      this.loading = false;
    });
  }

  startEditing(zone: DangerZone) {
    this.editingZone = { ...zone };
    this.newZoneMode = false;
  }

  startNewZone() {
    this.editingZone = {
      id: '',
      name: 'New Zone',
      level: 'Neutral',
      coordinates: [],
      timeSlots: [],
      incidentsCount: 0,
      lastIncidentDate: ''
    };
    this.newZoneMode = true;
  }

  cancelEditing() {
    this.editingZone = null;
  }

  async saveZone() {
    if (!this.editingZone) return;

    const loading = await this.loadingController.create({
      message: 'Saving zone...'
    });
    await loading.present();

    try {
      if (this.newZoneMode) {
      } else {
        await this.adminService.updateZone(this.editingZone.id, {
          name: this.editingZone.name,
          level: this.editingZone.level,
          coordinates: this.editingZone.coordinates
        });
      }
      this.loadZones();
      this.editingZone = null;
    } catch (error) {
      console.error('Error saving zone:', error);
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to save zone. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      await loading.dismiss();
    }
  }

  async confirmDelete(zoneId: string) {
    const alert = await this.alertController.create({
      header: 'Confirm Delete',
      message: 'Are you sure you want to delete this zone?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          handler: () => this.deleteZone(zoneId)
        }
      ]
    });
    await alert.present();
  }

  async deleteZone(zoneId: string) {
    const loading = await this.loadingController.create({
      message: 'Deleting zone...'
    });
    await loading.present();

    try {
      await this.adminService.deleteZone(zoneId);
      this.loadZones();
    } catch (error) {
      console.error('Error deleting zone:', error);
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to delete zone. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      await loading.dismiss();
    }
  }

  getZoneColor(level: string): string {
    switch (level) {
      case 'Danger': return '#f44336';
      case 'Caution': return '#ff9800';
      case 'Neutral': return '#ffeb3b';
      case 'Safe': return '#4caf50';
      default: return '#9e9e9e';
    }
  }
}