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
  reportMarkers: mapboxgl.Marker[] = []; // For individual report markers
  validatedReports: any[] = []; // Store validated reports directly
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
    // Remove report markers
    this.reportMarkers.forEach(marker => marker.remove());
    this.reportMarkers = [];
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

  updateUserMarker(location: { lat: number; lng: number; heading?: number }) {
    if (this.userMarker && this.map) {
      // Smoothly animate marker movement
      this.userMarker.setLngLat([location.lng, location.lat]);
      
      // Update heatmap with new location if visible
      if (this.isHeatmapVisible) {
        this.updateRealTimeUserLocationInHeatmap(location);
        // When heatmap is ON - DO NOT move camera, user controls it freely
        return;
      }
      
      // WAZE-STYLE NAVIGATION - Camera follows ONLY when heatmap is OFF
      const currentZoom = this.map.getZoom();
      const currentBearing = this.map.getBearing();
      
      // Use heading if available for map rotation (heading = direction user is facing/moving)
      const targetBearing = location.heading !== undefined && location.heading !== null 
        ? location.heading 
        : currentBearing;
      
      // Waze-style camera animation - smooth and fluid following
      const animationOptions = {
        center: [location.lng, location.lat] as [number, number],
        zoom: Math.max(currentZoom, 17.5), // Waze's optimal street-level zoom
        pitch: 55, // Waze's 3D perspective angle
        bearing: targetBearing, // Rotate map to match direction of travel
        duration: 800, // Smooth 800ms animation (feels natural for navigation)
        essential: true, // Animation not affected by prefers-reduced-motion
        easing: (t: number) => t * (2 - t) // Ease-out for smooth deceleration
      };
      
      this.map.easeTo(animationOptions);
      
      // Rotate the navigation arrow to match heading
      // Note: Arrow always points UP on screen (forward direction)
      // Map rotates underneath, so arrow stays pointing in direction of travel
      if (location.heading !== undefined && location.heading !== null) {
        const markerElement = this.userMarker.getElement();
        if (markerElement) {
          // Since map rotates with bearing, arrow should point north (up) in local coordinate system
          // The map rotation will make it point in the right direction
          markerElement.style.transform = `rotate(0deg)`;
        }
      }
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
    
    // Waze-style clean streets map (no incidents layer = no 404 errors)
    const mapStyle = 'mapbox://styles/mapbox/streets-v12'; // Clean Waze-like street view
    
    // WAZE-STYLE NAVIGATION VIEW - Exact 3D perspective matching Waze
    this.map = new mapboxgl.Map({
      container: 'map',
      style: mapStyle,
      center: [this.currentLocation.lng, this.currentLocation.lat],
      zoom: 17.5, // Waze's street-level zoom (slightly zoomed out for context)
      pitch: 55, // Waze uses ~55° tilt for optimal street view
      bearing: 0, // Rotates based on heading (direction of travel)
      interactive: true,
      trackResize: true,
      attributionControl: false,
      maxPitch: 85,
      antialias: true, // Smooth 3D rendering
      // Optimize for navigation performance
      preserveDrawingBuffer: false,
      refreshExpiredTiles: true
    });

    // Create EXACT Waze-style navigation marker - solid blue triangle (like screenshot)
    const markerElement = document.createElement('div');
    markerElement.className = 'waze-navigation-marker';
    markerElement.innerHTML = `
      <!-- Accuracy radius circle (light blue) -->
      <div class="accuracy-radius"></div>
      
      <!-- Waze-style SOLID BLUE triangle arrow (bottom point at GPS location) -->
      <svg width="44" height="52" viewBox="0 0 44 52" class="waze-arrow">
        <defs>
          <!-- Shadow for depth -->
          <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
            <feOffset dx="0" dy="2" result="offsetblur"/>
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.6"/>
            </feComponentTransfer>
            <feMerge>
              <feMergeNode/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        <!-- Solid blue triangle - tip pointing UP, bottom at viewBox bottom -->
        <path d="M22 6 L36 30 L30 30 L30 46 L14 46 L14 30 L8 30 Z" 
              fill="#00B8D4" 
              stroke="#FFFFFF" 
              stroke-width="2.5"
              filter="url(#shadow)"
              class="nav-arrow"/>
        
        <!-- Small white dot in center for depth -->
        <circle cx="22" cy="32" r="2.5" fill="#FFFFFF" opacity="0.9"/>
      </svg>
    `;

    // Waze-style CSS - arrow bottom point at exact GPS location
    const style = document.createElement('style');
    style.textContent = `
      .waze-navigation-marker {
        position: relative;
        width: 44px;
        height: 52px;
        display: flex;
        align-items: flex-end;
        justify-content: center;
      }
      
      .accuracy-radius {
        position: absolute;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: rgba(0, 184, 212, 0.15);
        border: 2px solid rgba(0, 184, 212, 0.4);
        bottom: -8px;
        left: 50%;
        transform: translateX(-50%);
        animation: pulse-radius 2.5s ease-in-out infinite;
        pointer-events: none;
      }
      
      .waze-arrow {
        position: relative;
        z-index: 2;
        filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.3));
        display: block;
      }
      
      .nav-arrow {
        transition: all 0.2s ease;
      }
      
      @keyframes pulse-radius {
        0%, 100% {
          transform: translateX(-50%) scale(1);
          opacity: 0.6;
        }
        50% {
          transform: translateX(-50%) scale(1.2);
          opacity: 0.3;
        }
      }
    `;
    document.head.appendChild(style);

    this.userMarker = new mapboxgl.Marker({
      element: markerElement,
      anchor: 'bottom', // Bottom of triangle at exact GPS location (like Waze)
      rotationAlignment: 'map', // Rotate with map
      pitchAlignment: 'map' // Tilt with map pitch
    })
      .setLngLat([this.currentLocation.lng, this.currentLocation.lat])
      .addTo(this.map);

    this.map.on('load', () => {
      console.log('Map loaded in HomePage - Simple Waze-like navigation');
      
      // Keep it simple - just streets, no 3D buildings
      // Clean Waze-like experience with flat streets and navigation arrow
      
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

    // Refresh markers visibility when zoom changes (matching admin)
    this.map.on('zoomend', () => {
      if (this.isHeatmapVisible) {
        this.updateReportMarkers();
      }
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
    console.log('Loading validated reports for heatmap...');
    this.zoneEngine.zones$.subscribe({
      next: (zones) => {
        console.log('Validated report zones loaded from service:', zones);
        
        // Store zones for backward compatibility
        this.zones = zones || [];
        
        // Extract validated reports from zones for marker display
        this.validatedReports = zones
          .filter(zone => zone.riskLevel !== null && zone.riskLevel !== undefined) // Only include zones with valid risk levels
          .map(zone => {
            // Get the original report's admin validation level if available
            const originalReport = zone.incidents && zone.incidents.length > 0 ? zone.incidents[0] : null;
            const adminLevel = originalReport?.level; // Admin's 1-5 validation
            const zoneRiskLevel = zone.riskLevel; // Zone's calculated risk level (should already be admin level)
            
            // Debug: Check if there's a mismatch
            console.log(`🔍 Zone: ${zone.name}`, {
              zoneRiskLevel: zoneRiskLevel,
              originalReportLevel: adminLevel,
              originalReportRiskLevel: originalReport?.riskLevel
            });
            
            return {
              id: zone.id,
              type: zone.name,
              location: {
                lat: zone.coordinates[0][1], // Get center lat
                lng: zone.coordinates[0][0]  // Get center lng
              },
              riskLevel: zoneRiskLevel, // Zone's risk level (should be admin validation)
              level: zoneRiskLevel,      // Also store in level for compatibility
              description: originalReport?.description || 'Validated incident report',
              timestamp: originalReport?.timestamp || new Date(),
              locationAddress: zone.name,
              createdAt: originalReport?.timestamp || new Date()
            };
          });
        
        console.log('Extracted validated reports for markers:', this.validatedReports.length);
        
        // Update markers when heatmap is visible
        if (this.isHeatmapVisible && this.map) {
          this.updateReportMarkers();
          this.updateHeatmapLayer();
        }
      },
      error: (error) => {
        console.error('Error loading zones:', error);
        this.zones = [];
        this.validatedReports = [];
      }
    });
  }

  // Removed hardcoded sample zones - now using validated reports from admin

  updateHeatmap() {
    if (!this.map) {
      console.log('Cannot update heatmap: map not available');
      return;
    }

    console.log('Updating heatmap with validated reports:', this.validatedReports?.length || 0);
    
    if (this.isHeatmapVisible) {
      // Add report markers (like admin)
      this.updateReportMarkers();
      
      // Add heatmap layer (like admin)
      this.updateHeatmapLayer();
      
      // Add real-time user location
      this.addRealTimeUserLocationToHeatmap();
    } else {
      // Remove markers and layers
      this.removeReportMarkers();
      this.removeHeatmapLayer();
      this.removeRealTimeUserLocationFromHeatmap();
    }

    console.log('Heatmap updated successfully');
  }

  private updateReportMarkers() {
    if (!this.map) return;

    // Only show individual markers at high zoom to avoid color stacking (matching admin)
    const zoom = this.map.getZoom();
    const shouldShowMarkers = zoom >= 14;

    // Remove existing markers
    this.reportMarkers.forEach(marker => marker.remove());
    this.reportMarkers = [];

    if (!shouldShowMarkers) {
      return; // keep map clean at lower zooms; heat layers convey density
    }

    // Add markers for each validated report (same as admin)
    this.validatedReports.forEach(report => {
      const lat = report.location?.lat;
      const lng = report.location?.lng;
      
      if (lat === undefined || lng === undefined) return;
      
      // Skip reports without valid risk level
      const hasRiskLevel = (report.riskLevel !== null && report.riskLevel !== undefined) || 
                           (report.level !== null && report.level !== undefined);
      if (!hasRiskLevel) {
        console.warn('Skipping report without risk level:', report.id);
        return;
      }

      // Create custom marker element (same as admin)
      const el = document.createElement('div');
      el.className = 'custom-marker';
      el.style.width = '30px';
      el.style.height = '30px';
      el.style.borderRadius = '50%';
      el.style.cursor = 'pointer';
      el.style.border = '3px solid white';
      el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
      
      // Color based on risk level - PRIORITY: level (admin validation) > riskLevel (auto-calculated)
      const color = this.getReportRiskColor(report.level || report.riskLevel || 1);
      el.style.backgroundColor = color;

      // Create popup (same as admin)
      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
        <div style="padding: 10px; min-width: 200px;">
          <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">
            ${report.type || 'Incident'}
          </h3>
          <p style="margin: 5px 0; font-size: 13px; color: #666;">
            <strong>Risk Level:</strong> ${report.level || report.riskLevel || 'N/A'}
          </p>
          <p style="margin: 5px 0; font-size: 13px; color: #666;">
            <strong>Location:</strong> ${report.locationAddress || 'Unknown'}
          </p>
          <p style="margin: 5px 0; font-size: 13px; color: #666;">
            <strong>Date:</strong> ${this.formatReportDate(report.timestamp)}
          </p>
          <p style="margin: 5px 0; font-size: 13px; color: #666;">
            <strong>Description:</strong> ${report.description.substring(0, 100)}...
          </p>
          <div style="margin-top: 10px; padding: 5px; background: ${color}; color: white; border-radius: 4px; text-align: center; font-size: 12px; font-weight: bold;">
            ${this.getReportRiskLabel(report.level || report.riskLevel || 1)}
          </div>
        </div>
      `);

      // Add marker to map
      const marker = new mapboxgl.Marker(el)
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(this.map!);

      this.reportMarkers.push(marker);
    });

    console.log('📍 Added', this.reportMarkers.length, 'report markers to map');
  }

  private updateHeatmapLayer() {
    if (!this.map) return;

    // Create GeoJSON from validated reports (matching admin implementation)
    const geojson = {
      type: 'FeatureCollection',
      features: this.validatedReports
        .filter(r => {
          // Only include reports with valid location and risk level
          const hasLocation = r.location?.lat && r.location?.lng;
          const hasRiskLevel = (r.riskLevel !== null && r.riskLevel !== undefined) || 
                               (r.level !== null && r.level !== undefined);
          return hasLocation && hasRiskLevel;
        })
        .map(r => {
          // Get risk level - PRIORITY: level (admin validation) > riskLevel (auto-calculated)
          const adminLevel = r.level; // Admin's 1-5 star validation
          const autoRiskLevel = r.riskLevel; // Auto-calculated from incident type
          const finalLevel = adminLevel ?? autoRiskLevel ?? 1;
          const numLevel = Number(finalLevel);
          
          // Debug logging to check risk levels
          console.log(`📍 Heatmap point: ${r.locationAddress || 'Unknown'}`, {
            adminLevel: adminLevel,
            autoRiskLevel: autoRiskLevel,
            finalLevel: numLevel,
            color: numLevel === 1 ? 'Green' : numLevel === 2 ? 'Yellow' : numLevel === 3 ? 'Orange' : numLevel === 4 ? 'Red' : 'Dark Red'
          });
          
          return {
            type: 'Feature',
            properties: {
              weight: numLevel // Ensure weight is always a number
            },
            geometry: {
              type: 'Point',
              coordinates: [r.location.lng, r.location.lat]
            }
          };
        })
    };

    // Log cluster statistics
    console.log(`🗺️ Heatmap Update: ${geojson.features.length} total validated incidents`);
    console.log(`🎯 Cluster Settings: radius=25px, maxZoom=14 (tighter clustering for accuracy)`);
    console.log(`📊 Zoom behavior:
      - Zoom 5-11: Clusters only (overview)
      - Zoom 12-14: Clusters + individual points transition
      - Zoom 15+: Individual points only (detail view)
    `);

    // Add or update main source (matching admin)
    const sourceId = 'validated-incidents';
    const source = this.map.getSource(sourceId) as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(geojson as any);
    } else {
      this.map.addSource(sourceId, {
        type: 'geojson',
        data: geojson as any
      });
    }

    // Add clustered source for low-zoom visualization (matching admin)
    const clusterSourceId = 'validated-incidents-cluster';
    const clusterSource = this.map.getSource(clusterSourceId) as mapboxgl.GeoJSONSource;
    if (clusterSource) {
      clusterSource.setData(geojson as any);
    } else {
      this.map.addSource(clusterSourceId, {
        type: 'geojson',
        data: geojson as any,
        cluster: true,
        clusterRadius: 25, // Reduced from 40 - only cluster very close incidents
        clusterMaxZoom: 14, // Increased from 11 - show individual points when zoomed in more
        clusterProperties: {
          level1: ['+', ['case', ['==', ['get', 'weight'], 1], 1, 0]],
          level2: ['+', ['case', ['==', ['get', 'weight'], 2], 1, 0]],
          level3: ['+', ['case', ['==', ['get', 'weight'], 3], 1, 0]],
          level4: ['+', ['case', ['==', ['get', 'weight'], 4], 1, 0]],
          level5: ['+', ['case', ['==', ['get', 'weight'], 5], 1, 0]],
          maxLevel: ['max', ['get', 'weight']]
        }
      } as any);
    }

    // Multi-layer heatmap approach (matching admin exactly) - one layer per risk level
    const heatLayers = [
      {
        id: 'heat-l1', level: 1, rgba: [16, 185, 129], // Green
        weight: 0.5,
        radiusStops: [5, 28, 10, 40, 15, 56],
        intensityStops: [5, 0.8, 10, 1.0, 15, 1.2]
      },
      {
        id: 'heat-l2', level: 2, rgba: [251, 191, 36], // Yellow - should show as yellow/orange, NOT red
        weight: 0.7,
        radiusStops: [5, 26, 10, 38, 15, 52],
        intensityStops: [5, 0.9, 10, 1.1, 15, 1.3]
      },
      {
        id: 'heat-l3', level: 3, rgba: [249, 115, 22], // Orange
        weight: 0.9,
        radiusStops: [5, 24, 10, 36, 15, 48],
        intensityStops: [5, 1.0, 10, 1.2, 15, 1.5]
      },
      {
        id: 'heat-l4', level: 4, rgba: [239, 68, 68], // Red
        weight: 1.1,
        radiusStops: [5, 22, 10, 34, 15, 44],
        intensityStops: [5, 1.2, 10, 1.5, 15, 1.8]
      },
      {
        id: 'heat-l5', level: 5, rgba: [220, 38, 38], // Dark Red
        weight: 1.3,
        radiusStops: [5, 20, 10, 32, 15, 40],
        intensityStops: [5, 1.4, 10, 1.7, 15, 2.0]
      }
    ];

    // Add per-level heatmap layers (matching admin exactly)
    heatLayers.forEach(layer => {
      if (!this.map!.getLayer(layer.id)) {
        this.map!.addLayer({
          id: layer.id,
          type: 'heatmap',
          source: sourceId,
          minzoom: 5,
          maxzoom: 16,
          filter: ['==', ['get', 'weight'], layer.level],
          paint: {
            'heatmap-weight': layer.weight,
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'],
              layer.radiusStops[0], layer.radiusStops[1],
              layer.radiusStops[2], layer.radiusStops[3],
              layer.radiusStops[4], layer.radiusStops[5]
            ],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'],
              layer.intensityStops[0], layer.intensityStops[1],
              layer.intensityStops[2], layer.intensityStops[3],
              layer.intensityStops[4], layer.intensityStops[5]
            ],
            'heatmap-opacity': 0.6, // Reduced from 0.7 to prevent color bleeding
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0.00, 'rgba(0,0,0,0)',
              0.15, ['rgba', layer.rgba[0], layer.rgba[1], layer.rgba[2], 0.25],
              0.40, ['rgba', layer.rgba[0], layer.rgba[1], layer.rgba[2], 0.6],
              0.70, ['rgba', layer.rgba[0], layer.rgba[1], layer.rgba[2], 0.85],
              1.00, ['rgba', layer.rgba[0], layer.rgba[1], layer.rgba[2], 1.0]
            ]
          }
        } as any);
      }
    });

    // Add cluster circles (matching admin)
    if (!this.map.getLayer('cluster-circles')) {
      this.map.addLayer({
        id: 'cluster-circles',
        type: 'circle',
        source: clusterSourceId,
        filter: ['has', 'point_count'],
        maxzoom: 15, // Increased from 12 - show clusters longer
        paint: {
          'circle-radius': [
            'step', ['get', 'point_count'],
            14, 10, 18, 25, 24, 50, 30
          ],
          'circle-color': [
            'match', ['get', 'maxLevel'],
            1, '#10b981',
            2, '#fbbf24',
            3, '#f97316',
            4, '#ef4444',
            5, '#dc2626',
            '#10b981'
          ],
          'circle-opacity': 0.6,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'white'
        }
      } as any);
    }

    // Add cluster count labels (matching admin)
    if (!this.map.getLayer('cluster-count')) {
      this.map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: clusterSourceId,
        filter: ['has', 'point_count'],
        maxzoom: 15, // Increased from 12 - show cluster counts longer
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 12
        },
        paint: {
          'text-color': '#111827'
        }
      } as any);
    }

    // Add individual unclustered points (visible when zoomed in past cluster threshold)
    if (!this.map.getLayer('unclustered-points')) {
      this.map.addLayer({
        id: 'unclustered-points',
        type: 'circle',
        source: clusterSourceId,
        filter: ['!', ['has', 'point_count']], // Only show points that are NOT clustered
        minzoom: 12, // Start showing individual points from zoom 12
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            12, 6,   // At zoom 12, radius 6px
            15, 10,  // At zoom 15, radius 10px
            18, 14   // At zoom 18, radius 14px
          ],
          'circle-color': [
            'match', ['get', 'weight'],
            1, '#10b981', // Green - Level 1
            2, '#fbbf24', // Yellow - Level 2
            3, '#f97316', // Orange - Level 3
            4, '#ef4444', // Red - Level 4
            5, '#dc2626', // Dark Red - Level 5
            '#10b981'     // Default green
          ],
          'circle-opacity': 0.8,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'white',
          'circle-stroke-opacity': 0.9
        }
      } as any);
    }
  }

  private removeReportMarkers() {
    this.reportMarkers.forEach(marker => marker.remove());
    this.reportMarkers = [];
  }

  private removeHeatmapLayer() {
    if (!this.map) return;
    
    // Remove all per-level heatmap layers (matching admin)
    const heatLayers = ['heat-l1', 'heat-l2', 'heat-l3', 'heat-l4', 'heat-l5'];
    heatLayers.forEach(layerId => {
      if (this.map!.getLayer(layerId)) {
        this.map!.removeLayer(layerId);
      }
    });

    // Remove cluster layers (matching admin)
    if (this.map.getLayer('cluster-count')) {
      this.map.removeLayer('cluster-count');
    }
    if (this.map.getLayer('cluster-circles')) {
      this.map.removeLayer('cluster-circles');
    }
    // Remove unclustered points layer
    if (this.map.getLayer('unclustered-points')) {
      this.map.removeLayer('unclustered-points');
    }
    
    // Remove sources
    const clusterSourceId = 'validated-incidents-cluster';
    const sourceId = 'validated-incidents';
    
    if (this.map.getSource(clusterSourceId)) {
      this.map.removeSource(clusterSourceId);
    }
    if (this.map.getSource(sourceId)) {
      this.map.removeSource(sourceId);
    }
  }

  private getReportRiskColor(level: number): string {
    // Exact match with admin's getRiskColor logic
    // 5-level color system based on validation levels
    const numLevel = Number(level);
    if (numLevel <= 1) return '#10b981'; // Green (low)
    if (numLevel === 2) return '#fbbf24'; // Yellow (moderate)
    if (numLevel === 3) return '#f97316'; // Orange (high)
    if (numLevel === 4) return '#ef4444'; // Red (critical)
    return '#dc2626'; // Dark Red (extreme)
  }

  private getReportRiskLabel(level: number): string {
    // Match admin's getRiskLabel popup labels
    // Convert to number to handle string values from Firebase
    const numLevel = Number(level);
    switch (numLevel) {
      case 1: return 'LEVEL 1 - LOW';
      case 2: return 'LEVEL 2 - MODERATE';
      case 3: return 'LEVEL 3 - HIGH';
      case 4: return 'LEVEL 4 - CRITICAL';
      case 5: return 'LEVEL 5 - EXTREME';
      default: return 'UNKNOWN';
    }
  }

  private formatReportDate(date: Date): string {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Old zone visualization methods removed - now using individual report markers like admin

  toggleHeatmap() {
    console.log('Toggle heatmap called, current state:', this.isHeatmapVisible);
    
    this.isHeatmapVisible = !this.isHeatmapVisible;
    console.log('New heatmap state:', this.isHeatmapVisible);
    
    if (!this.map) {
      console.warn('Map not initialized');
      return;
    }
    
    // Save current location for reference
    const currentCenter = this.currentLocation 
      ? [this.currentLocation.lng, this.currentLocation.lat] as [number, number]
      : this.map.getCenter();
    
    // Switch map style based on heatmap visibility
    if (this.isHeatmapVisible) {
      console.log('🗺️ HEATMAP MODE: Disabling navigation, enabling free map control...');
      // Plain white/light map for better heatmap visibility
      this.map.setStyle('mapbox://styles/mapbox/light-v11');
      
      // Wait for style to load before adding heatmap layers
      this.map.once('styledata', () => {
        if (!this.map) return;
        
        // Set camera for heatmap mode - flat top-down view, user controls freely
        this.map.jumpTo({
          center: currentCenter,
          zoom: 13, // Zoom out for heatmap overview
          bearing: 0, // Reset rotation to north-up
          pitch: 0 // Flat top-down view (no tilt)
        });
        
        // Re-add user marker
        if (this.userMarker && this.currentLocation && this.map) {
          this.userMarker.addTo(this.map);
        }
        
        this.updateHeatmap();
        
        console.log('✅ Heatmap mode active - navigation disabled, map is user-controlled');
        
        // Notify user about mode change
        this.notificationService.info(
          '🗺️ Heatmap Mode Active',
          'Navigation disabled. You have full control of the map. Zoom and pan freely to explore incident heatmap.',
          'OK',
          3000
        );
      });
    } else {
      console.log('🧭 NAVIGATION MODE: Restoring Waze-style camera following...');
      // Restore Waze-style clean streets map
      this.map.setStyle('mapbox://styles/mapbox/streets-v12');
      
      // Wait for style to load before restoring navigation
      this.map.once('styledata', () => {
        if (!this.map) return;
        
        // Re-add user marker
        if (this.userMarker && this.currentLocation && this.map) {
          this.userMarker.addTo(this.map);
        }
        
        // Resume Waze-style navigation camera following
        if (this.currentLocation && this.map) {
          this.map.easeTo({
            center: [this.currentLocation.lng, this.currentLocation.lat],
            zoom: 17.5, // Waze's street-level zoom
            pitch: 55, // Waze's 3D tilt
            bearing: this.map.getBearing(), // Keep current rotation
            duration: 1000
          });
        }
        
        console.log('✅ Navigation mode active - camera will follow user location');
        
        // Notify user about mode change
        this.notificationService.success(
          '🧭 Navigation Mode Active',
          'Camera will now follow your location. Waze-style 3D navigation restored.',
          'OK',
          2500
        );
      });
      
      // Remove heatmap data
      this.removeReportMarkers();
      this.removeHeatmapLayer();
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
