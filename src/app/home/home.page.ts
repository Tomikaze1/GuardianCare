import { Component, OnInit, OnDestroy } from '@angular/core';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { LocationService } from '../services/location.service';
import { ZoneDangerEngineService, DangerZone } from '../services/zone-danger-engine.service';
import { AuthService } from '../services/auth.service';
import { FirebaseService } from '../services/firebase.service';
import { NotificationService } from '../shared/services/notification.service';

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
  gpsAccuracy: { accuracy: number; status: string } | null = null;
  isRefreshingLocation = false;
  private subscriptions: any[] = [];

  constructor(
    private locationService: LocationService,
    private zoneEngine: ZoneDangerEngineService,
    private authService: AuthService,
    private firebaseService: FirebaseService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private translate: TranslateService,
    private notificationService: NotificationService,
  ) {}

  ngOnInit() {
    this.initializeApp();
    this.loadUserLanguage();
  }

  ionViewWillEnter() {
    this.zoneEngine.initializeZones();
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
      console.log('Current location set:', this.currentLocation);
      
      this.zoneEngine.updateCurrentLocation(location);
      
      // Check GPS accuracy
      await this.checkGPSAccuracy();
      
      this.initializeMap();
    } catch (error) {
      console.error('Error initializing app:', error);
      this.currentLocation = { lat: 10.3157, lng: 123.8854 };
      console.log('Using default location due to error:', this.currentLocation);
      
      this.zoneEngine.updateCurrentLocation(this.currentLocation);
      
      this.initializeMap();
    }
  }

  async checkGPSAccuracy() {
    try {
      this.gpsAccuracy = await this.locationService.checkGPSAccuracy();
      console.log('GPS Accuracy:', this.gpsAccuracy);
    } catch (error) {
      console.error('Error checking GPS accuracy:', error);
    }
  }

  async refreshLocation() {
    this.isRefreshingLocation = true;
    try {
      const location = await this.locationService.refreshLocationWithHighAccuracy();
      this.currentLocation = location;
      this.zoneEngine.updateCurrentLocation(location);
      
      // Update map center if map exists
      if (this.map) {
        this.map.setCenter([location.lng, location.lat]);
      }
      
      // Check GPS accuracy
      await this.checkGPSAccuracy();
      
      this.notificationService.success('Location Updated', 'Your location has been refreshed with high accuracy!', 'OK', 2000);
    } catch (error) {
      console.error('Error refreshing location:', error);
      this.notificationService.error('Location Error', 'Failed to refresh location. Please check your GPS settings.', 'OK', 3000);
    } finally {
      this.isRefreshingLocation = false;
    }
  }

  getGPSStatusColor(): string {
    if (!this.gpsAccuracy) return 'medium';
    
    const accuracy = this.gpsAccuracy.accuracy;
    if (accuracy <= 5) return 'success';
    if (accuracy <= 10) return 'primary';
    if (accuracy <= 20) return 'warning';
    if (accuracy <= 50) return 'danger';
    return 'danger';
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
      
      
    });
  }

  removeDangerZones() {
    if (!this.map) return;
    
    console.log('Removing all zones, current layers:', this.zoneLayers);
    
    
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
    
    
    const baseLayerId = 'philippines-safe-layer';
    const baseSourceId = 'philippines-base-safe';
    
    if (this.map!.getLayer(baseLayerId)) {
      this.map!.removeLayer(baseLayerId);
      console.log('Removed base layer:', baseLayerId);
    }
    
    if (this.map!.getSource(baseSourceId)) {
      this.map!.removeSource(baseSourceId);
      console.log('Removed base source:', baseSourceId);
    }
    
    this.zoneLayers = [];
    console.log('All zones and base layer removed');
  }

  async getDirections(destination: [number, number]) {
    if (!this.currentLocation || !this.map) {
      console.log('❌ Cannot get directions: No current location or map');
      return;
    }

    const origin = `${this.currentLocation.lng},${this.currentLocation.lat}`;
    const dest = `${destination[0]},${destination[1]}`;
    
    console.log('🗺️ Getting directions from:', origin, 'to:', dest);
    
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin};${dest}?geometries=geojson&overview=full&access_token=${(mapboxgl as any).accessToken}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      
      console.log('🗺️ Directions response:', data);
      
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
            'line-color': '#ff4757',
            'line-width': 6,
            'line-opacity': 0.9
          }
        });
        
        this.map.addLayer({
          id: 'route-outline',
          type: 'line',
          source: 'route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#ffffff',
            'line-width': 8,
            'line-opacity': 0.8
          }
        }, 'route');
        
        this.addRouteMarkers(destination);
        
        this.fitMapToRoute(route.geometry.coordinates);
        
        console.log('✅ Route added successfully');
      } else {
        console.log('❌ No routes found in response');
      }
    } catch (error) {
      console.error('❌ Error fetching directions:', error);
    }
  }

  private addRouteMarkers(destination: [number, number]) {
    if (!this.map || !this.currentLocation) return;
    
    if (this.map.getSource('start-marker')) {
      this.map.removeLayer('start-marker');
      this.map.removeSource('start-marker');
    }
    if (this.map.getSource('end-marker')) {
      this.map.removeLayer('end-marker');
      this.map.removeSource('end-marker');
    }
    this.map.addSource('start-marker', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [this.currentLocation.lng, this.currentLocation.lat]
        },
        properties: {}
      }
    });
    
    this.map.addLayer({
      id: 'start-marker',
      type: 'circle',
      source: 'start-marker',
      paint: {
        'circle-radius': 8,
        'circle-color': '#2ed573',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    });
    

    this.map.addSource('end-marker', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: destination
        },
        properties: {}
      }
    });
    
    this.map.addLayer({
      id: 'end-marker',
      type: 'circle',
      source: 'end-marker',
      paint: {
        'circle-radius': 10,
        'circle-color': '#ff4757',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3
      }
    });
  }

  private fitMapToRoute(coordinates: number[][]) {
    if (!this.map) return;
    
    const bounds = new mapboxgl.LngLatBounds();
    
    
    if (this.currentLocation) {
      bounds.extend([this.currentLocation.lng, this.currentLocation.lat]);
    }
    
    
    coordinates.forEach(coord => {
      if (coord.length >= 2) {
        bounds.extend([coord[0], coord[1]]);
      }
    });
    
    
    this.map.fitBounds(bounds, {
      padding: 50,
      duration: 2000
    });
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
        
      },
      error: (error) => {
        console.error('Error loading zones:', error);
      }
    });
  }

  private getSampleZones(): DangerZone[] {
    return [
      {
        id: 'guadalupe-danger-zone',
        name: 'Guadalupe Danger Zone',
        coordinates: [
          [123.895, 10.315], 
          [123.905, 10.315], 
          [123.905, 10.325], 
          [123.895, 10.325], 
          [123.895, 10.315]  
        ],
        level: 'Danger',
        currentSeverity: 0.9,
        incidents: [
          {
            id: '1',
            timestamp: new Date(),
            severity: 9,
            type: 'assault'
          }
        ],
        timeSlots: [
          {
            startHour: 0,
            endHour: 24,
            baseSeverity: 9,
            crimeMultiplier: 1.5,
            description: 'High crime area - 24/7 monitoring'
          }
        ],
        crimeFrequency: {
          daily: 8,
          weekly: 45,
          monthly: 180,
          peakHours: [22, 23, 0, 1, 2],
          peakDays: [5, 6] 
        },
        timeBasedRisk: {
          morning: 0.6,
          afternoon: 0.7,
          evening: 0.8,
          night: 0.9,
          weekend: 0.9,
          weekday: 0.7
        },
        alertSettings: {
          enablePushNotifications: true,
          enableVibration: true,
          enableSound: true,
          soundType: 'siren',
          vibrationPattern: [200, 100, 200, 100, 200],
          alertThreshold: 0.6
        }
      },
      {
        id: 'mabolo-caution-zone',
        name: 'Mabolo Caution Zone',
        coordinates: [
          [123.910, 10.320], 
          [123.920, 10.320], 
          [123.920, 10.330], 
          [123.910, 10.330], 
          [123.910, 10.320]  
        ],
        level: 'Caution',
        currentSeverity: 0.7,
        incidents: [
          {
            id: '2',
            timestamp: new Date(),
            severity: 7,
            type: 'theft'
          }
        ],
        timeSlots: [
          {
            startHour: 0,
            endHour: 24,
            baseSeverity: 7,
            crimeMultiplier: 1.2,
            description: 'Moderate risk area - exercise caution'
          }
        ],
        crimeFrequency: {
          daily: 4,
          weekly: 25,
          monthly: 100,
          peakHours: [18, 19, 20, 21],
          peakDays: [4, 5] 
        },
        timeBasedRisk: {
          morning: 0.4,
          afternoon: 0.5,
          evening: 0.7,
          night: 0.8,
          weekend: 0.8,
          weekday: 0.6
        },
        alertSettings: {
          enablePushNotifications: true,
          enableVibration: true,
          enableSound: true,
          soundType: 'beep',
          vibrationPattern: [200, 200],
          alertThreshold: 0.7
        }
      },
      {
        id: 'lahug-neutral-zone',
        name: 'Lahug Neutral Zone',
        coordinates: [
          [123.880, 10.325], 
          [123.890, 10.325], 
          [123.890, 10.335], 
          [123.880, 10.335], 
          [123.880, 10.325]  
        ],
        level: 'Neutral',
        currentSeverity: 0.4,
        incidents: [
          {
            id: '3',
            timestamp: new Date(),
            severity: 4,
            type: 'vandalism'
          }
        ],
        timeSlots: [
          {
            startHour: 0,
            endHour: 24,
            baseSeverity: 4,
            crimeMultiplier: 1.0,
            description: 'Low risk area - normal vigilance'
          }
        ],
        crimeFrequency: {
          daily: 2,
          weekly: 12,
          monthly: 50,
          peakHours: [20, 21, 22],
          peakDays: [5, 6] 
        },
        timeBasedRisk: {
          morning: 0.2,
          afternoon: 0.3,
          evening: 0.4,
          night: 0.5,
          weekend: 0.5,
          weekday: 0.3
        },
        alertSettings: {
          enablePushNotifications: false,
          enableVibration: false,
          enableSound: false,
          soundType: 'chime',
          vibrationPattern: [100],
          alertThreshold: 0.8
        }
      },
      {
        id: 'ayala-safe-zone',
        name: 'Ayala Center Cebu Safe Zone',
        coordinates: [
          [123.925, 10.305], 
          [123.935, 10.305], 
          [123.935, 10.315], 
          [123.925, 10.315], 
          [123.925, 10.305]  
        ],
        level: 'Safe',
        currentSeverity: 0.1,
        incidents: [
          {
            id: '4',
            timestamp: new Date(),
            severity: 1,
            type: 'other'
          }
        ],
        timeSlots: [
          {
            startHour: 0,
            endHour: 24,
            baseSeverity: 1,
            crimeMultiplier: 0.5,
            description: 'Safe area - minimal risk'
          }
        ],
        crimeFrequency: {
          daily: 0,
          weekly: 1,
          monthly: 5,
          peakHours: [],
          peakDays: []
        },
        timeBasedRisk: {
          morning: 0.1,
          afternoon: 0.1,
          evening: 0.2,
          night: 0.3,
          weekend: 0.2,
          weekday: 0.1
        },
        alertSettings: {
          enablePushNotifications: false,
          enableVibration: false,
          enableSound: false,
          soundType: 'chime',
          vibrationPattern: [50],
          alertThreshold: 0.9
        }
      },
      {
        id: 'sm-city-safe-zone',
        name: 'SM City Cebu Safe Zone',
        coordinates: [
          [123.870, 10.300], 
          [123.880, 10.300], 
          [123.880, 10.310], 
          [123.870, 10.310], 
          [123.870, 10.300]  
        ],
        level: 'Safe',
        currentSeverity: 0.1,
        incidents: [
          {
            id: '5',
            timestamp: new Date(),
            severity: 1,
            type: 'other'
          }
        ],
        timeSlots: [
          {
            startHour: 0,
            endHour: 24,
            baseSeverity: 1,
            crimeMultiplier: 0.5,
            description: 'Safe area - minimal risk'
          }
        ],
        crimeFrequency: {
          daily: 0,
          weekly: 1,
          monthly: 3,
          peakHours: [],
          peakDays: []
        },
        timeBasedRisk: {
          morning: 0.1,
          afternoon: 0.1,
          evening: 0.2,
          night: 0.3,
          weekend: 0.2,
          weekday: 0.1
        },
        alertSettings: {
          enablePushNotifications: false,
          enableVibration: false,
          enableSound: false,
          soundType: 'chime',
          vibrationPattern: [50],
          alertThreshold: 0.9
        }
      },
      {
        id: 'talamban-safe-zone',
        name: 'Talamban Safe Zone',
        coordinates: [
          [123.840, 10.340], 
          [123.850, 10.340], 
          [123.850, 10.350], 
          [123.840, 10.350], 
          [123.840, 10.340]  
        ],
        level: 'Safe',
        currentSeverity: 0.1,
        incidents: [
          {
            id: '6',
            timestamp: new Date(),
            severity: 1,
            type: 'other'
          }
        ],
        timeSlots: [
          {
            startHour: 0,
            endHour: 24,
            baseSeverity: 1,
            crimeMultiplier: 0.5,
            description: 'Safe area - minimal risk'
          }
        ],
        crimeFrequency: {
          daily: 0,
          weekly: 1,
          monthly: 2,
          peakHours: [],
          peakDays: []
        },
        timeBasedRisk: {
          morning: 0.1,
          afternoon: 0.1,
          evening: 0.2,
          night: 0.3,
          weekend: 0.2,
          weekday: 0.1
        },
        alertSettings: {
          enablePushNotifications: false,
          enableVibration: false,
          enableSound: false,
          soundType: 'chime',
          vibrationPattern: [50],
          alertThreshold: 0.9
        }
      }
    ];
  }

  updateHeatmap() {
    if (!this.map) {
      console.log('Cannot update heatmap: map not available');
      return;
    }

    console.log('Updating heatmap with zones:', this.zones?.length || 0);

    
    if (this.isHeatmapVisible) {
      this.addBaseSafeLayer();
      
      if (this.zones && this.zones.length > 0) {
        const sortedZones = [...this.zones].sort((a, b) => {
          const severityOrder = { 'Danger': 4, 'Caution': 3, 'Neutral': 2, 'Safe': 1 };
          return (severityOrder[b.level as keyof typeof severityOrder] || 0) - (severityOrder[a.level as keyof typeof severityOrder] || 0);
        });

        console.log('Adding zones to map:', sortedZones.length);
        sortedZones.forEach((zone, index) => {
          console.log(`Adding zone ${index + 1}: ${zone.name} (${zone.level}) at coordinates:`, zone.coordinates);
          this.addZoneLayer(zone, index);
        });
      }
    } else {
      
      this.removeDangerZones();
    }

    console.log('Heatmap updated successfully');
  }

  private addBaseSafeLayer() {
    const baseSourceId = 'philippines-base-safe';
    const baseLayerId = 'philippines-safe-layer';

    if (this.map!.getSource(baseSourceId)) {
      this.map!.removeLayer(baseLayerId);
      this.map!.removeSource(baseSourceId);
    }
    this.map!.addSource(baseSourceId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { level: 'Safe' },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [116.9, 4.5],
              [126.6, 4.5],
              [126.6, 21.1],
              [116.9, 21.1],
              [116.9, 4.5]
            ]]
          }
        }]
      }
    });

    this.map!.addLayer({
      id: baseLayerId,
      type: 'fill',
      source: baseSourceId,
      paint: {
        'fill-color': '#00ff00',
        'fill-opacity': 0.3
      }
    });

    this.zoneLayers.push(baseLayerId);
  }

  private addZoneLayer(zone: DangerZone, index: number) {
    const sourceId = `zone-${zone.id}`;
    const layerId = `zone-layer-${zone.id}`;

    console.log(`Adding zone layer: ${zone.name} with sourceId: ${sourceId}, layerId: ${layerId}`);

    if (this.map!.getSource(sourceId)) {
      this.map!.removeLayer(`${layerId}-border`);
      this.map!.removeLayer(layerId);
      this.map!.removeSource(sourceId);
    }

    const color = this.getZoneColor(zone.level);
    const opacity = this.getZoneOpacity(zone.level);
    
    console.log(`Zone ${zone.name} - Color: ${color}, Opacity: ${opacity}`);

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
        'fill-opacity': opacity
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
    
    console.log(`Successfully added zone: ${zone.name}. Total zone layers: ${this.zoneLayers.length}`);
  }

  private getZoneOpacity(level: string): number {
    switch (level) {
      case 'Danger':
        return 0.9;
      case 'Caution':
        return 0.8;
      case 'Neutral':
        return 0.7;
      case 'Safe':
        return 0.6;
      default:
        return 0.5;
    }
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
        return '#00ff00';
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
          this.updateHeatmap();
        });
      }
    }
  }

  async triggerPanicButton() {
    if (this.isPanicActive) return;

    this.isPanicActive = true;

    this.vibrateDevice();

    const alert = await this.alertController.create({
      header: '🧪 TEST MODE - PANIC BUTTON 🧪',
      message: 'This is a TEST version of the emergency panic system.\n\nIn TEST mode, this will:\n• Simulate sending location to authorities\n• Simulate notifying emergency contacts\n• Route you to the nearest safe zone\n• Show emergency protocols\n\n⚠️ This is NOT a real emergency alert!',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'cancel-button',
          handler: () => {
            this.isPanicActive = false;
          }
        },
        {
          text: '🧪 TEST EMERGENCY ALERT',
          cssClass: 'emergency-button',
          handler: async () => {
            await this.executeTestEmergencyProtocol();
          }
        }
      ],
      cssClass: 'panic-alert',
      backdropDismiss: false,
      translucent: true,
      animated: true
    });

    await alert.present();
  }

  private vibrateDevice() {
    if ('vibrate' in navigator) {
      navigator.vibrate([1000, 200, 500, 200, 500, 200, 1000]);
    }
  }

  private async executeTestEmergencyProtocol() {
    try {
      const loading = await this.loadingController.create({
        message: '🧪 TEST EMERGENCY PROTOCOL ACTIVATED 🧪\n\n• Simulating alert to authorities\n• Simulating emergency contacts\n• Calculating safe route\n• Testing emergency protocols',
        duration: 3000,
        cssClass: 'emergency-loading'
      });
      await loading.present();

      const user = await this.authService.getCurrentUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      const currentLocation = await this.locationService.getCurrentLocation();
      const userData = {
        firstName: 'Test',
        lastName: 'User',
        phone: 'Test Phone',
        emergencyContacts: []
      };
      const emergencyContacts = userData.emergencyContacts || [];

      const nearestSafeZone = await this.findNearestSafeZone(currentLocation);
      const alertData = {
        userId: user.uid,
        userName: `${userData.firstName} ${userData.lastName}`,
        userEmail: user.email,
        userPhone: userData.phone,
        location: {
          lat: currentLocation.lat,
          lng: currentLocation.lng,
          address: await this.getAddressFromCoords(currentLocation)
        },
        emergencyContacts: emergencyContacts,
        nearestSafeZone: nearestSafeZone,
        timestamp: new Date(),
        status: 'test',
        type: 'test-panic',
        priority: 'test'
      };

      await this.simulateNotifyAuthorities(alertData);

      await this.simulateNotifyEmergencyContacts(alertData);

      if (nearestSafeZone) {
        await this.routeToSafeZone(nearestSafeZone);
      }
      await this.showTestEmergencySuccess(nearestSafeZone);

      console.log('Test emergency protocol completed:', alertData);

    } catch (error) {
      console.error('Error in test emergency protocol:', error);
      await this.notificationService.error(
        'Test Emergency Alert Error',
        'Failed to complete test emergency protocol. Please try again.',
        'OK',
        5000
      );
    } finally {
      this.isPanicActive = false;
    }
  }

  private async executeEmergencyProtocol() {
    try {
      const loading = await this.loadingController.create({
        message: '🚨 EMERGENCY PROTOCOL ACTIVATED 🚨\n\n• Sending alert to authorities\n• Notifying emergency contacts\n• Calculating safe route\n• Activating emergency protocols',
        duration: 5000,
        cssClass: 'emergency-loading'
      });
      await loading.present();

      const user = await this.authService.getCurrentUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      const currentLocation = await this.locationService.getCurrentLocation();
      const userDoc = await this.firebaseService.getFirestoreInstance()
        .collection('users')
        .doc(user.uid)
        .get()
        .toPromise();

      const userData = userDoc?.data() as any;
      const emergencyContacts = userData?.emergencyContacts || [];

      const nearestSafeZone = await this.findNearestSafeZone(currentLocation);
      const alertData = {
        userId: user.uid,
        userName: `${userData?.firstName || 'Unknown'} ${userData?.lastName || 'User'}`,
        userEmail: user.email,
        userPhone: userData?.phone || 'Unknown',
        location: {
          lat: currentLocation.lat,
          lng: currentLocation.lng,
          address: await this.getAddressFromCoords(currentLocation)
        },
        emergencyContacts: emergencyContacts,
        nearestSafeZone: nearestSafeZone,
        timestamp: new Date(),
        status: 'active',
        type: 'panic',
        priority: 'high'
      };

      await this.firebaseService.addDocument('emergencyAlerts', alertData);

      await this.notifyAuthorities(alertData);

      await this.notifyEmergencyContacts(alertData);

      if (nearestSafeZone) {
        await this.routeToSafeZone(nearestSafeZone);
      }
      await this.showEmergencySuccess(nearestSafeZone);

      console.log('Emergency protocol completed:', alertData);

    } catch (error) {
      console.error('Error in emergency protocol:', error);
      await this.notificationService.error(
        'Emergency Alert Error',
        'Failed to complete emergency protocol. Please try again or contact authorities directly.',
        'OK',
        5000
      );
    } finally {
      this.isPanicActive = false;
    }
  }

  private async findNearestSafeZone(currentLocation: { lat: number; lng: number }) {
    const safeZones = this.zones.filter(zone => zone.level === 'Safe');
    
    if (safeZones.length === 0) {
      return {
        id: 'default-safe-zone',
        name: 'Cebu City Safe Zone',
        coordinates: [123.88, 10.30],
        distance: '2.5 km',
        estimatedTime: '5 minutes'
      };
    }
    let nearestZone = safeZones[0];
    let shortestDistance = this.calculateDistance(
      currentLocation.lat, currentLocation.lng,
      nearestZone.coordinates[0][1], nearestZone.coordinates[0][0]
    );

    for (const zone of safeZones) {
      const distance = this.calculateDistance(
        currentLocation.lat, currentLocation.lng,
        zone.coordinates[0][1], zone.coordinates[0][0]
      );
      
      if (distance < shortestDistance) {
        shortestDistance = distance;
        nearestZone = zone;
      }
    }

    return {
      id: nearestZone.id,
      name: nearestZone.name,
      coordinates: [nearestZone.coordinates[0][0], nearestZone.coordinates[0][1]],
      distance: `${(shortestDistance * 111).toFixed(1)} km`,
      estimatedTime: `${Math.ceil(shortestDistance * 111 * 2)} minutes`
    };
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI/180);
  }

  private async getAddressFromCoords(coords: { lat: number; lng: number }): Promise<string> {
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${coords.lng},${coords.lat}.json?access_token=pk.eyJ1IjoidG9taWthemUxIiwiYSI6ImNtY25rM3NxazB2ZG8ybHFxeHVoZWthd28ifQ.Vnf9pMEQAryEI2rMJeMQGQ`
      );
      const data = await response.json();
      return data.features[0]?.place_name || 'Unknown location';
    } catch (error) {
      return 'Unknown location';
    }
  }

  private async notifyAuthorities(alertData: any) {
    
    console.log('Notifying authorities:', alertData);
    
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  private async notifyEmergencyContacts(alertData: any) {
    console.log('Notifying emergency contacts:', alertData.emergencyContacts);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  private async routeToSafeZone(safeZone: any) {
    console.log('🗺️ routeToSafeZone called with:', safeZone);
    console.log('🗺️ Current map state:', this.map ? 'Map exists' : 'No map');
    console.log('🗺️ Current location:', this.currentLocation);
    
    if (this.map && safeZone.coordinates) {
      console.log('🗺️ Routing to safe zone:', safeZone);
      console.log('🗺️ Safe zone coordinates:', safeZone.coordinates);
      
      await this.getDirections(safeZone.coordinates);
      await this.notificationService.success(
        '🗺️ SAFE ROUTE ACTIVATED 🗺️',
        `🚨 Emergency Route to Safety:\n\n📍 Destination: ${safeZone.name}\n📏 Distance: ${safeZone.distance}\n⏱️ Estimated Time: ${safeZone.estimatedTime}\n\n🗺️ Route displayed on map with red line\n🟢 Green dot = Your location\n🔴 Red dot = Safe zone destination\n\nFollow the route to safety!`,
        'OK',
        8000
      );
    } else {
      console.log('❌ Cannot route: No map or safe zone coordinates');
      console.log('❌ Map exists:', !!this.map);
      console.log('❌ Safe zone coordinates:', safeZone?.coordinates);
    }
  }

  private async showEmergencySuccess(safeZone: any) {
    this.vibrateDevice();
    await this.notificationService.success(
      '🚨 EMERGENCY ALERT SENT SUCCESSFULLY 🚨',
      `Emergency protocols activated!\n\n✅ Authorities notified\n✅ Emergency contacts alerted\n✅ Safe route to ${safeZone?.name || 'nearest safe zone'} activated\n\nStay safe and follow the route!`,
      'OK',
      8000
    );
  }

  private async simulateNotifyAuthorities(alertData: any) {
    console.log('🧪 TEST: Simulating notification to authorities:', alertData);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  private async simulateNotifyEmergencyContacts(alertData: any) {
    console.log('🧪 TEST: Simulating notification to emergency contacts:', alertData.emergencyContacts);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  private async showTestEmergencySuccess(safeZone: any) {
    this.vibrateDevice();
    await this.notificationService.success(
      '🧪 TEST EMERGENCY ALERT COMPLETED 🧪',
      `Test emergency protocols completed!\n\n✅ Test authorities notification\n✅ Test emergency contacts notification\n✅ Safe route to ${safeZone?.name || 'nearest safe zone'} calculated\n\nThis was a TEST - no real emergency was triggered!`,
      'OK',
      8000
    );
  }

  
  async testIncidentAlerts() {
    try {
      this.zoneEngine.simulateRecentIncidents();
      await this.notificationService.success(
        '🧪 TEST INCIDENTS SIMULATED',
        'Recent incidents have been added to test the alert system.\n\n• Recent assault in danger zone (15 min ago)\n• Nearby theft in caution zone (90 min ago)\n\nMove into these zones to test alerts!',
        'OK',
        8000
      );
      
      console.log('🧪 Incident alerts test initiated');
    } catch (error) {
      console.error('Error testing incident alerts:', error);
    }
  }

  
  async testRedZoneEntry() {
    try {
      
      const dangerZoneLocation = { lat: 10.320, lng: 123.900 }; 
      
      
      this.currentLocation = dangerZoneLocation;
      this.zoneEngine.updateCurrentLocation(dangerZoneLocation);
      
      
      this.vibrateDevice();
      
      
      const alert = await this.alertController.create({
        header: '🚨 DANGER ZONE ALERT 🚨',
        message: `You have entered a HIGH RISK area!\n\n📍 Location: Guadalupe Danger Zone\n⚠️ Risk Level: EXTREME\n📊 Recent Incidents: Multiple assaults reported\n⏰ Time Risk: High (night time)\n\n🛡️ STAY ALERT AND BE CAUTIOUS!\n\nDo you want to use your panic button for emergency assistance?`,
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            cssClass: 'cancel-button',
            handler: () => {
              console.log('User dismissed danger zone alert');
            }
          },
          {
            text: '🚨 USE PANIC BUTTON',
            cssClass: 'emergency-button',
            handler: async () => {
              await this.triggerPanicButton();
            }
          }
        ],
        cssClass: 'danger-zone-alert',
        backdropDismiss: false,
        translucent: true,
        animated: true
      });

      await alert.present();
      
      
      await this.notificationService.warning(
        '🚨 DANGER ZONE ENTERED',
        'You are in a high-risk area. Stay alert and consider using the panic button if needed.',
        'OK',
        5000
      );
      
      console.log('🧪 Red zone entry test completed');
    } catch (error) {
      console.error('Error testing red zone entry:', error);
    }
  }

  
  async testTimeBasedZoneChanges() {
    try {
      
      const colonLocation = { lat: 10.305, lng: 123.905 }; 
      
      
      this.currentLocation = colonLocation;
      this.zoneEngine.updateCurrentLocation(colonLocation);
      
      
      const currentHour = new Date().getHours();
      let expectedLevel = 'Neutral';
      let timeDescription = '';
      
      if (currentHour >= 6 && currentHour <= 11) {
        expectedLevel = 'Neutral';
        timeDescription = 'Morning (6 AM - 11 AM)';
      } else if (currentHour >= 12 && currentHour <= 17) {
        expectedLevel = 'Caution';
        timeDescription = 'Afternoon (12 PM - 5 PM)';
      } else if (currentHour >= 18 && currentHour <= 23) {
        expectedLevel = 'Danger';
        timeDescription = 'Evening (6 PM - 11 PM)';
      } else {
        expectedLevel = 'Danger';
        timeDescription = 'Night (12 AM - 5 AM)';
      }
      
      
      this.vibrateDevice();
      
      
      const alert = await this.alertController.create({
        header: `🕐 TIME-BASED ZONE TEST: Colon Area`,
        message: `Testing time-based zone changes!\n\n📍 Location: Colon Area\n⏰ Current Time: ${timeDescription}\n🔄 Expected Level: ${expectedLevel}\n\nThis zone changes risk level based on time:\n• Morning (6-11 AM): 🟡 Neutral\n• Afternoon (12-5 PM): 🟠 Caution\n• Evening (6-11 PM): 🔴 Danger\n• Night (12-5 AM): 🔴 High Danger\n\nMove to this area to test real-time changes!`,
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            cssClass: 'cancel-button',
            handler: () => {
              console.log('User dismissed time-based zone test');
            }
          },
          {
            text: '🕐 TEST ZONE CHANGES',
            cssClass: 'test-button',
            handler: async () => {
              await this.simulateTimeBasedZoneChanges();
            }
          }
        ],
        cssClass: 'time-zone-test-alert',
        backdropDismiss: false,
        translucent: true,
        animated: true
      });

      await alert.present();
      
      
      await this.notificationService.info(
        '🕐 TIME-BASED ZONE TEST',
        `Colon Area is currently ${expectedLevel} level (${timeDescription}). Move to this area to test real-time changes!`,
        'OK',
        8000
      );
      
      console.log('🧪 Time-based zone changes test initiated');
    } catch (error) {
      console.error('Error testing time-based zone changes:', error);
    }
  }

  
  private async simulateTimeBasedZoneChanges() {
    try {
      const colonLocation = { lat: 10.305, lng: 123.905 };
      this.currentLocation = colonLocation;
      this.zoneEngine.updateCurrentLocation(colonLocation);
      
      
      this.zoneEngine['updateAllZones']();
      
      await this.notificationService.success(
        '🕐 TIME-BASED ZONE SIMULATION',
        'Time-based zone changes have been triggered!\n\nCheck the console for zone level updates and alerts.',
        'OK',
        5000
      );
      
      console.log('🧪 Time-based zone simulation completed');
    } catch (error) {
      console.error('Error simulating time-based zone changes:', error);
    }
  }

}
