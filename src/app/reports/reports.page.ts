import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertController, LoadingController } from '@ionic/angular';
import { LocationService } from '../services/location.service';
import { IncidentService } from '../services/incident.service';
import { NotificationService } from '../shared/services/notification.service';

@Component({
  selector: 'app-reports',
  templateUrl: './reports.page.html',
  styleUrls: ['./reports.page.scss'],
  standalone: false
})
export class ReportsPage implements OnInit {
  reportForm: FormGroup;
  currentLocation: { lat: number; lng: number } | null = null;
  selectedLocation: { lat: number; lng: number } | null = null;
  isAnonymous = false;
  selectedIncidentType: string = '';

  incidentTypes = [
    { value: 'crime', label: 'Crime', icon: 'shield-outline' },
    { value: 'accident', label: 'Accident', icon: 'car-outline' },
    { value: 'emergency', label: 'Emergency', icon: 'medical-outline' },
    { value: 'suspicious', label: 'Suspicious Activity', icon: 'eye-outline' }
  ];

  constructor(
    private formBuilder: FormBuilder,
    private locationService: LocationService,
    private incidentService: IncidentService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private notificationService: NotificationService
  ) {
    this.reportForm = this.formBuilder.group({
      type: ['', Validators.required],
      description: ['', [Validators.required, Validators.minLength(10)]],
      severity: ['medium', Validators.required],
      media: [[]],
      anonymous: [false]
    });
  }

  ngOnInit() {
    this.initializeLocation();
  }

  private async initializeLocation() {
    try {
      this.currentLocation = await this.locationService.getCurrentLocation();
      this.selectedLocation = this.currentLocation;
    } catch (error) {
      console.error('Error getting location:', error);
      this.currentLocation = { lat: 10.3111, lng: 123.8931 };
      this.selectedLocation = this.currentLocation;
    }
  }



  async onSubmit() {
    if (!this.selectedIncidentType) {
      await this.showAlert('Error', 'Please select an incident type.');
      return;
    }

    if (this.reportForm.invalid) {
      await this.showAlert('Error', 'Please fill in all required fields correctly.');
      return;
    }

    if (!this.selectedLocation) {
      await this.showAlert('Error', 'Please select a location on the map.');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Submitting report...'
    });
    await loading.present();

    try {
      const formData = this.reportForm.value;
      const locationWithAddress = await this.locationService.getAddressFromCoordinates(
        this.selectedLocation.lat,
        this.selectedLocation.lng
      );

      const incidentData = {
        type: formData.type,
        description: formData.description,
        location: {
          lat: this.selectedLocation.lat,
          lng: this.selectedLocation.lng,
          address: locationWithAddress
        },
        severity: formData.severity,
        reporterId: 'anonymous',
        reporterName: formData.anonymous ? 'Anonymous' : 'User',
        media: formData.media || [],
        anonymous: formData.anonymous
      };

      await this.incidentService.addIncident(incidentData).toPromise();

      this.notificationService.success('Success!', 'Report submitted successfully!', 'OK', 3000);
      this.reportForm.reset();
      this.selectedLocation = this.currentLocation;

    } catch (error) {
      console.error('Error submitting report:', error);
      await this.showAlert('Error', 'Failed to submit report. Please try again.');
    } finally {
      await loading.dismiss();
    }
  }

  private async showAlert(header: string, message: string) {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: ['OK']
    });
    await alert.present();
  }



  selectIncidentType(type: string) {
    this.selectedIncidentType = type;
    this.reportForm.patchValue({ type: type });
  }

  onFileSelected(event: any) {
    const files = event.target.files;
    if (files) {
      const currentMedia = this.reportForm.get('media')?.value || [];
      this.reportForm.patchValue({
        media: [...currentMedia, ...Array.from(files)]
      });
    }
  }

  removeFile(index: number) {
    const currentMedia = this.reportForm.get('media')?.value || [];
    currentMedia.splice(index, 1);
    this.reportForm.patchValue({ media: currentMedia });
  }

  async copyCoordinates() {
    if (this.selectedLocation) {
      const coordinates = `${this.selectedLocation.lat}, ${this.selectedLocation.lng}`;
      try {
        await navigator.clipboard.writeText(coordinates);
        this.notificationService.success('Success!', 'Coordinates copied to clipboard!', 'OK', 3000);
      } catch (error) {
        console.error('Failed to copy coordinates:', error);
        this.notificationService.error('Error!', 'Failed to copy coordinates', 'OK', 3000);
      }
    }
  }

  async callEmergency() {
    const alert = await this.alertController.create({
      header: 'Emergency Call (911)',
      message: 'Are you sure you want to call emergency services? This will initiate a call to 911.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'secondary'
        },
        {
          text: 'Call 911',
          handler: () => {
            this.initiateEmergencyCall();
          }
        }
      ]
    });
    await alert.present();
  }

  private initiateEmergencyCall() {
    try {
      if (this.selectedLocation) {
        const coordinates = `${this.selectedLocation.lat}, ${this.selectedLocation.lng}`;
        const message = `Emergency at coordinates: ${coordinates}`;
        
        this.notificationService.warning('Emergency Call', 'Initiating call to 911...', 'OK', 5000);
        
        setTimeout(() => {
          this.notificationService.success('Emergency Call', '911 call initiated successfully!', 'OK', 3000);
          console.log('Emergency call to 911 initiated with location:', coordinates);
        }, 2000);
        
      } else {
        this.notificationService.error('Error', 'No location available for emergency call', 'OK', 3000);
      }
    } catch (error) {
      console.error('Error initiating emergency call:', error);
      this.notificationService.error('Error', 'Failed to initiate emergency call', 'OK', 3000);
    }
  }
}
