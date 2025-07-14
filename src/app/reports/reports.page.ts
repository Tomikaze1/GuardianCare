import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { IncidentService } from '../services/incident.service';
import { LocationService } from '../services/location.service';
import * as mapboxgl from 'mapbox-gl';

interface IncidentType {
  value: string;
  label: string;
  icon: string;
}

interface SeverityLevel {
  value: string;
  label: string;
}

interface MediaItem {
  url: string;
  type: 'image' | 'video';
  file?: File;
}

interface LocationData {
  lat: number;
  lng: number;
  address: string;
}

@Component({
  selector: 'app-reports',
  templateUrl: './reports.page.html',
  styleUrls: ['./reports.page.scss'],
  standalone: false
})
export class ReportsPage implements OnInit, OnDestroy {
  reportForm: FormGroup;
  isSubmitting = false;
  selectedIncidentType = '';
  selectedSeverity = '';
  uploadedMedia: MediaItem[] = [];
  currentLocation: LocationData | null = null;
  
  // Mapbox properties
  map: mapboxgl.Map | null = null;
  marker: mapboxgl.Marker | null = null;

  incidentTypes: IncidentType[] = [
    { value: 'theft', label: 'Theft', icon: 'bag' },
    { value: 'assault', label: 'Assault', icon: 'person' },
    { value: 'vandalism', label: 'Vandalism', icon: 'hammer' },
    { value: 'suspicious', label: 'Suspicious Activity', icon: 'eye' },
    { value: 'accident', label: 'Accident', icon: 'car' },
    { value: 'fire', label: 'Fire', icon: 'flame' },
    { value: 'medical', label: 'Medical Emergency', icon: 'medical' },
    { value: 'other', label: 'Other', icon: 'ellipsis-horizontal' }
  ];

  severityLevels: SeverityLevel[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' }
  ];

  constructor(
    private formBuilder: FormBuilder,
    private incidentService: IncidentService,
    private locationService: LocationService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController
  ) {
    this.reportForm = this.formBuilder.group({
      description: ['', [Validators.required, Validators.minLength(10)]],
      anonymous: [false]
    });
  }

