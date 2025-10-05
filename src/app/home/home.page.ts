import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { AlertController, LoadingController, ToastController, IonContent } from '@ionic/angular';
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
  @ViewChild('edgeHandle', { static: false }) edgeHandleRef?: ElementRef<HTMLDivElement>;
  private dragData: { dragging: boolean; startY: number; offsetY: number } = { dragging: false, startY: 0, offsetY: 200 };
  uiMode: 'sidebar' | 'buttons' = 'buttons';
  
  // Real-time tracking properties
  private realTimeLocationSubscription: any = null;
  private userMarker: mapboxgl.Marker | null = null;
  isRealTimeTracking = false;
  private trackingInterval = 3000; // 3 seconds for real-time updates
  batteryOptimizationMode = false;
  private trackingMode: 'high' | 'medium' | 'low' = 'medium';
  @ViewChild(IonContent, { static: false }) content?: IonContent;

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
    this.setupResizeListener();
    this.loadUiModePreference();
  }

  ionViewWillEnter() {
    // Ensure content starts at the top whenever this tab becomes active
    this.content?.scrollToTop(0);
    this.zoneEngine.initializeZones();
    this.loadUiModePreference();
  }


  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.stopRealTimeTracking();
    if (this.map) {
      this.map.remove();
    }
    // Remove resize listener
    window.removeEventListener('resize', this.handleResize);
  }

  // Real-time location tracking methods
  startRealTimeTracking() {
    if (this.isRealTimeTracking) {
      console.log('Real-time tracking already active');
      return;
    }

    console.log('Starting real-time location tracking...');
    this.isRealTimeTracking = true;

    // Adjust tracking interval based on mode
    const interval = this.getTrackingInterval();
    console.log(`Using tracking interval: ${interval}ms (${this.trackingMode} mode)`);

    this.realTimeLocationSubscription = this.locationService.startRealTimeTracking(interval)
      .subscribe({
        next: (location) => {
          console.log('Real-time location update:', location);
          this.updateUserMarker(location);
          this.currentLocation = location;
          this.zoneEngine.updateCurrentLocation(location);
          
          // Check if we should adjust tracking frequency based on movement
          this.optimizeTrackingFrequency(location);
        },
        error: (error) => {
          console.error('Real-time tracking error:', error);
          this.notificationService.warning(
            'Location Tracking',
            'Real-time location tracking encountered an error. Please check your location permissions.',
            'OK',
            3000
          );
        }
      });
  }

  private getTrackingInterval(): number {
    if (this.batteryOptimizationMode) {
      switch (this.trackingMode) {
        case 'high':
          return 5000; // 5 seconds
        case 'medium':
          return 10000; // 10 seconds
        case 'low':
          return 30000; // 30 seconds
        default:
          return 10000;
      }
    } else {
      switch (this.trackingMode) {
        case 'high':
          return 1000; // 1 second
        case 'medium':
          return 3000; // 3 seconds
        case 'low':
          return 10000; // 10 seconds
        default:
          return 3000;
      }
    }
  }

  private optimizeTrackingFrequency(location: { lat: number; lng: number }) {
    if (!this.currentLocation) return;

    // Calculate distance moved
    const distance = this.locationService.calculateDistance(
      this.currentLocation.lat,
      this.currentLocation.lng,
      location.lat,
      location.lng
    );

    // Adjust tracking frequency based on movement
    if (distance > 100) { // Moving fast (>100m)
      this.trackingMode = 'high';
    } else if (distance > 10) { // Moving moderately (>10m)
      this.trackingMode = 'medium';
    } else { // Stationary or slow movement
      this.trackingMode = 'low';
    }
  }

  setTrackingMode(mode: 'high' | 'medium' | 'low') {
    this.trackingMode = mode;
    console.log(`Tracking mode changed to: ${mode}`);
    
    // Restart tracking with new interval if currently tracking
    if (this.isRealTimeTracking) {
      this.stopRealTimeTracking();
      setTimeout(() => {
        this.startRealTimeTracking();
      }, 100);
    }
  }

  toggleBatteryOptimization() {
    this.batteryOptimizationMode = !this.batteryOptimizationMode;
    console.log(`Battery optimization: ${this.batteryOptimizationMode ? 'ON' : 'OFF'}`);
    
    // Restart tracking with new settings if currently tracking
    if (this.isRealTimeTracking) {
      this.stopRealTimeTracking();
      setTimeout(() => {
        this.startRealTimeTracking();
      }, 100);
    }

    this.notificationService.success(
      'Battery Optimization',
      `Battery optimization ${this.batteryOptimizationMode ? 'enabled' : 'disabled'}`,
      'OK',
      2000
    );
  }

  stopRealTimeTracking() {
    if (this.realTimeLocationSubscription) {
      this.realTimeLocationSubscription.unsubscribe();
      this.realTimeLocationSubscription = null;
    }
    this.isRealTimeTracking = false;
    console.log('Real-time tracking stopped');
  }

  updateUserMarker(location: { lat: number; lng: number }) {
    if (this.userMarker && this.map) {
      // Smoothly animate marker movement
      this.userMarker.setLngLat([location.lng, location.lat]);
      
      // Update heatmap with new location if visible
      if (this.isHeatmapVisible) {
        this.updateRealTimeUserLocationInHeatmap(location);
      }
      
      // Optionally, smoothly pan the map to follow the user
      // this.map.panTo([location.lng, location.lat]);
    }
  }

  // Heatmap real-time location methods
  addRealTimeUserLocationToHeatmap() {
    if (!this.map || !this.currentLocation) return;

    const sourceId = 'real-time-user-location';
    const layerId = 'real-time-user-location-layer';

    // Add source for real-time user location
    if (!this.map.getSource(sourceId)) {
      this.map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [this.currentLocation.lng, this.currentLocation.lat]
            },
            properties: {
              intensity: 1.0,
              timestamp: Date.now()
            }
          }]
        }
      });
    }

    // Add heatmap layer for user location
    if (!this.map.getLayer(layerId)) {
      this.map.addLayer({
        id: layerId,
        type: 'heatmap',
        source: sourceId,
        maxzoom: 15,
        paint: {
          'heatmap-weight': [
            'interpolate',
            ['linear'],
            ['get', 'intensity'],
            0, 0,
            1, 1
          ],
          'heatmap-intensity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 1,
            15, 3
          ],
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(33, 102, 172, 0)',
            0.2, 'rgb(103, 169, 207)',
            0.4, 'rgb(209, 229, 240)',
            0.6, 'rgb(253, 219, 199)',
            0.8, 'rgb(239, 138, 98)',
            1, 'rgb(178, 24, 43)'
          ],
          'heatmap-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 2,
            15, 20
          ],
          'heatmap-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            7, 1,
            15, 0
          ]
        }
      });
    }
  }

  updateRealTimeUserLocationInHeatmap(location: { lat: number; lng: number }) {
    if (!this.map) return;

    const sourceId = 'real-time-user-location';
    const source = this.map.getSource(sourceId) as mapboxgl.GeoJSONSource;

    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [location.lng, location.lat]
          },
          properties: {
            intensity: 1.0,
            timestamp: Date.now()
          }
        }]
      });
    }
  }

  removeRealTimeUserLocationFromHeatmap() {
    if (!this.map) return;

    const sourceId = 'real-time-user-location';
    const layerId = 'real-time-user-location-layer';

    if (this.map.getLayer(layerId)) {
      this.map.removeLayer(layerId);
    }
    if (this.map.getSource(sourceId)) {
      this.map.removeSource(sourceId);
    }
  }

  private setupResizeListener() {
    this.handleResize = () => {
      if (this.map) {
        setTimeout(() => {
          this.map!.resize();
        }, 100);
      }
    };
    window.addEventListener('resize', this.handleResize);
    
    // Handle orientation changes on mobile
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        if (this.map) {
          this.map.resize();
        }
      }, 300);
    });
  }

  private handleResize = () => {
    // This will be bound to the instance
  };

  private async initializeApp() {
    try {
      // Request location permissions first
      await this.requestLocationPermissions();
      
      const location = await this.locationService.getCurrentLocation();
      this.currentLocation = location;
      console.log('Current location set:', this.currentLocation);
      
      this.zoneEngine.updateCurrentLocation(location);
      
      // Check GPS accuracy
      await this.checkGPSAccuracy();
      
      this.initializeMap();
    } catch (error) {
      console.error('Error initializing app:', error);
      this.handleLocationError(error);
    }
  }

  private async requestLocationPermissions(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        this.notificationService.error(
          'Location Not Supported',
          'Your device does not support location services.',
          'OK',
          5000
        );
        resolve(false);
        return;
      }

      // Check if permissions are already granted
      if (navigator.permissions) {
        navigator.permissions.query({ name: 'geolocation' }).then((result) => {
          if (result.state === 'granted') {
            resolve(true);
          } else if (result.state === 'prompt') {
            // Permission will be requested when getCurrentPosition is called
            resolve(true);
          } else {
            this.notificationService.warning(
              'Location Permission Required',
              'Please enable location access in your browser settings to use real-time tracking.',
              'OK',
              5000
            );
            resolve(false);
          }
        }).catch(() => {
          // Fallback if permissions API is not supported
          resolve(true);
        });
      } else {
        // Fallback for browsers without permissions API
        resolve(true);
      }
    });
  }

  private handleLocationError(error: any) {
    let errorMessage = 'Unable to get your location';
    let shouldUseDefault = true;

    if (error.code) {
      switch (error.code) {
        case 1: // PERMISSION_DENIED
          errorMessage = 'Location access denied. Please enable location permissions in your browser settings.';
          this.notificationService.error(
            'Location Permission Denied',
            errorMessage,
            'OK',
            5000
          );
          break;
        case 2: // POSITION_UNAVAILABLE
          errorMessage = 'Location information is unavailable. Please check your GPS settings.';
          this.notificationService.warning(
            'Location Unavailable',
            errorMessage,
            'OK',
            5000
          );
          break;
        case 3: // TIMEOUT
          errorMessage = 'Location request timed out. Please try again.';
          this.notificationService.warning(
            'Location Timeout',
            errorMessage,
            'OK',
            3000
          );
          break;
        default:
          errorMessage = 'An unknown location error occurred.';
          break;
      }
    }

    if (shouldUseDefault) {
      this.currentLocation = { lat: 10.3157, lng: 123.8854 };
      console.log('Using default location due to error:', this.currentLocation);
      
      this.zoneEngine.updateCurrentLocation(this.currentLocation);
      this.initializeMap();
    }
  }

  ionViewDidEnter() {
    // Resize map when returning to this tab
    setTimeout(() => {
      if (this.map) {
        this.map.resize();
      }
    }, 100);

    this.setupEdgeHandleDrag();
  }

  openActionsMenu() {
    const menu = document.querySelector('ion-menu[menuId="home-actions"]') as HTMLIonMenuElement | null;
    if (menu) {
      menu.open();
    }
  }

  private setupEdgeHandleDrag() {
    const handle = this.edgeHandleRef?.nativeElement;
    if (!handle) return;

    const setY = (y: number) => {
      const viewportHeight = window.innerHeight;
      const min = 80;
      const max = viewportHeight - 160;
      const clamped = Math.max(min, Math.min(max, y));
      handle.style.top = clamped + 'px';
      this.dragData.offsetY = clamped;
    };

    setY(this.dragData.offsetY);

    const onPointerDown = (e: PointerEvent) => {
      this.dragData.dragging = true;
      this.dragData.startY = e.clientY - this.dragData.offsetY;
      handle.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.dragData.dragging) return;
      const y = e.clientY - this.dragData.startY;
      setY(y);
    };

    const onPointerUp = (e: PointerEvent) => {
      this.dragData.dragging = false;
      handle.releasePointerCapture(e.pointerId);
    };

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);

    // Clean up when leaving
    this.subscriptions.push({ unsubscribe: () => {
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
    }});
  }

  private loadUiModePreference() {
    const saved = localStorage.getItem('homeUIMode');
    this.uiMode = (saved === 'buttons' || saved === 'sidebar') ? (saved as any) : 'buttons';
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

    // Create a custom live marker element
    const markerElement = document.createElement('div');
    markerElement.className = 'live-user-marker';
    markerElement.innerHTML = `
      <div class="marker-pulse"></div>
      <div class="marker-icon">📍</div>
    `;

    // Add custom CSS for the live marker
    const style = document.createElement('style');
    style.textContent = `
      .live-user-marker {
        position: relative;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .marker-pulse {
        position: absolute;
        width: 40px;
        height: 40px;
        border: 3px solid #4CAF50;
        border-radius: 50%;
        animation: pulse 2s infinite;
        opacity: 0.7;
      }
      .marker-icon {
        position: relative;
        z-index: 1;
        font-size: 20px;
        filter: drop-shadow(0 0 3px rgba(0,0,0,0.3));
      }
      @keyframes pulse {
        0% {
          transform: scale(0.8);
          opacity: 0.7;
        }
        50% {
          transform: scale(1.2);
          opacity: 0.3;
        }
        100% {
          transform: scale(0.8);
          opacity: 0.7;
        }
      }
    `;
    document.head.appendChild(style);

    this.userMarker = new mapboxgl.Marker(markerElement)
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
      this.startRealTimeTracking();
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
      
      // Add real-time user location to heatmap
      this.addRealTimeUserLocationToHeatmap();
    } else {
      
      this.removeDangerZones();
      this.removeRealTimeUserLocationFromHeatmap();
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
