import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { LocationService } from '../services/location.service';
import { IncidentService } from '../services/incident.service';
import * as mapboxgl from 'mapbox-gl';

@Component({
  selector: 'app-reports',
  templateUrl: './reports.page.html',
  styleUrls: ['./reports.page.scss'],
  standalone: false
})
export class ReportsPage implements OnInit {
  reportForm: FormGroup;
  map: mapboxgl.Map | null = null;
  currentLocation: { lat: number; lng: number } | null = null;
  selectedLocation: { lat: number; lng: number } | null = null;
  isAnonymous = false;

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
    private toastController: ToastController
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
      this.initializeMap();
    } catch (error) {
      console.error('Error getting location:', error);
      this.currentLocation = { lat: 10.3111, lng: 123.8931 };
      this.selectedLocation = this.currentLocation;
      this.initializeMap();
    }
  }

  private initializeMap() {
    if (!this.currentLocation) return;

    (mapboxgl as any).accessToken = 'pk.eyJ1IjoidG9taWthemUxIiwiYSI6ImNtY25rM3NxazB2ZG8ybHFxeHVoZWthd28ifQ.Vnf9pMEQAryEI2rMJeMQGQ';

    this.map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v11',
      center: [this.currentLocation.lng, this.currentLocation.lat],
      zoom: 15
    });

    this.map.addControl(new mapboxgl.NavigationControl());

    const markerElement = document.createElement('div');
    markerElement.className = 'custom-marker';
    markerElement.style.width = '20px';
    markerElement.style.height = '20px';
    markerElement.style.backgroundColor = '#ff4444';
    markerElement.style.borderRadius = '50%';
    markerElement.style.border = '2px solid white';
    markerElement.style.cursor = 'pointer';

    new mapboxgl.Marker(markerElement)
      .setLngLat([this.currentLocation.lng, this.currentLocation.lat])
      .addTo(this.map);

    this.map.on('click', (e) => {
      this.selectedLocation = {
        lat: e.lngLat.lat,
        lng: e.lngLat.lng
      };
      
      if (this.map) {
        this.map.getSource('selected-location') ? 
          this.map.removeLayer('selected-location') : null;
        this.map.getSource('selected-location') ? 
          this.map.removeSource('selected-location') : null;

        this.map.addSource('selected-location', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Point',
              coordinates: [e.lngLat.lng, e.lngLat.lat]
            }
          }
        });

        this.map.addLayer({
          id: 'selected-location',
          type: 'circle',
          source: 'selected-location',
          paint: {
            'circle-radius': 8,
            'circle-color': '#ff4444',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2
          }
        });
      }
    });

    this.map.on('load', () => {
      console.log('Map loaded successfully');
    });
  }

  async onSubmit() {
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

      await this.showToast('Report submitted successfully!');
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

  private async showToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      position: 'bottom'
    });
    await toast.present();
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
}
