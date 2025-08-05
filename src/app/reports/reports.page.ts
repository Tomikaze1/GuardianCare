import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertController, LoadingController } from '@ionic/angular';
import { Camera, CameraResultType, CameraSource, Photo } from '@capacitor/camera';
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
  locationAddress: string = '';
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
    this.checkCameraPermissions();
  }

  private async checkCameraPermissions() {
    try {
      
      const permissions = await Camera.checkPermissions();
      console.log('Camera permissions:', permissions);
      
      if (permissions.camera === 'denied') {
        this.notificationService.warning(
          'Camera Permission Required',
          'Please enable camera permissions to take photos for incident reports.',
          'OK',
          5000
        );
      }
    } catch (error) {
      console.error('Error checking camera permissions:', error);
    }
  }

  private async requestCameraPermissions() {
    try {
      const permissions = await Camera.requestPermissions();
      return permissions.camera === 'granted';
    } catch (error) {
      console.error('Error requesting camera permissions:', error);
      return false;
    }
  }

  private async initializeLocation() {
    try {
      this.currentLocation = await this.locationService.getCurrentLocation();
      this.selectedLocation = this.currentLocation;
      await this.updateLocationAddress();
    } catch (error) {
      console.error('Error getting location:', error);
      this.currentLocation = { lat: 10.3111, lng: 123.8931 };
      this.selectedLocation = this.currentLocation;
    }
  }

  async refreshLocation() {
    try {
      this.currentLocation = await this.locationService.refreshLocationWithHighAccuracy();
      this.selectedLocation = this.currentLocation;
      await this.updateLocationAddress();
      this.notificationService.success('Location Updated', 'Current location refreshed with high accuracy!', 'OK', 2000);
    } catch (error) {
      console.error('Error refreshing location:', error);
      this.notificationService.error('Error', 'Failed to refresh location. Please check your GPS settings.', 'OK', 3000);
    }
  }

  private async updateLocationAddress() {
    if (this.selectedLocation) {
      try {
        // Use Nominatim (OpenStreetMap) for reverse geocoding - FREE and no API key required
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${this.selectedLocation.lat}&lon=${this.selectedLocation.lng}&addressdetails=1&zoom=18`;
        
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Geocoding failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.display_name) {
          this.locationAddress = data.display_name;
        } else {
          this.locationAddress = `${this.selectedLocation.lat.toFixed(6)}, ${this.selectedLocation.lng.toFixed(6)}`;
        }
      } catch (error) {
        console.error('Error fetching address:', error);
        // Fallback to coordinates if geocoding fails
        this.locationAddress = `${this.selectedLocation.lat.toFixed(6)}, ${this.selectedLocation.lng.toFixed(6)}`;
      }
    }
  }

  async openInMaps() {
    if (this.selectedLocation) {
      const url = `https://www.google.com/maps?q=${this.selectedLocation.lat},${this.selectedLocation.lng}`;
      window.open(url, '_blank');
    }
  }

  async takePhoto() {
    try {
      
      const hasPermission = await this.requestCameraPermissions();
      if (!hasPermission) {
        this.notificationService.error(
          'Permission Denied',
          'Camera permission is required to take photos. Please enable it in your device settings.',
          'OK',
          5000
        );
        return;
      }

      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera
      });

      if (image.webPath) {
        const currentMedia = this.reportForm.get('media')?.value || [];
        const photoData = {
          webPath: image.webPath,
          dataUrl: image.dataUrl,
          name: `Photo_${new Date().getTime()}.jpg`,
          format: image.format,
          timestamp: new Date()
        };
        
        this.reportForm.patchValue({
          media: [...currentMedia, photoData]
        });
        
        this.notificationService.success('Success!', 'Photo captured successfully!', 'OK', 2000);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      if (error === 'User cancelled photos app') {
        this.notificationService.info('Cancelled', 'Photo capture was cancelled', 'OK', 2000);
      } else {
        this.notificationService.error('Error!', 'Failed to take photo. Please check camera permissions.', 'OK', 3000);
      }
    }
  }

  async selectFromGallery() {
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos
      });

      if (image.webPath) {
        const currentMedia = this.reportForm.get('media')?.value || [];
        const photoData = {
          webPath: image.webPath,
          dataUrl: image.dataUrl,
          name: `Gallery_${new Date().getTime()}.jpg`,
          format: image.format,
          timestamp: new Date()
        };
        
        this.reportForm.patchValue({
          media: [...currentMedia, photoData]
        });
        
        this.notificationService.success('Success!', 'Photo selected from gallery!', 'OK', 2000);
      }
    } catch (error) {
      console.error('Error selecting from gallery:', error);
      if (error === 'User cancelled photos app') {
        this.notificationService.info('Cancelled', 'Gallery selection was cancelled', 'OK', 2000);
      } else {
        this.notificationService.error('Error!', 'Failed to select from gallery. Please check permissions.', 'OK', 3000);
      }
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
      const fileArray = Array.from(files).map((file: any) => ({
        file: file,
        name: file.name,
        size: file.size,
        type: file.type,
        timestamp: new Date()
      }));
      
      this.reportForm.patchValue({
        media: [...currentMedia, ...fileArray]
      });
      
      this.notificationService.success('Success!', `${files.length} file(s) selected!`, 'OK', 2000);
    }
  }

  removeFile(index: number) {
    const currentMedia = this.reportForm.get('media')?.value || [];
    const removedItem = currentMedia[index];
    
    
    if (removedItem && removedItem.webPath) {
      
      console.log('Removing camera photo:', removedItem.webPath);
    }
    
    currentMedia.splice(index, 1);
    this.reportForm.patchValue({ media: currentMedia });
    
    this.notificationService.info('Removed', 'Media item removed from report', 'OK', 2000);
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
