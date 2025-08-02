import { Component, OnInit, OnDestroy } from '@angular/core';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { LocationService } from '../services/location.service';
import { ZoneDangerEngineService, DangerZone } from '../services/zone-danger-engine.service';
import { AuthService } from '../services/auth.service';
import { FirebaseService } from '../services/firebase.service';
import * as mapboxgl from 'mapbox-gl';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false
})
export class HomePage implements OnInit, OnDestroy {
  map: mapboxgl.Map | null = null;
  currentLocation: { lat: number; lng: number } | null = null;
  zones: DangerZone[] = [];
  zoneLayers: string[] = [];
  isHeatmapVisible = false;
  isPanicActive = false;
  inDangerZone = false;
  currentLanguage = 'en';
  private subscriptions: any[] = [];

  constructor(
    private locationService: LocationService,
    private zoneEngine: ZoneDangerEngineService,
    private authService: AuthService,
    private firebaseService: FirebaseService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private translate: TranslateService
  ) {}

  ngOnInit() {
    this.initializeApp();
    this.loadUserLanguage();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.map) {
      this.map.remove();
    }
  }

  private async initializeApp() {
    try {
      const location = await this.locationService.getCurrentLocation();
      this.currentLocation = location;
      this.initializeMap();
    } catch (error) {
      console.error('Error initializing app:', error);
      this.currentLocation = { lat: 10.3111, lng: 123.8931 };
    this.initializeMap();
  }
  }

  private loadUserLanguage() {
    const savedLanguage = localStorage.getItem('userLanguage');
    if (savedLanguage) {
      this.currentLanguage = savedLanguage;
      this.translate.use(savedLanguage);
    }
  }

  async changeLanguage(lang: string) {
    this.currentLanguage = lang;
    this.translate.use(lang);
    localStorage.setItem('userLanguage', lang);
    
    const message = this.translate.instant('ALERTS.LANGUAGE_CHANGED');
    await this.showToast(message);
  }

  private async showToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'bottom'
    });
    await toast.present();
  }

  initializeMap() {
    if (!this.currentLocation) return;
    (mapboxgl as any).accessToken = 'pk.eyJ1IjoidG9taWthemUxIiwiYSI6ImNtY25rM3NxazB2ZG8ybHFxeHVoZWthd28ifQ.Vnf9pMEQAryEI2rMJeMQGQ';
    
    const mapStyle = this.isHeatmapVisible ? 'mapbox://styles/mapbox/dark-v10' : 'mapbox://styles/mapbox/streets-v11';
    
    this.map = new mapboxgl.Map({
      container: 'map',
      style: mapStyle,
      center: [this.currentLocation.lng, this.currentLocation.lat],
      zoom: 12,
      interactive: true,
      trackResize: true,
      attributionControl: false
    });

    new mapboxgl.Marker()
      .setLngLat([this.currentLocation.lng, this.currentLocation.lat])
      .addTo(this.map);

    this.map.on('load', () => {
      console.log('Map loaded in HomePage');
      setTimeout(() => {
        this.map!.addControl(new mapboxgl.NavigationControl(), 'top-right');
        console.log('NavigationControl added.');
        this.map!.addControl(new mapboxgl.GeolocateControl({
          positionOptions: {
            enableHighAccuracy: true
          },
          trackUserLocation: true,
          showUserHeading: true
        }), 'top-left');
        console.log('GeolocateControl added.');
      }, 500);
      
      this.loadZones();
      if (this.isHeatmapVisible) {
        this.updateHeatmap();
      }
    });
  }

  removeDangerZones() {
    if (!this.map) return;
    
    console.log('Removing danger zones, current layers:', this.zoneLayers);
    
    this.zoneLayers.forEach(layerId => {
      if (this.map!.getLayer(layerId)) {
        this.map!.removeLayer(layerId);
        console.log('Removed layer:', layerId);
      }
    });
    
    this.zones.forEach(zone => {
      const sourceId = `zone-${zone.id}`;
      if (this.map!.getSource(sourceId)) {
        this.map!.removeSource(sourceId);
        console.log('Removed source:', sourceId);
      }
    });
    
    this.zoneLayers = [];
    console.log('All danger zones removed');
  }

  async getDirections(destination: [number, number]) {
    if (!this.currentLocation || !this.map) return;

    const origin = `${this.currentLocation.lng},${this.currentLocation.lat}`;
    const dest = `${destination[0]},${destination[1]}`;
    
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin};${dest}?geometries=geojson&overview=full&access_token=${(mapboxgl as any).accessToken}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        
        if (this.map.getSource('route')) {
          this.map.removeLayer('route');
          this.map.removeSource('route');
        }
        
        this.map.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: route.geometry
          }
        });
        
        this.map.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#007cbf',
            'line-width': 4,
            'line-opacity': 0.8
          }
        });
      }
    } catch (error) {
      console.error('Error fetching directions:', error);
    }
  }

  loadZones() {
    console.log('Loading zones...');
    this.zoneEngine.zones$.subscribe({
      next: (zones) => {
        console.log('Zones loaded from service:', zones);
        
        if (!zones || zones.length === 0) {
          console.log('No zones from service, adding sample zones');
          this.zones = this.getSampleZones();
        } else {
          this.zones = zones;
        }
        
        console.log('Final zones array:', this.zones);
        if (this.map && this.isHeatmapVisible) {
          console.log('Updating heatmap with zones:', this.zones.length);
          this.updateHeatmap();
        }
      },
      error: (error) => {
        console.error('Error loading zones:', error);
      }
    });
  }

  private getSampleZones(): DangerZone[] {
    return [
      {
        id: 'sample-zone-1',
        name: 'Sample Zone 1',
        coordinates: [
          [123.89, 10.31],
          [123.90, 10.31],
          [123.90, 10.32],
          [123.89, 10.32],
          [123.89, 10.31]
        ],
        level: 'Danger',
        currentSeverity: 0.8,
        incidents: [
          {
            id: '1',
            timestamp: new Date(),
            severity: 8
          }
        ],
        timeSlots: [
          {
            startHour: 0,
            endHour: 24,
            baseSeverity: 8
          }
        ]
      },
      {
        id: 'sample-zone-2',
        name: 'Sample Zone 2',
        coordinates: [
          [123.91, 10.33],
          [123.92, 10.33],
          [123.92, 10.34],
          [123.91, 10.34],
          [123.91, 10.33]
        ],
        level: 'Caution',
        currentSeverity: 0.6,
        incidents: [
          {
            id: '2',
            timestamp: new Date(),
            severity: 5
          }
        ],
        timeSlots: [
          {
            startHour: 0,
            endHour: 24,
            baseSeverity: 5
          }
        ]
      }
    ];
  }

  updateHeatmap() {
    if (!this.map || !this.zones || this.zones.length === 0) {
      console.log('Cannot update heatmap: map or zones not available');
      return;
    }

    console.log('Updating heatmap with zones:', this.zones.length);

    this.zones.forEach((zone, index) => {
      const sourceId = `zone-${zone.id}`;
      const layerId = `zone-layer-${zone.id}`;

      if (this.map!.getSource(sourceId)) {
        this.map!.removeLayer(layerId);
        this.map!.removeSource(sourceId);
      }

      const color = this.getZoneColor(zone.level);

      this.map!.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {
            level: zone.level,
            severity: zone.currentSeverity,
            incidents: zone.incidents
          },
          geometry: {
            type: 'Polygon',
            coordinates: [zone.coordinates]
          }
        }
      });

      this.map!.addLayer({
        id: layerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': color,
          'fill-opacity': 0.6
        }
      });

      this.map!.addLayer({
        id: `${layerId}-border`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': color,
          'line-width': 2,
          'line-opacity': 0.8
        }
      });

      this.zoneLayers.push(layerId);
      this.zoneLayers.push(`${layerId}-border`);
    });

    console.log('Heatmap updated successfully');
  }

  private getZoneColor(level: string): string {
    switch (level) {
      case 'Safe':
        return '#00ff00';
      case 'Neutral':
        return '#ffff00';
      case 'Caution':
        return '#ffaa00';
      case 'Danger':
        return '#ff0000';
      default:
        return '#cccccc';
    }
  }

  toggleHeatmap() {
    console.log('Toggle heatmap called, current state:', this.isHeatmapVisible);
    
    this.isHeatmapVisible = !this.isHeatmapVisible;
    console.log('New heatmap state:', this.isHeatmapVisible);
    
    if (this.isHeatmapVisible) {
      console.log('Showing heatmap...');
      if (this.map) {
        this.map.setStyle('mapbox://styles/mapbox/dark-v10');
        this.map.once('styledata', () => {
          this.updateHeatmap();
        });
      }
    } else {
      console.log('Hiding heatmap...');
      if (this.map) {
        this.map.setStyle('mapbox://styles/mapbox/streets-v11');
        this.map.once('styledata', () => {
          this.removeDangerZones();
        });
      }
    }
  }

  async triggerPanicButton() {
    if (this.isPanicActive) return;

    this.isPanicActive = true;

    const alert = await this.alertController.create({
      header: 'Emergency Alert',
      message: 'Are you sure you want to send an emergency alert? This will notify authorities and emergency contacts.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          handler: () => {
            this.isPanicActive = false;
          }
        },
        {
          text: 'Send Alert',
          handler: async () => {
            await this.sendEmergencyAlert();
          }
        }
      ],
      cssClass: 'panic-alert'
    });

    await alert.present();
  }

  private async sendEmergencyAlert() {
    try {
      const loading = await this.loadingController.create({
        message: 'Sending emergency alert...',
        duration: 3000
      });
      await loading.present();

      const user = await this.authService.getCurrentUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      const userDoc = await this.firebaseService.getFirestoreInstance()
        .collection('users')
        .doc(user.uid)
        .get()
        .toPromise();

      const userData = userDoc?.data() as any;
      const currentLocation = await this.locationService.getCurrentLocation();

      const alertData = {
        userId: user.uid,
        userName: `${userData?.firstName || 'Unknown'} ${userData?.lastName || 'User'}`,
        userEmail: user.email,
        location: {
          lat: currentLocation.lat,
          lng: currentLocation.lng
        },
        timestamp: new Date(),
        status: 'active',
        type: 'panic'
      };

      await this.firebaseService.addDocument('emergencyAlerts', alertData);

      await this.showToast('Emergency alert sent successfully!');
      console.log('Emergency alert sent:', alertData);

    } catch (error) {
      console.error('Error sending emergency alert:', error);
      await this.showToast('Failed to send emergency alert. Please try again.');
    } finally {
      this.isPanicActive = false;
    }
  }
}