  ngOnInit() {
    this.getCurrentLocation();
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
    }
  }

  selectIncidentType(type: string) {
    this.selectedIncidentType = type;
  }

  selectSeverity(severity: string) {
    this.selectedSeverity = severity;
  }

  async getCurrentLocation() {
    try {
      const loading = await this.loadingController.create({
        message: 'Getting your location...',
        spinner: 'crescent'
      });
      await loading.present();

      const coordinates = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000
      });

      const address = await this.locationService.reverseGeocode(
        coordinates.coords.latitude,
        coordinates.coords.longitude
      );

      this.currentLocation = {
        lat: coordinates.coords.latitude,
        lng: coordinates.coords.longitude,
        address: address
      };

      await loading.dismiss();
      
      // Initialize map after getting location
      setTimeout(() => {
        this.initializeMap();
      }, 100);

    } catch (error) {
      console.error('Error getting location:', error);
      await this.loadingController.dismiss();
      
      const toast = await this.toastController.create({
        message: 'Unable to get current location. Please try again.',
        duration: 3000,
        color: 'warning',
        position: 'top'
      });
      await toast.present();
    }
  }

  initializeMap() {
    if (!this.currentLocation) return;
    
    // Set Mapbox access token
    (mapboxgl as any).accessToken = 'pk.eyJ1IjoidG9taWthemUxIiwiYSI6ImNtY25rM3NxazB2ZG8ybHFxeHVoZWthd28ifQ.Vnf9pMEQAryEI2rMJeMQGQ';
    
    // Initialize map
    this.map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v11',
      center: [this.currentLocation.lng, this.currentLocation.lat],
      zoom: 15
    });

    // Add navigation controls
    this.map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // Create custom marker element
    const markerElement = document.createElement('div');
    markerElement.className = 'custom-marker';
    markerElement.style.backgroundImage = 'url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJDOC4xMyAyIDUgNS4xMyA1IDlDNSAxNC4yNSAxMiAyMiAxMiAyMkMxMiAyMiAxOSAxNC4yNSAxOSA5QzE5IDUuMTMgMTUuODcgMiAxMiAyWk0xMiAxMS41QzEwLjYyIDExLjUgOS41IDEwLjM4IDkuNSA5QzkuNSA3LjYyIDEwLjYyIDYuNSAxMiA2LjVDMTMuMzggNi41IDE0LjUgNy42MiAxNC41IDlDMTQuNSAxMC4zOCAxMy4zOCAxMS41IDEyIDExLjVaIiBmaWxsPSIjNjY3ZWVhIi8+Cjwvc3ZnPgo=)';
    markerElement.style.backgroundSize = 'contain';
    markerElement.style.width = '30px';
    markerElement.style.height = '30px';

    // Add marker to map
    this.marker = new mapboxgl.Marker(markerElement)
      .setLngLat([this.currentLocation.lng, this.currentLocation.lat])
      .addTo(this.map);

    // Add click event to allow users to adjust location
    this.map.on('click', (e) => {
      this.updateLocationFromMap(e.lngLat.lng, e.lngLat.lat);
    });

    // Add map load event
    this.map.on('load', () => {
      console.log('Map loaded successfully');
    });
  }

  async updateLocationFromMap(lng: number, lat: number) {
    try {
      const address = await this.locationService.reverseGeocode(lat, lng);
      
      this.currentLocation = {
        lat: lat,
        lng: lng,
        address: address
      };

      // Update marker position
      if (this.marker) {
        this.marker.setLngLat([lng, lat]);
      }

      const toast = await this.toastController.create({
        message: 'Location updated successfully',
        duration: 2000,
        color: 'success',
        position: 'top'
      });
      await toast.present();

    } catch (error) {
      console.error('Error updating location:', error);
    }
  }

  async refreshLocation() {
    await this.getCurrentLocation();
  }

  async takePicture() {
    try {
      const image = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera
      });

      if (image.dataUrl) {
        this.uploadedMedia.push({
          url: image.dataUrl,
          type: 'image'
        });
      }
    } catch (error) {
      console.error('Error taking picture:', error);
      const toast = await this.toastController.create({
        message: 'Unable to take picture. Please try again.',
        duration: 3000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    }
  }

  async selectFromGallery() {
    try {
      const image = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos
      });

      if (image.dataUrl) {
        this.uploadedMedia.push({
          url: image.dataUrl,
          type: 'image'
        });
      }
    } catch (error) {
      console.error('Error selecting from gallery:', error);
      const toast = await this.toastController.create({
        message: 'Unable to select image. Please try again.',
        duration: 3000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    }
  }

  removeMedia(index: number) {
    this.uploadedMedia.splice(index, 1);
  }

  async callEmergency() {
    const alert = await this.alertController.create({
      header: 'Emergency Services',
      message: 'This will call emergency services (911). Continue?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Call',
          handler: () => {
            window.open('tel:911', '_system');
          }
        }
      ]
    });

    await alert.present();
  }

  async submitReport() {
  if (!this.reportForm.valid || !this.selectedIncidentType || !this.selectedSeverity || !this.currentLocation) {
    const toast = await this.toastController.create({
      message: 'Please fill in all required fields.',
      duration: 3000,
      color: 'warning',
      position: 'top'
    });
    await toast.present();
    return;
  }

  this.isSubmitting = true;

  try {
    const reportData = {
      type: this.selectedIncidentType,
      severity: this.selectedSeverity,
      description: this.reportForm.value.description,
      location: this.currentLocation,
      media: this.uploadedMedia,
      anonymous: this.reportForm.value.anonymous,
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    // Type assertion as temporary workaround
    await (this.incidentService as any).submitReport(reportData);

    const toast = await this.toastController.create({
      message: 'Report submitted successfully. Thank you for helping keep the community safe!',
      duration: 4000,
      color: 'success',
      position: 'top'
    });
    await toast.present();

    this.resetForm();

  } catch (error) {
    console.error('Error submitting report:', error);
    const toast = await this.toastController.create({
      message: 'Error submitting report. Please try again.',
      duration: 3000,
      color: 'danger',
      position: 'top'
    });
    await toast.present();
  } finally {
    this.isSubmitting = false;
  }
}


  private resetForm() {
    this.reportForm.reset();
    this.selectedIncidentType = '';
    this.selectedSeverity = '';
    this.uploadedMedia = [];
    this.reportForm.patchValue({ anonymous: false });
    
    // Reset map if exists
    if (this.map && this.marker) {
      this.marker.remove();
      this.map.remove();
      this.map = null;
      this.marker = null;
    }
  }
}
