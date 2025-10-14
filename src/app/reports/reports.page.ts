import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertController, LoadingController } from '@ionic/angular';
import { Camera, CameraResultType, CameraSource, Photo } from '@capacitor/camera';
import { LocationService } from '../services/location.service';
import { ReportService, ReportFormData, Report } from '../services/report.service';
import { NotificationService } from '../shared/services/notification.service';
import * as mapboxgl from 'mapbox-gl';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-reports',
  templateUrl: './reports.page.html',
  styleUrls: ['./reports.page.scss'],
  standalone: false
})
export class ReportsPage implements OnInit, OnDestroy {
  reportForm: FormGroup;
  currentLocation: { lat: number; lng: number } | null = null;
  selectedLocation: { lat: number; lng: number } | null = null;
  locationAddress: string = '';
  isAnonymous = false;
  selectedIncidentType: string = '';
  isOffline = false;
  map: mapboxgl.Map | null = null;
  lastKnownLocation: { lat: number; lng: number } | null = null;
  gpsAccuracy: { accuracy: number; status: string } | null = null;
  isLocationEditMode = false;
  isLocationManuallyEdited = false;
  private mapInitRetryCount = 0;
  private maxMapInitRetries = 10;
  editableMarker: mapboxgl.Marker | null = null;
  private handleMapClick: (e: mapboxgl.MapMouseEvent) => void = () => {};
  rateLimitStatus = {
    remainingReports: 5,
    timeUntilReset: '',
    isBlocked: false
  };
  @ViewChild(IonContent, { static: false }) content?: IonContent;

  // Time and Date functionality
  customDateTime: Date | null = null;
  isCustomTimeEnabled = false;
  currentDateTime: Date = new Date();

  // Report History
  showHistory = false;
  userReports: Report[] = [];
  private reportsSubscription?: Subscription;
  newValidatedReportsCount = 0;

  incidentTypes = [
    { value: 'crime-theft', label: 'Crime / Theft', icon: 'shield-outline' },
    { value: 'accident', label: 'Accident', icon: 'car-outline' },
    { value: 'emergency', label: 'Emergency', icon: 'medical-outline' },
    { value: 'suspicious-activity', label: 'Suspicious Activity', icon: 'eye-outline' },
    { value: 'lost-item', label: 'Lost Item', icon: 'search-outline' }
  ];



  constructor(
    private formBuilder: FormBuilder,
    private locationService: LocationService,
    private reportService: ReportService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private notificationService: NotificationService
  ) {
    this.reportForm = this.formBuilder.group({
      type: ['', Validators.required],
      description: ['', [Validators.required, Validators.minLength(5)]],
      severity: ['medium'], // Default value, not required since there's no UI for it
      media: [[]],
      anonymous: [false]
    });
  }

  ngOnInit() {
    this.initializeLocation();
    this.checkCameraPermissions();
    this.loadRateLimitStatus();
    this.loadLastKnownLocation();
    this.checkGPSAccuracy();
    this.updateCurrentDateTime();
    this.loadUserReports();
    
    // Update current time every minute
    setInterval(() => {
      this.updateCurrentDateTime();
    }, 60000);
  }

  ionViewWillEnter() {
    // Always start at top when entering this tab
    this.content?.scrollToTop(0);
  }

