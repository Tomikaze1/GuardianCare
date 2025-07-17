import { Component, OnInit } from '@angular/core';
import { AdminService } from '../../services/admin.service';
import { AlertController, LoadingController } from '@ionic/angular';

@Component({
  selector: 'app-incident-validation',
  templateUrl: './incident-validation.page.html',
  styleUrls: ['./incident-validation.page.scss'],
  standalone: false,
})
export class IncidentValidationPage implements OnInit {
  incidents: any[] = [];
  loading = true;
  filter = 'pending'; 

  constructor(
    private adminService: AdminService,
    private alertController: AlertController,
    private loadingController: LoadingController
  ) {}

  ngOnInit() {
    this.loadIncidents();
  }

  loadIncidents() {
    this.loading = true;
    this.adminService.getPendingIncidents().subscribe(incidents => {
      this.incidents = incidents;
      this.loading = false;
    });
  }

  async showIncidentDetails(incident: any) {
    const alert = await this.alertController.create({
      header: 'Incident Details',
      subHeader: `Type: ${incident.type}`,
      message: `
        <p><strong>Description:</strong> ${incident.description}</p>
        <p><strong>Location:</strong> ${incident.location?.address || 'Unknown'}</p>
        <p><strong>Reported:</strong> ${new Date(incident.timestamp).toLocaleString()}</p>
        <p><strong>Reporter:</strong> ${incident.reporterName || 'Anonymous'}</p>
        ${incident.media?.length ? '<p><strong>Media attached</strong></p>' : ''}
      `,
      buttons: ['OK']
    });
    await alert.present();
  }

  async validateIncident(incidentId: string, valid: boolean) {
    const loading = await this.loadingController.create({
      message: valid ? 'Validating incident...' : 'Rejecting incident...'
    });
    await loading.present();

    try {
      await this.adminService.validateIncident(incidentId, valid);
      this.loadIncidents();
    } catch (error) {
      console.error('Error validating incident:', error);
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to process incident. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      await loading.dismiss();
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'verified': return 'success';
      case 'rejected': return 'danger';
      case 'pending': return 'warning';
      default: return 'medium';
    }
  }

  segmentChanged(event: any) {
    this.filter = event.detail.value;
  }
}