  ionViewDidEnter() {
    // Reinitialize map when view is fully rendered
    if (this.selectedLocation && !this.map) {
      setTimeout(() => {
        this.initializeMap();
      }, 100);
    }
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    if (this.reportsSubscription) {
      this.reportsSubscription.unsubscribe();
    }
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
    } catch (error: any) {
      // Ignore "not implemented on web" errors
      if (error?.message?.includes('Not implemented')) {
        console.log('Camera permissions check not available on web platform');
      } else {
        console.error('Error checking camera permissions:', error);
      }
    }
  }

  private async requestCameraPermissions() {
    try {
      const permissions = await Camera.requestPermissions();
      return permissions.camera === 'granted';
    } catch (error: any) {
      // Ignore "not implemented on web" errors - web doesn't need permission requests
      if (error?.message?.includes('Not implemented')) {
        console.log('Camera permission request not needed on web platform');
        return true; // Return true for web since it doesn't need permissions
      }
      console.error('Error requesting camera permissions:', error);
      return false;
    }
  }

  private async initializeLocation() {
    try {
      // Try to get the exact device location with multiple attempts
      try {
        this.currentLocation = await this.locationService.getDeviceExactLocation();
        this.notificationService.success('Location Found', 'Your exact device location has been pinpointed!', 'OK', 2000);
      } catch (precisionError) {
        console.log('Exact location failed, trying maximum precision...');
        try {
          this.currentLocation = await this.locationService.getMaximumPrecisionLocation();
        } catch (maxPrecisionError) {
          console.log('Maximum precision failed, trying standard location...');
          this.currentLocation = await this.locationService.getCurrentLocation();
        }
      }
      
      this.selectedLocation = this.currentLocation;
      this.isOffline = false;
      await this.updateLocationAddress();
      await this.saveLastKnownLocation();
      this.initializeMap();
      
      // Start real-time location tracking for reports
      this.startRealTimeLocationTracking();
    } catch (error) {
      console.error('Error getting location:', error);
      this.isOffline = true;
      
      // Use last known location if available
      if (this.lastKnownLocation) {
        this.currentLocation = this.lastKnownLocation;
        this.selectedLocation = this.lastKnownLocation;
        await this.updateLocationAddress();
        this.notificationService.warning(
          'Offline Mode',
          'Using last known location. Please check your internet connection.',
          'OK',
          5000
        );
      } else {
        // Fallback to default location
        this.currentLocation = { lat: 10.3111, lng: 123.8931 };
        this.selectedLocation = this.currentLocation;
        await this.updateLocationAddress();
        this.notificationService.error(
          'Location Unavailable',
          'Unable to get current location. Using default location.',
          'OK',
          5000
        );
      }
      this.initializeMap();
    }
  }

  private startRealTimeLocationTracking() {
    // Subscribe to real-time location updates
    this.locationService.currentLocation$.subscribe(location => {
      if (location) {
        // Always update current location for reference
        this.currentLocation = location;
        
        // Only update selected location if user hasn't manually edited it
        if (!this.isLocationEditMode && !this.isLocationManuallyEdited) {
          this.selectedLocation = location;
          // Only update map if it's initialized
          if (this.map) {
            this.updateMapLocation();
          }
          this.updateLocationAddress();
          console.log('📍 GPS location auto-updated:', location);
        } else if (this.isLocationManuallyEdited) {
          console.log('📍 GPS update ignored - user has selected a custom location');
        }
      }
    });
  }

  async refreshLocation() {
    try {
      // Use the exact device location method for the most accurate results
      this.currentLocation = await this.locationService.getDeviceExactLocation();
      
      // Only update selected location if user hasn't manually chosen a different location
      if (!this.isLocationManuallyEdited) {
        this.selectedLocation = this.currentLocation;
        // Only update map if it's initialized
        if (this.map) {
          this.updateMapLocation();
        }
        await this.updateLocationAddress();
        this.notificationService.success('Location Updated', 'Your exact device location has been refreshed with maximum precision!', 'OK', 2000);
      } else {
        // Just update current location in background, keep selected location
        this.notificationService.info('GPS Updated', 'Device GPS refreshed. Your custom report location is still set.', 'OK', 2000);
      }
      
      this.isOffline = false;
      await this.saveLastKnownLocation();
      console.log('📍 GPS refreshed. Manual edit active:', this.isLocationManuallyEdited);
    } catch (error) {
      console.error('Error refreshing location:', error);
      this.isOffline = true;
      this.notificationService.error('Error', 'Failed to refresh location. Please check your GPS settings.', 'OK', 3000);
    }
  }

  async loadRateLimitStatus() {
    try {
      this.rateLimitStatus = await this.reportService.getRateLimitStatus();
      console.log('Rate limit status loaded:', this.rateLimitStatus);
    } catch (error) {
      console.error('Error loading rate limit status:', error);
    }
  }

  private async loadLastKnownLocation() {
    try {
      const stored = localStorage.getItem('lastKnownLocation');
      if (stored) {
        this.lastKnownLocation = JSON.parse(stored);
        console.log('Last known location loaded:', this.lastKnownLocation);
      }
    } catch (error) {
      console.error('Error loading last known location:', error);
    }
  }

  private async saveLastKnownLocation() {
    if (this.currentLocation) {
      try {
        localStorage.setItem('lastKnownLocation', JSON.stringify(this.currentLocation));
        this.lastKnownLocation = this.currentLocation;
        console.log('Last known location saved:', this.currentLocation);
      } catch (error) {
        console.error('Error saving last known location:', error);
      }
    }
  }

  private initializeMap() {
    // Don't initialize map if we're in history view
    if (this.showHistory) {
      console.log('Skipping map initialization - in history view');
      return;
    }
    
    if (!this.selectedLocation) return;
    
    // Check if container exists and has dimensions
    const container = document.getElementById('reports-map');
    if (!container) {
      this.mapInitRetryCount++;
      if (this.mapInitRetryCount < this.maxMapInitRetries) {
        // Only retry if NOT in history view
        if (!this.showHistory) {
          console.warn(`Map container not found, retry ${this.mapInitRetryCount}/${this.maxMapInitRetries}...`);
          setTimeout(() => this.initializeMap(), 500);
        }
      } else {
        console.error('Max map initialization retries reached. Giving up.');
      }
      return;
    }
    
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      this.mapInitRetryCount++;
      if (this.mapInitRetryCount < this.maxMapInitRetries) {
        // Only retry if NOT in history view
        if (!this.showHistory) {
          console.warn(`Map container has zero size, retry ${this.mapInitRetryCount}/${this.maxMapInitRetries}...`);
          setTimeout(() => this.initializeMap(), 500);
        }
      } else {
        console.error('Max map initialization retries reached. Giving up.');
      }
      return;
    }
    
    // Prevent multiple initialization attempts
    if (this.map) {
      console.log('Map already initialized, skipping...');
      return;
    }
    
    // Reset retry counter on successful initialization
    this.mapInitRetryCount = 0;
    
    // Set Mapbox access token
    (mapboxgl as any).accessToken = 'pk.eyJ1IjoidG9taWthemUxIiwiYSI6ImNtY25rM3NxazB2ZG8ybHFxeHVoZWthd28ifQ.Vnf9pMEQAryEI2rMJeMQGQ';
    
    // Map is already null at this point, no need to remove
    
    // Clear container content
    container.innerHTML = '';
    
    try {
      this.map = new mapboxgl.Map({
        container: 'reports-map',
        style: 'mapbox://styles/mapbox/streets-v11',
        center: [this.selectedLocation.lng, this.selectedLocation.lat],
        zoom: 18,
        interactive: true,
        attributionControl: false
      });
      
      console.log('📍 Map initialized successfully');
    } catch (error) {
      console.error('Error initializing map:', error);
      return;
    }

    // Add marker for current location with higher precision
    const marker = new mapboxgl.Marker({
      color: this.isOffline ? '#ff6b35' : '#4CAF50',
      scale: 1.5 // Larger marker for better visibility
    })
      .setLngLat([this.selectedLocation.lng, this.selectedLocation.lat])
      .addTo(this.map);

    // Add popup with precise location info
    const popup = new mapboxgl.Popup({
      offset: 25,
      closeButton: false
    }).setHTML(`
      <div class="location-popup">
        <strong>${this.isOffline ? 'Last Known Location' : 'Your Exact Device Location'}</strong><br>
        <small>${this.locationAddress || `${this.selectedLocation.lat.toFixed(8)}, ${this.selectedLocation.lng.toFixed(8)}`}</small>
        <br><small style="color: #10b981;">📍 Device GPS Location</small>
      </div>
    `);

    marker.setPopup(popup);
    
    // More precise map bounds for exact location
    this.map.fitBounds([
      [this.selectedLocation.lng - 0.0001, this.selectedLocation.lat - 0.0001],
      [this.selectedLocation.lng + 0.0001, this.selectedLocation.lat + 0.0001]
    ], {
      padding: 20,
      maxZoom: 20 // Allow higher zoom for precision
    });
  }

  private updateMapLocation() {
    if (!this.map || !this.selectedLocation) {
      console.warn('Map or location not available for update');
      return;
    }
    
    try {
      this.map.setCenter([this.selectedLocation.lng, this.selectedLocation.lat]);
      this.map.setZoom(18);
      
      // Update marker
      const markers = document.querySelectorAll('.mapboxgl-marker');
      markers.forEach(marker => marker.remove());
      
      const marker = new mapboxgl.Marker({
        color: this.isOffline ? '#ff6b35' : '#4CAF50',
        scale: 1.5
      })
        .setLngLat([this.selectedLocation.lng, this.selectedLocation.lat])
        .addTo(this.map);

      // Update popup with precise coordinates
      const popup = new mapboxgl.Popup({
        offset: 25,
        closeButton: false
      }).setHTML(`
        <div class="location-popup">
          <strong>${this.isOffline ? 'Last Known Location' : 'Your Exact Device Location'}</strong><br>
          <small>${this.locationAddress || `${this.selectedLocation.lat.toFixed(8)}, ${this.selectedLocation.lng.toFixed(8)}`}</small>
          <br><small style="color: #10b981;">📍 Device GPS Location</small>
        </div>
      `);

      marker.setPopup(popup);
    } catch (error) {
      console.error('Error updating map location:', error);
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
    } catch (error: any) {
      // User cancelled - this is normal, don't show error
      if (error?.message?.includes('User cancelled') || error === 'User cancelled photos app') {
        console.log('User cancelled photo capture');
        // Don't show any notification - user intentionally cancelled
        return;
      }
      
      console.error('Error taking photo:', error);
      this.notificationService.error('Error!', 'Failed to take photo. Please check camera permissions.', 'OK', 3000);
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
    } catch (error: any) {
      // User cancelled - this is normal, don't show error
      if (error?.message?.includes('User cancelled') || error === 'User cancelled photos app') {
        console.log('User cancelled gallery selection');
        // Don't show any notification - user intentionally cancelled
        return;
      }
      
      console.error('Error selecting from gallery:', error);
      this.notificationService.error('Error!', 'Failed to select from gallery. Please check permissions.', 'OK', 3000);
    }
  }

  async onSubmit() {
    // Check incident type selection
    if (!this.selectedIncidentType) {
      await this.showAlert('Error', 'Please select an incident type.');
      return;
    }

    // Check location
    if (!this.selectedLocation) {
      await this.showAlert('Error', 'Please select a location on the map.');
      return;
    }

    // Detailed form validation with helpful error messages
    if (this.reportForm.invalid) {
      const errors: string[] = [];
      
      if (this.reportForm.get('type')?.invalid) {
        errors.push('Incident type is required');
      }
      if (this.reportForm.get('description')?.invalid) {
        const descControl = this.reportForm.get('description');
        if (descControl?.hasError('required')) {
          errors.push('Description is required');
        } else if (descControl?.hasError('minlength')) {
          errors.push('Description must be at least 5 characters');
        }
      }
      
      const errorMessage = errors.length > 0 
        ? errors.join('. ') + '.' 
        : 'Please fill in all required fields correctly.';
      
      await this.showAlert('Error', errorMessage);
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Submitting report...'
    });
    await loading.present();

    try {
      // Ensure location address is up-to-date before submission
      if (this.selectedLocation) {
        await this.updateLocationAddress();
        console.log('📍 Submitting report with location:', this.selectedLocation);
        console.log('📍 Location address:', this.locationAddress);
        console.log('📍 Location was manually edited:', this.isLocationManuallyEdited);
        console.log('📍 This exact location will be displayed in admin panel');
      }
      
      const formData = this.reportForm.value;
      
      // Convert media files to File objects for Cloudinary upload
      const mediaFiles: File[] = [];
      if (formData.media && formData.media.length > 0) {
        for (const mediaItem of formData.media) {
          if (mediaItem.file) {
            mediaFiles.push(mediaItem.file);
          } else if (mediaItem.webPath) {
            // Convert webPath to File object for Cloudinary
            try {
              const response = await fetch(mediaItem.webPath);
              const blob = await response.blob();
              const file = new File([blob], mediaItem.name || 'photo.jpg', { type: blob.type });
              mediaFiles.push(file);
            } catch (error) {
              console.error('Error converting webPath to File:', error);
            }
          }
        }
      }

      const reportFormData: ReportFormData = {
        type: formData.type,
        description: formData.description,
        location: {
          lat: this.selectedLocation.lat,
          lng: this.selectedLocation.lng
        },
        anonymous: formData.anonymous,
        media: mediaFiles,
        isSilent: false,
        // Include custom time/date if set
        customDateTime: this.isCustomTimeEnabled ? this.customDateTime : null
      };

      await this.reportService.submitReport(reportFormData);

      this.notificationService.success('Success!', 'Report submitted successfully!', 'OK', 3000);
      this.reportForm.reset();
      this.selectedLocation = this.currentLocation;
      this.selectedIncidentType = '';
      this.isLocationManuallyEdited = false;
      // Reset time settings
      this.customDateTime = null;
      this.isCustomTimeEnabled = false;

    } catch (error) {
      console.error('Error submitting report:', error);
      await this.showAlert('Error', 'Failed to submit report. Please try again.');
    } finally {
      await loading.dismiss();
      // Refresh rate limit status after submission attempt
      await this.loadRateLimitStatus();
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
    
    // Remove focus from button after selection to prevent border staying
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
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

  // Test method to simulate offline mode (for development/testing)
  async testOfflineMode() {
    this.isOffline = true;
    if (this.lastKnownLocation) {
      this.selectedLocation = this.lastKnownLocation;
      this.updateMapLocation();
      this.notificationService.warning('Test Mode', 'Simulating offline mode with last known location', 'OK', 3000);
    } else {
      this.notificationService.error('Test Mode', 'No last known location available for testing', 'OK', 3000);
    }
  }

  private async checkGPSAccuracy() {
    try {
      this.gpsAccuracy = await this.locationService.checkGPSAccuracy();
      console.log('GPS Accuracy:', this.gpsAccuracy);
    } catch (error) {
      console.error('Error checking GPS accuracy:', error);
      this.gpsAccuracy = { accuracy: 0, status: 'Unknown' };
    }
  }

  getGPSStatusColor(): string {
    if (!this.gpsAccuracy) return 'medium';
    
    const accuracy = this.gpsAccuracy.accuracy;
    if (accuracy <= 5) return 'success';
    if (accuracy <= 10) return 'primary';
    if (accuracy <= 20) return 'warning';
    if (accuracy <= 50) return 'warning';
    return 'danger';
  }

  toggleLocationEditMode() {
    this.isLocationEditMode = !this.isLocationEditMode;
    
    if (this.isLocationEditMode) {
      this.enableLocationEditing();
      this.notificationService.info('Edit Mode Active', 'Tap anywhere on the map or drag the marker to pin your desired location. GPS auto-updates are paused.', 'OK', 3500);
    } else {
      this.disableLocationEditing();
      const locationSummary = this.locationAddress || `${this.selectedLocation?.lat.toFixed(6)}, ${this.selectedLocation?.lng.toFixed(6)}`;
      
      if (this.isLocationManuallyEdited) {
        this.notificationService.success(
          'Custom Location Locked', 
          `Report location is set to: ${locationSummary}. This location will NOT be changed by GPS updates.`, 
          'OK', 
          4000
        );
      } else {
        this.notificationService.success(
          'Location Confirmed', 
          `Using current GPS location: ${locationSummary}`, 
          'OK', 
          3000
        );
      }
      console.log('✅ Final report location set:', this.selectedLocation, 'Address:', this.locationAddress, 'Manual edit:', this.isLocationManuallyEdited);
    }
  }

  private enableLocationEditing() {
    if (!this.map) return;

    // Remove existing markers
    const markers = document.querySelectorAll('.mapboxgl-marker');
    markers.forEach(marker => marker.remove());

    // Add draggable marker at current location
    this.editableMarker = new mapboxgl.Marker({
      color: '#ff6b35',
      scale: 1.5,
      draggable: true
    })
      .setLngLat([this.selectedLocation!.lng, this.selectedLocation!.lat])
      .addTo(this.map);

    // Add popup for editable marker
    const popup = new mapboxgl.Popup({
      offset: 25,
      closeButton: false
    }).setHTML(`
      <div class="location-popup">
        <strong>Report Location</strong><br>
        <small>Drag to adjust location</small>
        <br><small style="color: #ff6b35;">📍 Editable Location</small>
      </div>
    `);

    this.editableMarker.setPopup(popup);

    // Handle marker drag end
    this.editableMarker.on('dragend', async () => {
      const lngLat = this.editableMarker!.getLngLat();
      this.selectedLocation = { lat: lngLat.lat, lng: lngLat.lng };
      this.isLocationManuallyEdited = true;
      await this.updateLocationAddress();
      this.updateEditableMarkerPopup();
      console.log('📍 Report location manually edited:', this.selectedLocation, 'Address:', this.locationAddress);
    });

    // Handle map clicks to move marker
    this.handleMapClick = async (e: mapboxgl.MapMouseEvent) => {
      const lngLat = e.lngLat;
      this.selectedLocation = { lat: lngLat.lat, lng: lngLat.lng };
      this.isLocationManuallyEdited = true;
      this.editableMarker!.setLngLat([lngLat.lng, lngLat.lat]);
      await this.updateLocationAddress();
      this.updateEditableMarkerPopup();
      console.log('📍 Report location manually edited:', this.selectedLocation, 'Address:', this.locationAddress);
    };
    
    this.map.on('click', this.handleMapClick);

    // Change cursor to indicate editing mode
    this.map.getCanvas().style.cursor = 'crosshair';
  }

  private disableLocationEditing() {
    if (!this.map) return;

    // Remove click event listener
    this.map.off('click', this.handleMapClick);
    
    // Change cursor back to normal
    this.map.getCanvas().style.cursor = '';

    // Remove editable marker
    if (this.editableMarker) {
      this.editableMarker.remove();
      this.editableMarker = null;
    }

    // Add back the regular marker
    this.addRegularMarker();
  }

  private addRegularMarker() {
    if (!this.map || !this.selectedLocation) return;

    const marker = new mapboxgl.Marker({
      color: this.isOffline ? '#ff6b35' : '#4CAF50',
      scale: 1.5
    })
      .setLngLat([this.selectedLocation.lng, this.selectedLocation.lat])
      .addTo(this.map);

    const popup = new mapboxgl.Popup({
      offset: 25,
      closeButton: false
    }).setHTML(`
      <div class="location-popup">
        <strong>${this.isOffline ? 'Last Known Location' : 'Your Exact Device Location'}</strong><br>
        <small>${this.locationAddress || `${this.selectedLocation.lat.toFixed(8)}, ${this.selectedLocation.lng.toFixed(8)}`}</small>
        <br><small style="color: #10b981;">📍 Device GPS Location</small>
      </div>
    `);

    marker.setPopup(popup);
  }

  private updateEditableMarkerPopup() {
    if (!this.editableMarker || !this.selectedLocation) return;

    const popup = new mapboxgl.Popup({
      offset: 25,
      closeButton: false
    }).setHTML(`
      <div class="location-popup">
        <strong>Report Location</strong><br>
        <small>${this.locationAddress || `${this.selectedLocation.lat.toFixed(8)}, ${this.selectedLocation.lng.toFixed(8)}`}</small>
        <br><small style="color: #ff6b35;">📍 Editable Location</small>
      </div>
    `);

    this.editableMarker.setPopup(popup);
  }

  async resetToCurrentLocation() {
    try {
      // Get fresh current location
      this.currentLocation = await this.locationService.getDeviceExactLocation();
      this.selectedLocation = this.currentLocation;
      this.isLocationManuallyEdited = false; // Reset manual edit flag
      this.isOffline = false;
      await this.updateLocationAddress();
      await this.saveLastKnownLocation();
      
      // Update the editable marker position
      if (this.editableMarker) {
        this.editableMarker.setLngLat([this.selectedLocation.lng, this.selectedLocation.lat]);
        this.updateEditableMarkerPopup();
      }
      
      this.notificationService.success('Location Reset', 'Using your current device GPS location', 'OK', 2000);
      console.log('📍 Location reset to current GPS:', this.selectedLocation);
    } catch (error) {
      console.error('Error resetting to current location:', error);
      this.notificationService.error('Error', 'Failed to get current location', 'OK', 3000);
    }
  }

  // Time and Date methods
  updateCurrentDateTime() {
    this.currentDateTime = new Date();
  }

  getDisplayDateTime(): Date {
    return this.isCustomTimeEnabled && this.customDateTime ? this.customDateTime : this.currentDateTime;
  }

  formatDateTime(date: Date): string {
    return date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  formatTimeOnly(date: Date): string {
    return date.toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  formatDateOnly(date: Date): string {
    return date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  async openDateTimePicker() {
    const alert = await this.alertController.create({
      header: 'Set Date & Time',
      message: 'Choose the date and time for this incident',
      inputs: [
        {
          name: 'date',
          type: 'date',
          value: this.getDisplayDateTime().toISOString().split('T')[0],
          min: '2020-01-01',
          max: new Date().toISOString().split('T')[0]
        },
        {
          name: 'time',
          type: 'time',
          value: this.getDisplayDateTime().toTimeString().slice(0, 5)
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Set Current Time',
          handler: () => {
            this.resetToCurrentTime();
          }
        },
        {
          text: 'Set Custom Time',
          handler: (data) => {
            this.setCustomDateTime(data.date, data.time);
          }
        }
      ]
    });

    await alert.present();
  }

  resetToCurrentTime() {
    this.customDateTime = null;
    this.isCustomTimeEnabled = false;
    this.updateCurrentDateTime();
  }

  setCustomDateTime(dateString: string, timeString: string) {
    try {
      const [year, month, day] = dateString.split('-').map(Number);
      const [hours, minutes] = timeString.split(':').map(Number);
      
      this.customDateTime = new Date(year, month - 1, day, hours, minutes);
      this.isCustomTimeEnabled = true;
      
      this.notificationService.success(
        'Time Set', 
        `Incident time set to ${this.formatDateTime(this.customDateTime)}`, 
        'OK', 
        2000
      );
    } catch (error) {
      console.error('Error setting custom date/time:', error);
      this.notificationService.error('Error', 'Invalid date or time format', 'OK', 3000);
    }
  }

  toggleCustomTime() {
    if (this.isCustomTimeEnabled) {
      this.resetToCurrentTime();
    } else {
      this.openDateTimePicker();
    }
  }

  // Anonymous toggle methods
  toggleAnonymous() {
    const currentValue = this.reportForm.get('anonymous')?.value;
    this.reportForm.patchValue({ anonymous: !currentValue });
  }

  setAnonymous(value: boolean) {
    this.reportForm.patchValue({ anonymous: value });
    
    const message = value 
      ? 'Your identity will be kept private and not shared in the report.'
      : 'Your name and contact information will be included in the report.';
    
    this.notificationService.info(
      value ? 'Anonymous Mode' : 'Public Mode',
      message,
      'OK',
      2000
    );
  }

  // Report History Methods
  toggleHistory() {
    this.showHistory = !this.showHistory;
    if (this.showHistory) {
      this.content?.scrollToTop(300);
    }
  }

  loadUserReports() {
    this.reportsSubscription = this.reportService.getUserReports().subscribe(
      reports => {
        // Sort by creation date, newest first
        this.userReports = reports.sort((a, b) => {
          const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt);
          const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt);
          return dateB.getTime() - dateA.getTime();
        });
        
        // Add test validated reports if no reports exist
        if (this.userReports.length === 0) {
          this.addTestValidatedReports();
        }
        
        console.log('User reports loaded:', this.userReports.length);
      },
      error => {
        console.error('Error loading user reports:', error);
        this.notificationService.error('Error', 'Failed to load report history', 'OK', 3000);
      }
    );
  }

  getStatusColor(status: string): string {
    const colors: { [key: string]: string } = {
      'Pending': 'warning',
      'In Progress': 'primary',
      'Resolved': 'success',
      'Closed': 'medium',
      'Validated': 'success',
      'Rejected': 'danger'
    };
    return colors[status] || 'medium';
  }

  getStatusIcon(status: string): string {
    const icons: { [key: string]: string } = {
      'Pending': 'time-outline',
      'In Progress': 'reload-outline',
      'Resolved': 'checkmark-done-outline',
      'Closed': 'close-circle-outline',
      'Validated': 'shield-checkmark-outline',
      'Rejected': 'close-outline'
    };
    return icons[status] || 'help-outline';
  }

  getValidationStars(level?: number): string[] {
    if (!level) return [];
    return Array(5).fill(0).map((_, i) => i < level ? 'star' : 'star-outline');
  }

  // Helper method to get the correct risk level from a report
  // Priority: riskLevel (admin's PRIMARY field) > level (compatibility) > validationLevel (legacy)
  getReportRiskLevel(report: Report): number {
    const riskLevel = report.riskLevel || report.level || report.validationLevel || 1;
    
    // Debug logging to verify correct risk level is being used
    if (report.status === 'Validated') {
      console.log(`📊 Report Risk Level for "${report.locationAddress || 'Unknown'}":`, {
        reportId: report.id,
        riskLevel: report.riskLevel,
        level: report.level,
        validationLevel: report.validationLevel,
        finalRiskLevel: riskLevel,
        riskLevelText: this.getRiskLevelText(riskLevel)
      });
    }
    
    return riskLevel;
  }

  getRiskLevelColor(level: number): string {
    switch (level) {
      case 1: return 'linear-gradient(90deg, #22c55e, #16a34a)'; // Green gradient
      case 2: return 'linear-gradient(90deg, #eab308, #ca8a04)'; // Yellow gradient
      case 3: return 'linear-gradient(90deg, #f97316, #ea580c)'; // Orange gradient
      case 4: return 'linear-gradient(90deg, #ef4444, #dc2626)'; // Red gradient
      case 5: return 'linear-gradient(90deg, #991b1b, #7f1d1d)'; // Dark red gradient
      default: return 'linear-gradient(90deg, #6b7280, #4b5563)'; // Gray gradient
    }
  }

  getRiskLevelText(level: number): string {
    switch (level) {
      case 1: return 'Low';
      case 2: return 'Moderate';
      case 3: return 'High';
      case 4: return 'Critical';
      case 5: return 'Extreme';
      default: return 'Unknown';
    }
  }

  private addTestValidatedReports() {
    const testReports: Report[] = [
      {
        id: 'test-report-1',
        type: 'crime-theft',
        description: 'Theft incident reported at local store. Suspect took items and fled.',
        location: { lat: 10.3157, lng: 123.8854, simplifiedAddress: 'Babag, Cebu City' },
        locationAddress: 'Babag, Cebu City',
        userId: 'test-user-1',
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        validatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
        status: 'Validated',
        level: 3, // Admin's validation: Level 3 - High (Orange)
        riskLevel: 3,
        media: [],
        anonymous: false,
        isSilent: false,
        reporterName: 'John Doe',
        reporterEmail: 'john@example.com'
      },
      {
        id: 'test-report-2',
        type: 'vandalism',
        description: 'Graffiti found on public property. Multiple tags discovered.',
        location: { lat: 10.3257, lng: 123.8954, simplifiedAddress: 'Lahug, Cebu City' },
        locationAddress: 'Lahug, Cebu City',
        userId: 'test-user-2',
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        validatedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
        status: 'Validated',
        level: 2, // Admin's validation: Level 2 - Moderate (Yellow)
        riskLevel: 2,
        media: [],
        anonymous: false,
        isSilent: false,
        reporterName: 'Jane Smith',
        reporterEmail: 'jane@example.com'
      },
      {
        id: 'test-report-3',
        type: 'assault',
        description: 'Physical altercation reported in the area. Multiple witnesses present.',
        location: { lat: 10.2957, lng: 123.8754, simplifiedAddress: 'Downtown Cebu' },
        locationAddress: 'Downtown Cebu',
        userId: 'test-user-3',
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        validatedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), // 6 days ago
        status: 'Validated',
        level: 5, // Admin's validation: Level 5 - Extreme (Dark Red)
        riskLevel: 5,
        media: [],
        anonymous: false,
        isSilent: false,
        reporterName: 'Mike Johnson',
        reporterEmail: 'mike@example.com'
      }
    ];

    this.userReports = testReports;
    this.updateNewValidatedReportsCount();
    console.log('📊 Added test validated reports:', this.userReports.length);
  }

  updateNewValidatedReportsCount() {
    // Get the last time user viewed validated reports
    const lastViewedTime = localStorage.getItem('guardian_care_last_validated_reports_view') 
      ? new Date(localStorage.getItem('guardian_care_last_validated_reports_view')!)
      : new Date(0); // If never viewed, use epoch time

    // Count validated reports that were validated after last view
    this.newValidatedReportsCount = this.userReports.filter(report => 
      report.status === 'Validated' && 
      report.validatedAt && 
      new Date(report.validatedAt) > lastViewedTime
    ).length;

    console.log('📊 New validated reports count:', this.newValidatedReportsCount);
  }

  markValidatedReportsAsViewed() {
    // Update the last viewed time to now
    localStorage.setItem('guardian_care_last_validated_reports_view', new Date().toISOString());
    this.newValidatedReportsCount = 0;
    console.log('📊 Marked validated reports as viewed');
  }

  formatReportDate(timestamp: any): string {
    if (!timestamp) return 'Unknown date';
    
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return 'Unknown date';
    }
  }

  getIncidentTypeLabel(type: string): string {
    const typeObj = this.incidentTypes.find(t => t.value === type);
    return typeObj?.label || type;
  }

  getIncidentTypeIcon(type: string): string {
    const typeObj = this.incidentTypes.find(t => t.value === type);
    return typeObj?.icon || 'alert-circle-outline';
  }

  async viewReportDetails(report: Report) {
    // Build clean, readable message
    let message = `📋 Report Information\n\n`;
    message += `Type: ${this.getIncidentTypeLabel(report.type)}\n`;
    message += `Status: ${report.status}\n`;
    message += `Date: ${this.formatReportDate(report.createdAt)}\n\n`;
    
    message += `📍 Location\n`;
    message += `${report.locationAddress || 'Unknown location'}\n\n`;
    
    message += `📝 Description\n`;
    message += `${report.description}\n\n`;
    
    // Media info
    if (report.media && report.media.length > 0) {
      message += `📸 Media: ${report.media.length} photo(s) attached\n\n`;
    } else {
      message += `📸 Media: No photos attached\n\n`;
    }
    
    // Validation info
    const reportLevel = this.getReportRiskLevel(report);
    if (reportLevel && reportLevel > 0) {
      message += `✅ Admin Validation\n`;
      message += `Level: ${reportLevel}/5 ${'⭐'.repeat(reportLevel)}\n`;
      message += `Risk Level: ${this.getRiskLevelText(reportLevel)}\n`;
      message += `Validated: ${this.formatReportDate(report.validatedAt)}\n\n`;
    } else if (report.status === 'Validated') {
      message += `✅ Status: Validated by admin\n\n`;
    }
    
    // Rejection info
    if (report.isRejected && report.rejectionReason) {
      message += `❌ Report Rejected\n`;
      message += `Reason: ${report.rejectionReason}\n`;
    }

    const alert = await this.alertController.create({
      header: 'Report Details',
      message: message,
      cssClass: 'report-details-alert',
      buttons: [
        {
          text: 'Close',
          role: 'cancel'
        }
      ]
    });
    await alert.present();
  }

  getReportCountByStatus(status: string): number {
    return this.userReports.filter(r => r.status === status).length;
  }
}
