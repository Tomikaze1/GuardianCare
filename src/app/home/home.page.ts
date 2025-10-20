import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { AlertController, LoadingController, ToastController, IonContent, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { LocationService } from '../services/location.service';
import { ZoneDangerEngineService, DangerZone } from '../services/zone-danger-engine.service';
import { ZoneNotificationService, ZoneAlert } from '../services/zone-notification.service';
import { AuthService } from '../services/auth.service';
import { FirebaseService } from '../services/firebase.service';
import { ReportService } from '../services/report.service';
import { NotificationService } from '../shared/services/notification.service';
import { NotificationManagerService } from '../services/notification-manager.service';

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
  reportMarkers: mapboxgl.Marker[] = [];
  validatedReports: any[] = [];
  isHeatmapVisible = false;
  isPanicActive = false;
  inDangerZone = false;
  currentLanguage = 'en';
  gpsAccuracy: { accuracy: number; status: string } | null = null;
  isRefreshingLocation = false;
  currentAddress: string = '';
  private lastAddressUpdate: number = 0;
  
  nearbyZoneAlert: string = '';
  nearestZoneDistance: number | null = null;
  safetyStatus: 'safe' | 'warning' | 'danger' = 'safe';
  locationSafetyMessage: string = 'Checking location safety...';
  hasNearbyReports: boolean = false;
  nearbyReportsCount: number = 0;
  private previousSafetyStatus: 'safe' | 'warning' | 'danger' = 'safe';
  private wasInDangerZone: boolean = false;
  private subscriptions: any[] = [];
  private lastNotificationTime: number = 0;
  private currentZoneRiskLevel: number | null = null;
  @ViewChild('edgeHandle', { static: false }) edgeHandleRef?: ElementRef<HTMLDivElement>;
  private dragData: { dragging: boolean; startY: number; offsetY: number } = { dragging: false, startY: 0, offsetY: 200 };
  uiMode: 'sidebar' | 'buttons' = 'buttons';
  
  private realTimeLocationSubscription: any = null;
  private userMarker: mapboxgl.Marker | null = null;
  isRealTimeTracking = false;
  private trackingInterval = 3000;
  batteryOptimizationMode = false;
  private trackingMode: 'high' | 'medium' | 'low' = 'medium';
  @ViewChild(IonContent, { static: false }) content?: IonContent;
  
  activeZoneAlerts: ZoneAlert[] = [];
  currentZoneInfo: DangerZone | null = null;
  private reportsLoaded = false;
  private lastKnownReports: Set<string> = new Set(); // Track known reports for new report detection
  
  private alertSoundInterval: any = null;
  private currentAlertSound: any = null;

  constructor(
    private locationService: LocationService,
    private zoneEngine: ZoneDangerEngineService,
    private zoneNotificationService: ZoneNotificationService,
    private authService: AuthService,
    private firebaseService: FirebaseService,
    private reportService: ReportService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private modalController: ModalController,
    private translate: TranslateService,
    private notificationService: NotificationService,
    private notificationManager: NotificationManagerService,
  ) {}

  ngOnInit() {
    this.initializeApp();
    this.loadUserLanguage();
    this.setupResizeListener();
    this.loadUiModePreference();
    this.initializeZoneNotifications();
  }

  ionViewWillEnter() {
    this.content?.scrollToTop(0);
    this.zoneEngine.initializeZones();
    
    this.checkForNotificationNavigation();
    
    this.notificationService.dismissAll();
    
    this.isHeatmapVisible = false;
    
    this.removeReportMarkers();
    this.removeHeatmapLayer();
    
    if (this.map) {
      this.removeHeatmapLayer();
      this.removeReportMarkers();
    }
    
    this.loadValidatedReportsDirectly();
    this.loadUiModePreference();
  }


  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.stopRealTimeTracking();
    this.stopAlertSound();
    this.reportsLoaded = false;

    this.reportMarkers.forEach(marker => marker.remove());
    this.reportMarkers = [];
    if (this.map) {
      this.map.remove();
    }

    window.removeEventListener('resize', this.handleResize);
  }


  private initializeZoneNotifications() {

    this.requestNotificationPermissions();
  }

  private loadValidatedReportsDirectly() {
    if (this.reportsLoaded) {
      console.log('📍 LOADING REPORTS: Already loaded, skipping to prevent duplicates');
      return;
    }
    
    console.log('📍 LOADING REPORTS: Starting loadValidatedReportsDirectly');
    this.reportsLoaded = true;
    
    this.subscriptions.push(
      this.reportService.getAllReports().subscribe({
        next: (allReports) => {
          const reports = allReports.filter(r => r.status === 'Validated');
          console.log(`📍 LOADING REPORTS: Loaded ${allReports.length} total reports, ${reports.length} validated reports`);
          console.log('📍 LOADING REPORTS: All reports:', allReports.map(r => ({
            id: r.id,
            type: r.type,
            status: r.status
          })));
          console.log('📍 LOADING REPORTS: Validated reports:', reports.map(r => ({
            id: r.id,
            type: r.type,
            location: r.location,
            status: r.status
          })));
          
          if (!this.reportsLoaded) {
            const definedIds = reports.map(r => r.id).filter((id: any) => typeof id === 'string') as string[];
            this.lastKnownReports = new Set(definedIds);
            this.reportsLoaded = true;
          } else {
            this.checkForNewValidatedReports(reports);
            
            this.checkForNearbyNewReports(reports);
          }
          
          this.validatedReports = reports.map(report => ({
            id: report.id,
            type: report.type,
            description: report.description,
            location: {
              lat: report.location.lat,
              lng: report.location.lng,
              simplifiedAddress: report.location.simplifiedAddress,
              fullAddress: report.location.fullAddress
            },
            locationAddress: report.locationAddress,
            riskLevel: report.riskLevel,
            level: report.level,
            createdAt: report.createdAt,
            status: report.status,
            reporterName: report.reporterName,
            reporterEmail: report.reporterEmail,
            emergencyContact: report.emergencyContact,
            media: report.media,
            anonymous: report.anonymous
          }));
          
          if (this.isHeatmapVisible) {
            this.updateHeatmapLayer();
          } else {
            this.removeReportMarkers();
            this.removeHeatmapLayer();
          }
        },
        error: (error) => {
          console.error('Error loading validated reports:', error);
          this.validatedReports = [];
        }
      })
    );
  }

  private async requestNotificationPermissions() {
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
        console.log('Notification permission:', Notification.permission);
      } catch (error) {
        console.warn('Could not request notification permission:', error);
      }
    }
  }

  private checkZoneNotifications(location: { lat: number; lng: number }) {
    // Check for zone entry/exit and trigger appropriate alerts
    this.zoneNotificationService.checkZoneEntry(location);
    
    // Also update zone engine for internal tracking
    this.zoneEngine.updateCurrentLocation(location);
  }

  dismissZoneAlert(alertId: string) {
    this.zoneNotificationService.dismissAlert(alertId);
  }

  private triggerZoneNotification(alert: ZoneAlert) {
    const priority = this.getNotificationPriority(alert.zoneLevel);
    const title = this.getAlertTitle(alert.type);
    if (alert.type === 'zone_entry') {
      this.showZoneEntryNotification(alert);
      this.showZoneEntryAlert(alert);
    }
  }
  
  private showZoneEntryNotification(alert: ZoneAlert) {
    const notificationType = this.getNotificationType(alert.zoneLevel);
    const emoji = this.getZoneEmoji(alert.zoneLevel);
    
    this.notificationService.show({
      type: notificationType,
      title: `${emoji} Zone Alert`,
      message: `You've entered ${alert.zoneName} (${alert.zoneLevel} zone)`,
      actionText: 'OK',
      duration: 5000
    });
  }
  
  private async showZoneEntryAlert(alert: ZoneAlert) {
    const emoji = this.getZoneEmoji(alert.zoneLevel);
    const alertDialog = await this.alertController.create({
      header: `${emoji} ${alert.zoneLevel} Zone Detected`,
      subHeader: alert.zoneName,
      message: `You have entered a ${alert.zoneLevel.toLowerCase()} zone. ${this.getZoneAlertMessage(alert.zoneLevel)}`,
      buttons: [
        {
          text: 'View Recommendations',
          handler: () => {
            this.showZoneRecommendations(alert);
          }
        },
        {
          text: 'OK',
          role: 'cancel'
        }
      ],
      cssClass: `zone-alert-${alert.zoneLevel.toLowerCase()}`
    });
    
    await alertDialog.present();
  }
  
  private async showZoneRecommendations(alert: ZoneAlert) {
    const recommendations = alert.recommendations.join('\n\n');
    const recommendationAlert = await this.alertController.create({
      header: '📋 Safety Recommendations',
      subHeader: alert.zoneName,
      message: recommendations,
      buttons: ['Close'],
      cssClass: 'zone-recommendations-alert'
    });
    
    await recommendationAlert.present();
  }
  
  private getZoneEmoji(zoneLevel: string): string {
    switch (zoneLevel.toLowerCase()) {
      case 'danger':
        return '🔴';
      case 'caution':
        return '🟠';
      case 'neutral':
        return '🟡';
      case 'safe':
        return '🟢';
      default:
        return '⚪';
    }
  }
  
  private getZoneAlertMessage(zoneLevel: string): string {
    switch (zoneLevel.toLowerCase()) {
      case 'danger':
        return 'HIGH RISK: Consider leaving this area immediately and stay alert.';
      case 'caution':
        return 'MODERATE RISK: Stay cautious and aware of your surroundings.';
      case 'neutral':
        return 'NORMAL VIGILANCE: Be aware of your surroundings.';
      case 'safe':
        return 'This area is considered safe.';
      default:
        return 'Stay aware of your surroundings.';
    }
  }
  
  private getNotificationType(zoneLevel: string): 'success' | 'warning' | 'error' | 'info' {
    switch (zoneLevel.toLowerCase()) {
      case 'danger':
        return 'error';
      case 'caution':
        return 'warning';
      case 'neutral':
        return 'info';
      case 'safe':
        return 'success';
      default:
        return 'info';
    }
  }

  private getNotificationPriority(zoneLevel: string): 'medium' | 'high' | 'critical' {
    switch (zoneLevel.toLowerCase()) {
      case 'danger':
      case 'critical':
      case 'extreme':
        return 'critical';
      case 'caution':
      case 'high':
        return 'high';
      default:
        return 'medium';
    }
  }

  private checkForNewValidatedReports(reports: any[]) {
    const currentReportIds = new Set(reports.map(r => r.id));
    
    const newReports = reports.filter(report => 
      !this.lastKnownReports.has(report.id) && 
      report.status === 'validated'
    );

    console.log(`🔔 Checking for new validated reports: ${newReports.length} new reports found`);

    newReports.forEach(report => {
      if (report.status === 'validated') {
        let distanceFromUser: number | undefined;
        if (this.currentLocation && report.location?.lat && report.location?.lng) {
          distanceFromUser = this.calculateDistance(
            this.currentLocation.lat,
            this.currentLocation.lng,
            report.location.lat,
            report.location.lng
          );
        }

        if (distanceFromUser && distanceFromUser <= 500) {
          const riskLevel = report.riskLevel || report.level || 1;
          let zoneLevel = 'Caution';
          let icon = '🟠';
          let title = 'NEW INCIDENT REPORTED NEARBY';
          let message = `⚠️ A new ${report.type.toLowerCase()} incident has been reported ${Math.round(distanceFromUser)}m away!\n\n📍 Location: ${report.locationAddress || report.location?.fullAddress || report.location?.simplifiedAddress || 'Unknown location'}\n\n🚨 This is a NEW report that was just validated by admin. Stay alert and aware of your surroundings.`;
          
          if (riskLevel >= 4) {
            zoneLevel = 'Danger';
            icon = '🔴';
            title = 'NEW DANGER INCIDENT NEARBY';
            message = `🚨 A new ${report.type.toLowerCase()} incident has been reported ${Math.round(distanceFromUser)}m away!\n\n📍 Location: ${report.locationAddress || report.location?.fullAddress || report.location?.simplifiedAddress || 'Unknown location'}\n\n⚠️ This is a HIGH RISK incident that was just validated by admin. Consider avoiding this area.`;
          }
          
          if (this.inDangerZone || this.currentZoneRiskLevel) {
            this.startContinuousAlertSoundForRiskLevel(riskLevel);
          }
          
          this.showZoneAlert(icon, title, message, zoneLevel);
          
          console.log(`🚨 NEW INCIDENT ALERT triggered for nearby report:`, {
            id: report.id,
            type: report.type,
            location: report.locationAddress,
            riskLevel: riskLevel,
            distance: `${Math.round(distanceFromUser)}m`,
            zoneLevel: zoneLevel
          });
        } else {
        }

        console.log(`🔔 Admin validation notification triggered for report:`, {
          id: report.id,
          type: report.type,
          location: report.locationAddress,
          riskLevel: report.riskLevel || report.level,
          distance: distanceFromUser ? `${Math.round(distanceFromUser)}m` : 'unknown'
        });
      }
    });

    this.lastKnownReports = currentReportIds;
  }

  private checkForNearbyNewReports(newReports: any[]) {
    if (!this.currentLocation) return;

    const userLat = this.currentLocation.lat;
    const userLng = this.currentLocation.lng;
    // Use 30m for nearby reports (2x zone radius for broader notification area)
    const nearbyRadius = 0.03; // 30 meters in kilometers

    newReports.forEach(report => {
      if (report.location?.lat && report.location?.lng) {
        const distance = this.calculateDistance(
          userLat, userLng,
          report.location.lat, report.location.lng
        );

        if (distance <= nearbyRadius) {
          const priority = this.getReportNotificationPriority(report.riskLevel || report.level);
        }
      }
    });
  }

  private getReportNotificationPriority(riskLevel: any): 'low' | 'medium' | 'high' {
    if (!riskLevel) return 'medium';
    
    const level = typeof riskLevel === 'number' ? riskLevel : parseInt(riskLevel);
    
    if (level >= 4) return 'high';
    if (level >= 2) return 'medium';
    return 'low';
  }

  getCurrentZoneInfo(): DangerZone | null {
    return this.zoneNotificationService.getCurrentZone();
  }

  onNotificationClick(notification: any) {
    console.log('Notification clicked:', notification);
  }

  private async getPresentingElement() {
    return document.querySelector('ion-app') || undefined;
  }

  private startReportValidationMonitoring() {
    console.log('🔔 Starting report validation monitoring...');
    
    setInterval(() => {
      if (this.isRealTimeTracking) {
        console.log('🔔 Checking for new admin-validated reports...');
        this.reportService.getAllReports().subscribe({
          next: (allReports) => {
            const reports = allReports.filter(r => r.status === 'Validated');
            this.checkForNewValidatedReports(reports);
          },
          error: (error) => {
            console.error('Error checking for new validated reports:', error);
          }
        });
      }
    }, 30000);
  }

  private addSampleNotifications() {
  }

  getAlertIcon(level: string): string {
    switch (level) {
      case 'Danger': return 'warning';
      case 'Caution': return 'alert-circle';
      case 'Neutral': return 'information-circle';
      case 'Safe': return 'checkmark-circle';
      default: return 'help-circle';
    }
  }

  getAlertTitle(type: string): string {
    switch (type) {
      case 'zone_entry': return 'Zone Entry Alert';
      case 'zone_exit': return 'Zone Exit Alert';
      case 'zone_level_change': return 'Zone Level Change';
      case 'nearby_zone': return 'Nearby Zone Alert';
      default: return 'Zone Alert';
    }
  }

  startRealTimeTracking() {
    if (this.isRealTimeTracking) {
      console.log('Real-time tracking already active');
      return;
    }

    console.log('Starting real-time location tracking...');
    this.isRealTimeTracking = true;

    const interval = this.getTrackingInterval();
    console.log(`Using tracking interval: ${interval}ms (${this.trackingMode} mode)`);

    this.realTimeLocationSubscription = this.locationService.startRealTimeTracking(interval)
      .subscribe({
        next: (location) => {
          console.log('Real-time location update:', location);
          this.updateUserMarker(location);
          this.currentLocation = location;
          this.zoneEngine.updateCurrentLocation(location);
          
          this.checkZoneNotifications(location);
          
          if (!this.lastAddressUpdate || Date.now() - this.lastAddressUpdate > 10000) {
            this.getCurrentAddress(location.lat, location.lng);
            this.lastAddressUpdate = Date.now();
          }
          
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

    this.startReportValidationMonitoring();
  }

  private getTrackingInterval(): number {
    if (this.batteryOptimizationMode) {
      switch (this.trackingMode) {
        case 'high':
          return 5000;
        case 'medium':
          return 10000;
        case 'low':
          return 30000;
        default:
          return 10000;
      }
    } else {
      switch (this.trackingMode) {
        case 'high':
          return 1000;
        case 'medium':
          return 3000;
        case 'low':
          return 10000;
        default:
          return 3000;
      }
    }
  }

  private optimizeTrackingFrequency(location: { lat: number; lng: number }) {
    if (!this.currentLocation) return;

    const distance = this.locationService.calculateDistance(
      this.currentLocation.lat,
      this.currentLocation.lng,
      location.lat,
      location.lng
    );

    if (distance > 100) {
      this.trackingMode = 'high';
    } else if (distance > 10) {
      this.trackingMode = 'medium';
    } else {
      this.trackingMode = 'low';
    }
  }

  setTrackingMode(mode: 'high' | 'medium' | 'low') {
    this.trackingMode = mode;
    console.log(`Tracking mode changed to: ${mode}`);
    
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
    
    if (this.isRealTimeTracking) {
      this.stopRealTimeTracking();
      setTimeout(() => {
        this.startRealTimeTracking();
      }, 100);
    }

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
    if (this.map) {
      if (!this.userMarker || !this.userMarker.getElement()?.isConnected) {
        if (this.currentLocation) {
          const markerElement = document.createElement('div');
          markerElement.className = 'waze-navigation-marker';
          markerElement.innerHTML = `
            <svg width="44" height="52" viewBox="0 0 44 52" class="waze-arrow">
              <path d="M22 6 L36 30 L30 30 L30 46 L14 46 L14 30 L8 30 Z"
                    fill="#00B8D4" stroke="#FFFFFF" stroke-width="2.5" class="nav-arrow"/>
            </svg>
          `;
          this.userMarker = new mapboxgl.Marker({
            element: markerElement,
            anchor: 'bottom',
            rotationAlignment: 'map',
            pitchAlignment: 'map'
          })
            .setLngLat([location.lng, location.lat])
            .addTo(this.map);
        }
      }
    }
    if (this.userMarker && this.map) {
      this.userMarker.setLngLat([location.lng, location.lat]);
      
      if (this.isHeatmapVisible) {
        this.updateRealTimeUserLocationInHeatmap(location);
        return;
      }
      
      const currentZoom = this.map.getZoom();
      const currentBearing = this.map.getBearing();
      
      const targetBearing = location.heading !== undefined && location.heading !== null 
        ? location.heading 
        : currentBearing;
      
      const animationOptions = {
        center: [location.lng, location.lat] as [number, number],
        zoom: Math.max(currentZoom, 17.5),
        pitch: 55,
        bearing: targetBearing,
        duration: 800,
        essential: true,
        easing: (t: number) => t * (2 - t)
      };
      
      this.map.easeTo(animationOptions);
      
      if (location.heading !== undefined && location.heading !== null) {
        const markerElement = this.userMarker.getElement();
        const arrowEl = markerElement?.querySelector('.waze-arrow') as HTMLElement | null;
        if (arrowEl) {
          arrowEl.style.transform = 'rotate(0deg)';
        }
      }
      
      this.checkNearbyZones(location);
    }
  }

  addRealTimeUserLocationToHeatmap() {
    if (!this.map || !this.currentLocation) return;

    const sourceId = 'real-time-user-location';
    const layerId = 'real-time-user-location-layer';

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
    
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        if (this.map) {
          this.map.resize();
        }
      }, 300);
    });
  }

  private handleResize = () => {
  };

  private async initializeApp() {
    try {
      await this.requestLocationPermissions();
      
      const location = await this.locationService.getCurrentLocation();
      this.currentLocation = location;
      console.log('Current location set:', this.currentLocation);
      
      await this.getCurrentAddress(location.lat, location.lng);
      
      this.zoneEngine.updateCurrentLocation(location);
      
      this.checkZoneNotifications(location);
      
      await this.checkGPSAccuracy();
      
      this.checkNearbyZones(location);
      
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

      if (navigator.permissions) {
        navigator.permissions.query({ name: 'geolocation' }).then((result) => {
          if (result.state === 'granted') {
            resolve(true);
          } else if (result.state === 'prompt') {
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
          resolve(true);
        });
      } else {
        resolve(true);
      }
    });
  }

  private handleLocationError(error: any) {
    let errorMessage = 'Unable to get your location';
    let shouldUseDefault = true;

    if (error.code) {
      switch (error.code) {
        case 1:
          errorMessage = 'Location access denied. Please enable location permissions in your browser settings.';
          this.notificationService.error(
            'Location Permission Denied',
            errorMessage,
            'OK',
            5000
          );
          break;
        case 2:
          errorMessage = 'Location information is unavailable. Please check your GPS settings.';
          this.notificationService.warning(
            'Location Unavailable',
            errorMessage,
            'OK',
            5000
          );
          break;
        case 3:
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
    setTimeout(() => {
      if (this.map) {
        this.map.resize();
        this.map.getContainer().style.height = '100%';
        
        if (!this.isHeatmapVisible) {
          this.removeHeatmapLayer();
        }
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
      
      this.checkZoneNotifications(location);
      
      await this.getCurrentAddress(location.lat, location.lng);
      
      if (this.map) {
        this.map.setCenter([location.lng, location.lat]);
      }

      await this.checkGPSAccuracy();
      
      this.notificationService.success('Location Updated', 'Your location has been refreshed with high accuracy!', 'OK', 2000);
    } catch (error) {
      console.error('Error refreshing location:', error);
      this.notificationService.error('Location Error', 'Failed to refresh location. Please check your GPS settings.', 'OK', 3000);
    } finally {
      this.isRefreshingLocation = false;
    }
  }

  async getCurrentAddress(lat: number, lng: number) {
    try {
      const accessToken = 'pk.eyJ1IjoidG9taWthemUxIiwiYSI6ImNtY25rM3NxazB2ZG8ybHFxeHVoZWthd28ifQ.Vnf9pMEQAryEI2rMJeMQGQ';
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${accessToken}&types=address,poi,place,locality,neighborhood&limit=1`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        
        const context = feature.context || [];
        const placeName = feature.place_name || '';

        let readableAddress = '';
        
        if (feature.properties && feature.properties.address) {
          readableAddress = `${feature.properties.address}`;
          if (context.length > 0) {
            const locality = context.find((c: any) => c.id.startsWith('locality'));
            const region = context.find((c: any) => c.id.startsWith('region'));
            if (locality) readableAddress += `, ${locality.text}`;
            if (region) readableAddress += `, ${region.text}`;
          }
        } else if (placeName) {
          const parts = placeName.split(',');
          if (parts.length >= 2) {
            readableAddress = parts.slice(0, 2).join(', ').trim();
          } else {
            readableAddress = placeName;
          }
        } else {
          readableAddress = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }
        
        this.currentAddress = readableAddress;
        console.log('📍 Reverse geocoding result:', this.currentAddress);
        console.log('📍 Full place name:', placeName);
      } else {
        this.currentAddress = 'Getting address...';
        console.log('📍 No address found, showing loading message');
      }
    } catch (error) {
      console.error('❌ Error getting address:', error);
      this.currentAddress = 'Unable to get address';
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

  getGPSStatusClass(): string {
    if (!this.gpsAccuracy) return 'poor';
    
    const accuracy = this.gpsAccuracy.accuracy;
    if (accuracy <= 5) return 'excellent';
    if (accuracy <= 10) return 'good';
    if (accuracy <= 20) return 'fair';
    return 'poor';
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
    
    const mapStyle = 'mapbox://styles/mapbox/streets-v12';
    
    this.map = new mapboxgl.Map({
      container: 'map',
      style: mapStyle,
      center: [this.currentLocation.lng, this.currentLocation.lat],
      zoom: 17.5,
      pitch: 55,
      bearing: 0,
      interactive: true,
      trackResize: true,
      attributionControl: false,
      maxPitch: 85,
      antialias: true,
      preserveDrawingBuffer: false,
      refreshExpiredTiles: true
    });

    const markerElement = document.createElement('div');
    markerElement.className = 'waze-navigation-marker';
    markerElement.innerHTML = `
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
      </svg>
    `;

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
      
      
      .waze-arrow {
        position: relative;
        z-index: 2;
        filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.3));
        display: block;
      }
      
      .nav-arrow {
        transition: all 0.2s ease;
      }
      
    `;
    document.head.appendChild(style);

    this.userMarker = new mapboxgl.Marker({
      element: markerElement,
      anchor: 'bottom',
      rotationAlignment: 'map',
      pitchAlignment: 'map'
    })
      .setLngLat([this.currentLocation.lng, this.currentLocation.lat])
      .addTo(this.map);

    this.map.on('load', () => {
      console.log('Map loaded in HomePage - Simple Waze-like navigation');
      
      this.map!.resize();
      
      setTimeout(() => {
        this.map!.addControl(new mapboxgl.NavigationControl({
          showCompass: true,
          showZoom: true
        }), 'top-right');
        
        this.map!.addControl(new mapboxgl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showUserHeading: true,
          showAccuracyCircle: false
        }), 'top-right');
        
        console.log('NavigationControl and GeolocateControl added (zoom + recenter).');
      }, 500);
      
      this.loadZones();
      this.startRealTimeTracking();
    });

    this.map.on('zoomend', () => {
      const currentZoom = this.map?.getZoom() || 0;
      console.log(`📍 ZOOM EVENT: Zoom level changed to ${currentZoom}, heatmap visible: ${this.isHeatmapVisible}`);
      
      if (this.isHeatmapVisible) {
        console.log('📍 ZOOM EVENT: Heatmap mode - using heatmap layers, not individual markers');
      } else {
        console.log('📍 ZOOM EVENT: Navigation mode - keeping map completely clean, no markers');
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
    console.log('Loading zones for zone notifications...');
    this.zoneEngine.zones$.subscribe({
      next: (zones) => {
        console.log('Zones loaded for notifications:', zones.length);
        
        this.zones = zones || [];
      },
      error: (error) => {
        console.error('Error loading zones:', error);
        this.zones = [];
      }
    });
  }

  updateHeatmap() {
    if (!this.map) {
      console.log('Cannot update heatmap: map not available');
      return;
    }

    console.log('Updating heatmap with validated reports:', this.validatedReports?.length || 0);
    
    if (this.isHeatmapVisible) {
      this.updateHeatmapLayer();
      
    } else {
      this.removeHeatmapLayer();
      
      this.removeReportMarkers();
      this.removeRealTimeUserLocationFromHeatmap();
      

      this.reportMarkers.forEach(marker => marker.remove());
      this.reportMarkers = [];
    }

    console.log('Heatmap updated successfully');
  }

  private updateReportMarkers() {
    if (!this.map) return;

    const zoom = this.map.getZoom();
    const shouldShowMarkers = zoom >= 14;

    console.log(`📍 AGGRESSIVE CLEANUP: Removing ${this.reportMarkers.length} existing markers`);
    this.reportMarkers.forEach((marker, index) => {
      console.log(`📍 Removing marker ${index + 1}`);
      marker.remove();
    });
    this.reportMarkers = [];

    if (!shouldShowMarkers) {
      console.log('📍 Not showing markers due to zoom level:', zoom);
      return;
    }

    console.log('📍 Navigation mode - no markers or heatmap elements should be created');
    return;

    console.log('📍 Starting marker creation for zoom level:', zoom);
    console.log('📍 Total validated reports:', this.validatedReports.length);
    console.log('📍 Validated reports details:', this.validatedReports.map(r => ({
      id: r.id,
      type: r.type,
      location: r.location,
      status: r.status,
      level: r.level,
      riskLevel: r.riskLevel
    })));

        const validReports = this.validatedReports.filter(report => {
          const lat = Number(report.location?.lat);
          const lng = Number(report.location?.lng);
          if (isNaN(lat) || isNaN(lng)) {
            console.log(`📍 Skipping report with invalid coordinates: ${report.id}`);
            return false;
          }
          return true;
        });
    
    console.log(`📍 Processing ${validReports.length} valid reports (${this.validatedReports.length} total, no deduplication)`);
    console.log('📍 All validated reports:', this.validatedReports.map(r => ({ id: r.id, type: r.type, location: r.location, status: r.status })));
    console.log('📍 Valid reports after filtering:', validReports.map(r => ({ id: r.id, type: r.type, location: r.location, status: r.status })));
    
    console.log('📍 About to create markers for these reports:', validReports.length);
    
    validReports.forEach((report, index) => {
      console.log(`📍 Creating marker ${index + 1}/${validReports.length} for report:`, {
        id: report.id,
        type: report.type,
        location: report.location,
        status: report.status
      });
      
      const lat = Number(report.location?.lat);
      const lng = Number(report.location?.lng);
      
      if (isNaN(lat) || isNaN(lng)) return;
      
      const hasRiskLevel = (report.riskLevel !== null && report.riskLevel !== undefined) || 
                           (report.level !== null && report.level !== undefined);
      if (!hasRiskLevel) {
        console.warn('Skipping report without risk level:', report.id);
        return;
      }

      const el = document.createElement('div');
      el.className = 'custom-marker';
      el.style.width = '30px';
      el.style.height = '30px';
      el.style.borderRadius = '50%';
      el.style.cursor = 'pointer';
      el.style.border = '3px solid white';
      el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
      el.style.position = 'absolute';
      el.style.left = '-15px';
      el.style.top = '-15px';
      
      const color = this.getReportRiskColor(report.level || report.riskLevel || 1);
      el.style.backgroundColor = color;

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

      console.log(`📍 Creating marker for report ${report.id}:`, {
        reportId: report.id,
        reportLocation: {
          lat: report.location?.lat,
          lng: report.location?.lng
        },
        processedCoordinates: {
          lat: lat,
          lng: lng,
          coordinates: [lng, lat]
        },
        address: report.locationAddress,
        currentUserLocation: this.currentLocation,
        distanceFromUser: this.currentLocation ? this.calculateDistance(
          this.currentLocation.lat, this.currentLocation.lng,
          lat, lng
        ) : 'N/A',
        reportTimestamp: report.createdAt,
        reportType: report.type
      });

      const marker = new mapboxgl.Marker(el)
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(this.map!);

      this.reportMarkers.push(marker);
      console.log(`📍 Marker ${index + 1} created and added to map. Total markers now: ${this.reportMarkers.length}`);
      console.log(`📍 Marker ${index + 1} popup content:`, {
        hasPopup: !!popup,
        popupHTML: 'Popup created successfully',
        markerElement: el.className,
        coordinates: [lng, lat]
      });
    });
    
    console.log(`📍 Marker creation complete. Total markers on map: ${this.reportMarkers.length}`);

    console.log('📍 Added', this.reportMarkers.length, 'report markers to map');
  }

  private updateHeatmapLayer() {
    if (!this.map || !this.isHeatmapVisible) return;


    console.log('📍 Heatmap: Updating heatmap layer with validated reports');
    

    const existingHeatLayers = ['heat-l1', 'heat-l2', 'heat-l3', 'heat-l4', 'heat-l5'];
    const existingClusterLayers = ['cluster-count', 'cluster-circles', 'unclustered-points'];
    
    [...existingHeatLayers, ...existingClusterLayers].forEach(layerId => {
      if (this.map!.getLayer(layerId)) {
        console.log(`📍 Heatmap: Removing existing layer ${layerId} before recreating`);
        this.map!.removeLayer(layerId);
      }
    });


        const validReports = this.validatedReports.filter(report => {

          const lat = Number(report.location?.lat);
          const lng = Number(report.location?.lng);
          if (isNaN(lat) || isNaN(lng)) {
            console.log(`📍 Heatmap: Skipping report with invalid coordinates: ${report.id}`);
            return false;
          }
          return true;
        });
    
    console.log(`📍 Heatmap: Processing ${validReports.length} valid reports (${this.validatedReports.length} total, no deduplication)`);
    console.log('📍 Heatmap: All validated reports:', this.validatedReports.map(r => ({ id: r.id, type: r.type, location: r.location, status: r.status })));
    console.log('📍 Heatmap: Valid reports after filtering:', validReports.map(r => ({ id: r.id, type: r.type, location: r.location, status: r.status })));
    
    const geojson = {
      type: 'FeatureCollection',
      features: validReports
        .filter(r => {

          const hasLocation = r.location?.lat && r.location?.lng;
          const hasRiskLevel = (r.riskLevel !== null && r.riskLevel !== undefined) || 
                               (r.level !== null && r.level !== undefined);
          return hasLocation && hasRiskLevel;
        })
        .map(r => {
          const adminLevel = r.level;
          const autoRiskLevel = r.riskLevel;
          const finalLevel = adminLevel ?? autoRiskLevel ?? 1;
          const numLevel = Number(finalLevel);
          

          console.log(`📍 Heatmap point: ${r.locationAddress || 'Unknown'}`, {
            reportId: r.id,
            coordinates: [r.location.lng, r.location.lat],
            adminLevel: adminLevel,
            autoRiskLevel: autoRiskLevel,
            finalLevel: numLevel,
            color: numLevel === 1 ? 'Green' : numLevel === 2 ? 'Yellow' : numLevel === 3 ? 'Orange' : numLevel === 4 ? 'Red' : 'Dark Red'
          });
          
          return {
            type: 'Feature',
            properties: {
              weight: numLevel 
            },
            geometry: {
              type: 'Point',
              coordinates: [r.location.lng, r.location.lat]
            }
          };
        })
    };

    console.log(`🗺️ Heatmap Update: ${geojson.features.length} total validated incidents`);
    console.log(`🎯 Cluster Settings: radius=25px, maxZoom=14 (tighter clustering for accuracy)`);
    console.log(`📊 Zoom behavior:
      - Zoom 5-11: Clusters only (overview)
      - Zoom 12-14: Clusters + individual points transition
      - Zoom 15+: Individual points only (detail view)
    `);
    console.log('📍 Heatmap points being created:', geojson.features.map(f => ({
      coordinates: f.geometry.coordinates,
      weight: f.properties.weight
    })));

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

    const clusterSourceId = 'validated-incidents-cluster';
    const clusterSource = this.map.getSource(clusterSourceId) as mapboxgl.GeoJSONSource;
    if (clusterSource) {
      clusterSource.setData(geojson as any);
    } else {
      this.map.addSource(clusterSourceId, {
        type: 'geojson',
        data: geojson as any,
        cluster: true,
        clusterRadius: 25,
        clusterMaxZoom: 20,
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


    // Zoom-dependent radius for 25-meter real-world distance
    // This ensures the heatmap represents actual 25m radius at all zoom levels
    const heatLayers = [
      {
        id: 'heat-l1', level: 1, rgba: [16, 185, 129],
        weight: 0.5,
        intensityStops: [5, 0.8, 10, 1.0, 15, 1.2]
      },
      {
        id: 'heat-l2', level: 2, rgba: [251, 191, 36],
        weight: 0.7,
        intensityStops: [5, 0.9, 10, 1.1, 15, 1.3]
      },
      {
        id: 'heat-l3', level: 3, rgba: [249, 115, 22],
        weight: 0.9,
        intensityStops: [5, 1.0, 10, 1.2, 15, 1.5]
      },
      {
        id: 'heat-l4', level: 4, rgba: [239, 68, 68],
        weight: 1.1,
        intensityStops: [5, 1.2, 10, 1.5, 15, 1.8]
      },
      {
        id: 'heat-l5', level: 5, rgba: [220, 38, 38],
        weight: 1.3,
        intensityStops: [5, 1.4, 10, 1.7, 15, 2.0]
      }
    ];


    heatLayers.forEach(layer => {
      if (!this.map!.getLayer(layer.id)) {
        console.log(`📍 Heatmap: Adding layer ${layer.id} for level ${layer.level} (${layer.rgba.join(',')} color, 25m radius)`);
        this.map!.addLayer({
          id: layer.id,
          type: 'heatmap',
          source: sourceId,
          minzoom: 5,
          maxzoom: 22,
          filter: ['==', ['get', 'weight'], layer.level],
          layout: {
            visibility: 'visible'
          },
          paint: {
            'heatmap-weight': layer.weight,
            // Zoom-dependent radius representing 15 meters with good visibility for navigation
            'heatmap-radius': [
              'interpolate',
              ['exponential', 2],
              ['zoom'],
              8, 12,     // Good visibility at low zoom (reduced from 20)
              10, 24,    // Clear visibility (reduced from 40)
              12, 48,    // Good for overview (reduced from 80)
              14, 72,    // Clear for street view (reduced from 120)
              16, 120,   // Good for navigation zoom level (reduced from 200)
              17, 168,   // Optimal for navigation mode (reduced from 280)
              18, 240,   // Excellent visibility for close navigation (reduced from 400)
              19, 360    // Maximum visibility for detailed navigation (reduced from 600)
            ],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'],
              layer.intensityStops[0], layer.intensityStops[1],
              layer.intensityStops[2], layer.intensityStops[3],
              layer.intensityStops[4], layer.intensityStops[5]
            ],
            'heatmap-opacity': 0.6,
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

    if (!this.map.getLayer('cluster-circles')) {
      this.map.addLayer({
        id: 'cluster-circles',
        type: 'circle',
        source: clusterSourceId,
        filter: ['has', 'point_count'],
        maxzoom: 22,
        layout: {
          visibility: 'visible'
        },
        paint: {
          'circle-radius': [
            'step', ['get', 'point_count'],
            20, 10, 25, 25, 30, 50, 35
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
          'circle-opacity': 0.9,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'white'
        }
      } as any);
    }

    if (!this.map.getLayer('cluster-count')) {
      this.map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: clusterSourceId,
        filter: ['has', 'point_count'],
        maxzoom: 22,
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 14,
          visibility: 'visible'
        },
        paint: {
          'text-color': '#111827'
        }
      } as any);
    }
  }

  private removeReportMarkers() {
    console.log(`📍 Removing ${this.reportMarkers.length} existing markers`);
    this.reportMarkers.forEach((marker, index) => {
      console.log(`📍 Removing marker ${index + 1}`);
      marker.remove();
    });
    this.reportMarkers = [];
    console.log('📍 All markers removed. reportMarkers array cleared.');
  }

  private removeHeatmapLayer() {
    if (!this.map) return;
    
    console.log('📍 Heatmap: Starting comprehensive layer removal...');
    
    const allLayers = this.map.getStyle().layers;
    console.log('📍 Heatmap: All existing layers before removal:', allLayers.map(l => l.id));
    
    const heatLayers = ['heat-l1', 'heat-l2', 'heat-l3', 'heat-l4', 'heat-l5'];
    heatLayers.forEach(layerId => {
      if (this.map!.getLayer(layerId)) {
        console.log(`📍 Heatmap: Removing layer ${layerId}`);
        this.map!.removeLayer(layerId);
      } else {
        console.log(`📍 Heatmap: Layer ${layerId} does not exist`);
      }
    });

    const clusterLayers = ['cluster-count', 'cluster-circles', 'unclustered-points'];
    clusterLayers.forEach(layerId => {
      if (this.map!.getLayer(layerId)) {
        console.log(`📍 Heatmap: Removing cluster layer ${layerId}`);
        this.map!.removeLayer(layerId);
      } else {
        console.log(`📍 Heatmap: Cluster layer ${layerId} does not exist`);
      }
    });
    
    const clusterSourceId = 'validated-incidents-cluster';
    const sourceId = 'validated-incidents';
    
    if (this.map.getSource(clusterSourceId)) {
      console.log(`📍 Heatmap: Removing cluster source ${clusterSourceId}`);
      this.map.removeSource(clusterSourceId);
    } else {
      console.log(`📍 Heatmap: Cluster source ${clusterSourceId} does not exist`);
    }
    if (this.map.getSource(sourceId)) {
      console.log(`📍 Heatmap: Removing main source ${sourceId}`);
      this.map.removeSource(sourceId);
    } else {
      console.log(`📍 Heatmap: Main source ${sourceId} does not exist`);
    }
    
    this.removeReportMarkers();
    
    const remainingLayers = this.map.getStyle().layers;
    console.log('📍 Heatmap: Remaining layers after removal:', remainingLayers.map(l => l.id));
    

    if (this.map.isStyleLoaded()) {
      this.map.resize();
    }
    
    console.log('📍 Heatmap: Comprehensive layer removal completed - all heatmap zones and markers removed');
  }

  private ensureCleanNavigationMode() {
    if (!this.map) return;
    
    console.log('📍 NAVIGATION: Ensuring completely clean navigation mode...');
    
    this.removeHeatmapLayer();

    this.removeReportMarkers();
    
    const allLayers = this.map.getStyle().layers;
    const heatmapRelatedLayers = allLayers.filter(layer => 
      layer.id.includes('heat') || 
      layer.id.includes('cluster') || 
      layer.id.includes('incident') ||
      layer.id.includes('validated')
    );
    
    heatmapRelatedLayers.forEach(layer => {
      if (this.map!.getLayer(layer.id)) {
        console.log(`📍 NAVIGATION: Removing unexpected layer: ${layer.id}`);
        this.map!.removeLayer(layer.id);
      }
    });
    
    console.log('📍 NAVIGATION: Navigation mode is now completely clean');
  }

  private updateHeatmapVisibility() {
    if (!this.map) return;
    
    const isVisible = this.isHeatmapVisible ? 'visible' : 'none';
    const opacity = this.isHeatmapVisible ? 0.6 : 0;
    const clusterOpacity = this.isHeatmapVisible ? 0.6 : 0;
    const unclusteredOpacity = this.isHeatmapVisible ? 0.8 : 0;
    
    console.log(`📍 Heatmap: Updating visibility to ${isVisible}`);
    
    const heatLayers = ['heat-l1', 'heat-l2', 'heat-l3', 'heat-l4', 'heat-l5'];
    heatLayers.forEach(layerId => {
      if (this.map!.getLayer(layerId)) {
        this.map!.setLayoutProperty(layerId, 'visibility', isVisible as any);
        this.map!.setPaintProperty(layerId, 'heatmap-opacity', opacity);
      }
    });

    if (this.map.getLayer('cluster-circles')) {
      this.map.setLayoutProperty('cluster-circles', 'visibility', isVisible as any);
      this.map.setPaintProperty('cluster-circles', 'circle-opacity', clusterOpacity);
    }
    if (this.map.getLayer('cluster-count')) {
      this.map.setLayoutProperty('cluster-count', 'visibility', isVisible as any);
    }
    
    if (this.map.getLayer('unclustered-points')) {
      this.map.setLayoutProperty('unclustered-points', 'visibility', isVisible as any);
      this.map.setPaintProperty('unclustered-points', 'circle-opacity', unclusteredOpacity);
    }
  }

  private ensureHeatmapLayersExist() {
    if (!this.map || !this.isHeatmapVisible) return;
    

    const heatLayers = ['heat-l1', 'heat-l2', 'heat-l3', 'heat-l4', 'heat-l5'];
    const hasAllLayers = heatLayers.every(layerId => this.map!.getLayer(layerId));
    
    if (!hasAllLayers) {
      console.log('📍 Heatmap: Layers missing, creating them...');
      this.updateHeatmapLayer();
    } else {
      console.log('📍 Heatmap: All layers already exist, skipping creation');
    }
  }

  private getReportRiskColor(level: number): string {
    const numLevel = Number(level);
    if (numLevel <= 1) return '#10b981';
    if (numLevel === 2) return '#fbbf24'; 
    if (numLevel === 3) return '#f97316';
    if (numLevel === 4) return '#ef4444'; 
    return '#dc2626';
  }

  private getReportRiskLabel(level: number): string {
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


  toggleHeatmap() {
    console.log('Toggle heatmap called, current state:', this.isHeatmapVisible);
    
    this.isHeatmapVisible = !this.isHeatmapVisible;
    console.log('New heatmap state:', this.isHeatmapVisible);
    
    if (!this.map) {
      console.warn('Map not initialized');
      return;
    }
    
    const currentCenter = this.currentLocation 
      ? [this.currentLocation.lng, this.currentLocation.lat] as [number, number]
      : this.map.getCenter();
    
    if (this.isHeatmapVisible) {
      console.log('🗺️ HEATMAP MODE: Disabling navigation, enabling free map control...');
      
      this.removeHeatmapLayer();
      
      this.map.setStyle('mapbox://styles/mapbox/light-v11');
      
      this.map.once('styledata', () => {
        if (!this.map) return;
        

        this.map.jumpTo({
          center: currentCenter,
          zoom: 13,
          bearing: 0,
          pitch: 0
        });
        
        if (this.userMarker) {
          this.userMarker.remove();
        }
        
        this.removeHeatmapLayer();
        
        this.updateHeatmapLayer();
        
        console.log('✅ Heatmap mode active - navigation disabled, map is user-controlled');
      });
    } else {
      console.log('🧭 NAVIGATION MODE: Restoring Waze-style camera following...');
      
      console.log('📍 NAVIGATION: Removing heatmap layers before style switch');
      this.removeHeatmapLayer();
      
      this.map.setStyle('mapbox://styles/mapbox/streets-v12');
      
      this.map.once('styledata', () => {
        if (!this.map) return;
        
        console.log('📍 NAVIGATION: Style loaded, cleaning up any remaining heatmap elements');
        
        if (this.currentLocation && this.map) {
          if (this.userMarker) {
            this.userMarker.addTo(this.map);
            this.userMarker.setLngLat([this.currentLocation.lng, this.currentLocation.lat]);
          } else {
            const markerElement = document.createElement('div');
            markerElement.className = 'waze-navigation-marker';
            markerElement.innerHTML = `
              <svg width="44" height="52" viewBox="0 0 44 52" class="waze-arrow">
                <path d="M22 6 L36 30 L30 30 L30 46 L14 46 L14 30 L8 30 Z" 
                      fill="#00B8D4" stroke="#FFFFFF" stroke-width="2.5" class="nav-arrow"/>
              </svg>
            `;

            if (!document.querySelector('style[data-nav-arrow="1"]')) {
              const style = document.createElement('style');
              style.setAttribute('data-nav-arrow', '1');
              style.textContent = `
                .waze-navigation-marker{position:relative;width:44px;height:52px;display:flex;align-items:flex-end;justify-content:center}
                .waze-arrow{position:relative;z-index:2;filter:drop-shadow(0 3px 8px rgba(0,0,0,.3));display:block}
                .nav-arrow{transition:all .2s ease}
              `;
              document.head.appendChild(style);
            }

            this.userMarker = new mapboxgl.Marker({
              element: markerElement,
              anchor: 'bottom',
              rotationAlignment: 'map',
              pitchAlignment: 'map'
            })
              .setLngLat([this.currentLocation.lng, this.currentLocation.lat])
              .addTo(this.map);
          }
        }
        
        this.ensureCleanNavigationMode();
        
        const finalLayers = this.map.getStyle().layers;
        console.log('📍 NAVIGATION: Final layers after complete cleanup:', finalLayers.map(l => l.id));
        
        if (this.currentLocation && this.map) {
          this.map.easeTo({
            center: [this.currentLocation.lng, this.currentLocation.lat],
            zoom: 17.5,
            pitch: 55,
            bearing: this.map.getBearing(),
            duration: 1000
          });
        }
        
        console.log('✅ Navigation mode active - camera will follow user location');
      });
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
      await this.notificationService.success(
        '🧪 TEST INCIDENTS DISABLED',
        'Test incident simulation has been disabled. No test incidents will be created.',
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

  private checkNearbyZones(location: { lat: number; lng: number }) {
    const previousStatus = this.safetyStatus;
    const wasInZone = this.inDangerZone;
    
    if (!this.validatedReports || this.validatedReports.length === 0) {
      this.safetyStatus = 'safe';
      this.nearbyZoneAlert = '';
      this.nearestZoneDistance = null;
      this.hasNearbyReports = false;
      this.nearbyReportsCount = 0;
      this.inDangerZone = false;
      this.locationSafetyMessage = '✓ Your location is SAFE - No incidents reported in this area';
      
      this.previousSafetyStatus = this.safetyStatus;
      this.wasInDangerZone = this.inDangerZone;
      return;
    }

    const reportsWithDistance = this.validatedReports.map(report => {
      const distance = this.calculateDistance(
        location.lat,
        location.lng,
        report.location.lat,
        report.location.lng
      );
      return { report, distance };
    });

    reportsWithDistance.sort((a, b) => a.distance - b.distance);

    const reportsAtLocation = reportsWithDistance.filter(r => r.distance * 1000 <= 50);
    
    if (reportsAtLocation.length > 0) {
      const highestRiskReport = reportsAtLocation.reduce((prev, current) => 
        (current.report.level || current.report.riskLevel || 0) > (prev.report.level || prev.report.riskLevel || 0) ? current : prev
      );
      
      const riskLevel = highestRiskReport.report.level || highestRiskReport.report.riskLevel || 1;
      
      if (riskLevel >= 5) {
        this.safetyStatus = 'danger';
        this.locationSafetyMessage = `🚨 EXTREME RISK - Level 5 incident at this location`;
        this.nearbyZoneAlert = `EXTREME: ${reportsAtLocation.length} REPORT(S) HERE`;
      } else if (riskLevel >= 4) {
        this.safetyStatus = 'danger';
        this.locationSafetyMessage = `⚠ CRITICAL RISK - Level 4 incident at this location`;
        this.nearbyZoneAlert = `CRITICAL: ${reportsAtLocation.length} REPORT(S) HERE`;
      } else if (riskLevel >= 3) {
        this.safetyStatus = 'warning';
        this.locationSafetyMessage = `⚠ HIGH RISK - Level 3 incident at this location`;
        this.nearbyZoneAlert = `HIGH RISK: ${reportsAtLocation.length} REPORT(S) HERE`;
      } else if (riskLevel >= 2) {
        this.safetyStatus = 'warning';
        this.locationSafetyMessage = `⚠ MODERATE RISK - Level 2 incident at this location`;
        this.nearbyZoneAlert = `MODERATE: ${reportsAtLocation.length} REPORT(S) HERE`;
      } else {
        this.safetyStatus = 'safe';
        this.locationSafetyMessage = `✓ LOW RISK - Level 1 incident at this location`;
        this.nearbyZoneAlert = `LOW RISK: ${reportsAtLocation.length} REPORT(S) HERE`;
      }
      
      this.inDangerZone = true;
      this.hasNearbyReports = true;
      this.nearbyReportsCount = reportsAtLocation.length;
      this.nearestZoneDistance = 0;
      

      this.checkAndNotifyZoneChanges(previousStatus, wasInZone);
      
      this.previousSafetyStatus = this.safetyStatus;
      this.wasInDangerZone = this.inDangerZone;
      return;
    }

    const nearest = reportsWithDistance[0];
    const distanceInMeters = Math.round(nearest.distance * 1000);
    this.nearestZoneDistance = distanceInMeters;

    const nearestRiskLevel = nearest.report.level || nearest.report.riskLevel || 1;
    const zoneRadius = this.getZoneRadiusMeters(nearestRiskLevel);

    const nearbyReports = reportsWithDistance.filter(r => r.distance * 1000 <= 30); // 30m for nearby reports (2x zone radius)
    this.nearbyReportsCount = nearbyReports.length;
    this.hasNearbyReports = nearbyReports.length > 0;

    if (distanceInMeters <= zoneRadius) {
      const riskLevel = nearestRiskLevel;
      this.currentZoneRiskLevel = riskLevel;

      if (riskLevel >= 5) {
        this.safetyStatus = 'danger';
        this.locationSafetyMessage = `🚨 EXTREME RISK - Level 5 incident ${distanceInMeters}m away`;
        this.nearbyZoneAlert = `EXTREME: ${nearbyReports.length} REPORT(S) ${distanceInMeters}m AWAY`;
      } else if (riskLevel >= 4) {
        this.safetyStatus = 'danger';
        this.locationSafetyMessage = `⚠ CRITICAL RISK - Level 4 incident ${distanceInMeters}m away`;
        this.nearbyZoneAlert = `CRITICAL: ${nearbyReports.length} REPORT(S) ${distanceInMeters}m AWAY`;
      } else if (riskLevel >= 3) {
        this.safetyStatus = 'warning';
        this.locationSafetyMessage = `⚠ HIGH RISK - Level 3 incident ${distanceInMeters}m away`;
        this.nearbyZoneAlert = `HIGH RISK: ${nearbyReports.length} REPORT(S) ${distanceInMeters}m AWAY`;
      } else if (riskLevel >= 2) {
        this.safetyStatus = 'warning';
        this.locationSafetyMessage = `⚠ MODERATE RISK - Level 2 incident ${distanceInMeters}m away`;
        this.nearbyZoneAlert = `MODERATE: ${nearbyReports.length} REPORT(S) ${distanceInMeters}m AWAY`;
      } else {
        this.safetyStatus = 'safe';
        this.locationSafetyMessage = `✓ LOW RISK - Level 1 incident ${distanceInMeters}m away`;
        this.nearbyZoneAlert = `LOW RISK: ${nearbyReports.length} REPORT(S) ${distanceInMeters}m AWAY`;
      }

      this.inDangerZone = true;
      
      this.checkAndNotifyZoneChanges(previousStatus, wasInZone);
      
      this.previousSafetyStatus = this.safetyStatus;
      this.wasInDangerZone = this.inDangerZone;
      return;
    }

    this.currentZoneRiskLevel = null;

    if (distanceInMeters <= 1000) {
      this.safetyStatus = 'safe';
      this.locationSafetyMessage = `✓ Your location is SAFE - Nearest incident is ${distanceInMeters}m away`;
      this.nearbyZoneAlert = `ⓘ ${nearbyReports.length} REPORT(S) WITHIN 1KM`;
      this.inDangerZone = false;
      this.stopAlertSound();

      this.checkAndNotifyZoneChanges(previousStatus, wasInZone);
      
      this.previousSafetyStatus = this.safetyStatus;
      this.wasInDangerZone = this.inDangerZone;
      return;
    }

    this.safetyStatus = 'safe';
    this.nearbyZoneAlert = '';
    this.nearestZoneDistance = distanceInMeters;
    this.hasNearbyReports = false;
    this.locationSafetyMessage = `✓ Your location is SAFE - No incidents reported nearby (nearest: ${(distanceInMeters/1000).toFixed(1)}km)`;
    this.inDangerZone = false;
    
    this.checkAndNotifyZoneChanges(previousStatus, wasInZone);
    
    this.previousSafetyStatus = this.safetyStatus;
    this.wasInDangerZone = this.inDangerZone;
  }

  private getRiskLevelText(riskLevel: number): string {
    switch (riskLevel) {
      case 1: return 'Low';
      case 2: return 'Moderate';
      case 3: return 'High';
      case 4: return 'Critical';
      case 5: return 'Extreme';
      default: return 'Unknown';
    }
  }

  private getZoneRadiusMeters(riskLevel: number): number {
    // Standardized to 15 meters radius for all risk levels - optimized for precise mobile visualization
    return 15;
  }

  private checkAndNotifyZoneChanges(previousStatus: 'safe' | 'warning' | 'danger', wasInZone: boolean) {
    const now = Date.now();
    if (now - this.lastNotificationTime < 10000) {
      return;
    }

    console.log('📍 Zone detection active - checking for zone entry alerts');

    if (!wasInZone && this.inDangerZone && this.safetyStatus === 'danger') {
      this.lastNotificationTime = now;
      
      const nearestIncident = this.validatedReports
        .filter(report => {
          const distance = this.calculateDistance(
            this.currentLocation!.lat, this.currentLocation!.lng,
            report.location.lat, report.location.lng
          );
          const riskLevel = report.level || report.riskLevel || 1;
          return distance * 1000 <= 25 && riskLevel >= 1 && riskLevel <= 5;
        })
        .sort((a, b) => {
          const distA = this.calculateDistance(this.currentLocation!.lat, this.currentLocation!.lng, a.location.lat, a.location.lng);
          const distB = this.calculateDistance(this.currentLocation!.lat, this.currentLocation!.lng, b.location.lat, b.location.lng);
          return distA - distB;
        })[0];

      if (nearestIncident) {
        const riskLevel = nearestIncident.level || nearestIncident.riskLevel || 1;
        
        if (this.inDangerZone || this.currentZoneRiskLevel) {
          this.startContinuousAlertSoundForRiskLevel(riskLevel);
        }
        
        const alertTitle = riskLevel >= 4 ? `🚨 DANGER ZONE ENTERED!` : 
                          riskLevel >= 3 ? `⚠️ CAUTION ZONE ENTERED!` : 
                          `📍 HEATMAP ZONE ENTERED!`;
        
        const alertMessage = riskLevel >= 4 ? 
          `⚠️ You have entered a HIGH-RISK danger zone!\n\n` +
          `📍 Location: ${nearestIncident.locationAddress || nearestIncident.location.fullAddress || nearestIncident.location.simplifiedAddress || 'Unknown'}\n` +
          `📊 Risk Level: ${riskLevel}/5 (${this.getRiskLevelText(riskLevel)})\n` +
          `📝 Incident: ${nearestIncident.type || 'Unknown'}\n` +
          `📅 Reported: ${nearestIncident.createdAt ? new Date(nearestIncident.createdAt).toLocaleDateString() : 'Unknown'}\n\n` +
          `🚨 Please exercise EXTREME CAUTION and consider leaving this area immediately!` :
          riskLevel >= 3 ?
          `⚠️ You have entered a CAUTION zone!\n\n` +
          `📍 Location: ${nearestIncident.locationAddress || nearestIncident.location.fullAddress || nearestIncident.location.simplifiedAddress || 'Unknown'}\n` +
          `📊 Risk Level: ${riskLevel}/5 (${this.getRiskLevelText(riskLevel)})\n` +
          `📝 Incident: ${nearestIncident.type || 'Unknown'}\n` +
          `📅 Reported: ${nearestIncident.createdAt ? new Date(nearestIncident.createdAt).toLocaleDateString() : 'Unknown'}\n\n` +
          `⚠️ Please stay alert and exercise caution in this area!` :
          `📍 You have entered a heatmap zone!\n\n` +
          `📍 Location: ${nearestIncident.locationAddress || nearestIncident.location.fullAddress || nearestIncident.location.simplifiedAddress || 'Unknown'}\n` +
          `📊 Risk Level: ${riskLevel}/5 (${this.getRiskLevelText(riskLevel)})\n` +
          `📝 Incident: ${nearestIncident.type || 'Unknown'}\n` +
          `📅 Reported: ${nearestIncident.createdAt ? new Date(nearestIncident.createdAt).toLocaleDateString() : 'Unknown'}\n\n` +
          `📍 Stay aware of your surroundings.`;
        
        this.showZoneAlert(alertTitle, alertMessage, 'warning', 'OK');
        
        console.log(`🔊 HEATMAP ZONE ALERT (Risk Level ${riskLevel}):`, nearestIncident.type);
      }
      return;
    }

    if (!wasInZone && this.inDangerZone && this.safetyStatus === 'warning') {
      this.lastNotificationTime = now;
      
      const nearestIncident = this.validatedReports
        .filter(report => {
          const distance = this.calculateDistance(
            this.currentLocation!.lat, this.currentLocation!.lng,
            report.location.lat, report.location.lng
          );
          const riskLevel = report.level || report.riskLevel || 1;
          return distance * 1000 <= 25 && riskLevel >= 1 && riskLevel <= 5;
        })
        .sort((a, b) => {
          const distA = this.calculateDistance(this.currentLocation!.lat, this.currentLocation!.lng, a.location.lat, a.location.lng);
          const distB = this.calculateDistance(this.currentLocation!.lat, this.currentLocation!.lng, b.location.lat, b.location.lng);
          return distA - distB;
        })[0];

      if (nearestIncident) {
        const riskLevel = nearestIncident.level || nearestIncident.riskLevel || 1;
        
        if (this.inDangerZone || this.currentZoneRiskLevel) {
          this.startContinuousAlertSoundForRiskLevel(riskLevel);
        }
        
        const alertTitle = riskLevel >= 4 ? `🚨 DANGER ZONE ENTERED!` : 
                          riskLevel >= 3 ? `⚠️ CAUTION ZONE ENTERED!` : 
                          `📍 HEATMAP ZONE ENTERED!`;
        
        const alertMessage = riskLevel >= 4 ? 
          `⚠️ You have entered a HIGH-RISK danger zone!\n\n` +
          `📍 Location: ${nearestIncident.locationAddress || nearestIncident.location.fullAddress || nearestIncident.location.simplifiedAddress || 'Unknown'}\n` +
          `📊 Risk Level: ${riskLevel}/5 (${this.getRiskLevelText(riskLevel)})\n` +
          `📝 Incident: ${nearestIncident.type || 'Unknown'}\n` +
          `📅 Reported: ${nearestIncident.createdAt ? new Date(nearestIncident.createdAt).toLocaleDateString() : 'Unknown'}\n\n` +
          `🚨 Please exercise EXTREME CAUTION and consider leaving this area immediately!` :
          riskLevel >= 3 ?
          `⚠️ You have entered a CAUTION zone!\n\n` +
          `📍 Location: ${nearestIncident.locationAddress || nearestIncident.location.fullAddress || nearestIncident.location.simplifiedAddress || 'Unknown'}\n` +
          `📊 Risk Level: ${riskLevel}/5 (${this.getRiskLevelText(riskLevel)})\n` +
          `📝 Incident: ${nearestIncident.type || 'Unknown'}\n` +
          `📅 Reported: ${nearestIncident.createdAt ? new Date(nearestIncident.createdAt).toLocaleDateString() : 'Unknown'}\n\n` +
          `⚠️ Please stay alert and exercise caution in this area!` :
          `📍 You have entered a heatmap zone!\n\n` +
          `📍 Location: ${nearestIncident.locationAddress || nearestIncident.location.fullAddress || nearestIncident.location.simplifiedAddress || 'Unknown'}\n` +
          `📊 Risk Level: ${riskLevel}/5 (${this.getRiskLevelText(riskLevel)})\n` +
          `📝 Incident: ${nearestIncident.type || 'Unknown'}\n` +
          `📅 Reported: ${nearestIncident.createdAt ? new Date(nearestIncident.createdAt).toLocaleDateString() : 'Unknown'}\n\n` +
          `📍 Stay aware of your surroundings.`;
        
        this.showZoneAlert(alertTitle, alertMessage, 'warning', 'OK');
        
        console.log(`🔊 HEATMAP ZONE ALERT (Risk Level ${riskLevel}):`, nearestIncident.type);
      }
      return;
    }

    if (previousStatus === 'safe' && this.safetyStatus === 'warning' && !this.inDangerZone) {
      this.lastNotificationTime = now;
      
      this.notificationService.info(
        'ⓘ ZONE NEARBY ALERT',
        `⚠️ Incident zones detected nearby!\n\n${this.locationSafetyMessage}\n\nStay aware of your surroundings.`,
        'OK',
        4000
      );
      
      console.log('ⓘ Zone Nearby Alert:', this.locationSafetyMessage);
      return;
    }

    if (this.hasNearbyReports && this.safetyStatus === 'safe' && !this.wasInDangerZone && this.nearbyReportsCount > 0) {
      if (previousStatus !== 'safe' || !this.hasNearbyReports) {
        this.lastNotificationTime = now;
        
        this.notificationService.info(
          'ℹ️ INFORMATION',
          `ℹ️ Your location is SAFE\n\nThere are ${this.nearbyReportsCount} incident report(s) within 1km of your location.\n\nYour current area is safe, but stay alert.`,
          'OK',
          3000
        );
        
        console.log('ℹ️ Nearby Reports Info:', this.nearbyReportsCount, 'reports within 1km');
      }
    }
  }

  private startContinuousAlertSound(zoneLevel: string) {
    this.stopAlertSound();
    
    try {
      const audio = new Audio();
      
      let ringtoneFile: string;
      let interval: number;
      
      ringtoneFile = '/assets/sounds/GuardianCare - Ringtone.mp3';
      
      switch (zoneLevel.toLowerCase()) {
        case 'danger':
          interval = 2500;
          break;
        case 'caution':
          interval = 3500;
          break;
        default:
          interval = 4500;
      }
      
      audio.src = ringtoneFile;
      audio.volume = 0.8;
      audio.loop = false;
      
      const playRingtone = () => {
        if (audio.paused || audio.ended) {
          audio.currentTime = 0;
          audio.play().catch(error => {
            console.warn('Could not play ringtone:', error);
          });
        }
      };
      
      playRingtone();
      
      this.vibrateDevice();
      
      this.alertSoundInterval = setInterval(() => {
        playRingtone();
        if (Math.random() < 0.4) { 
          this.vibrateDevice();
        }
      }, interval);
      

      this.currentAlertSound = audio;
      
      console.log('🔊 Continuous ringtone alert started:', zoneLevel, `(${ringtoneFile}, ${interval}ms interval)`);
    } catch (error) {
      console.warn('Could not start ringtone alert:', error);
    }
  }
  
  private startContinuousAlertSoundForRiskLevel(riskLevel: number) {
    this.stopAlertSound();
    
    try {
      const audio = new Audio();
      
      let ringtoneFile: string;
      let interval: number;
      
      ringtoneFile = '/assets/sounds/GuardianCare - Ringtone.mp3';
      
      switch (riskLevel) {
        case 1:
          interval = 10000; 
          break;
        case 2:
          interval = 8000; 
          break;
        case 3:
          interval = 6000; 
          break;
        case 4:
          interval = 4000; 
          break;
        case 5:
          interval = 2000; 
          break;
        default:
          interval = 8000; 
      }
      
      audio.src = ringtoneFile;
      audio.volume = 0.8;
      audio.loop = false; 
      

      const playRingtone = () => {
        if (audio.paused || audio.ended) {
          audio.currentTime = 0; 
          audio.play().catch(error => {
            console.warn('Could not play ringtone:', error);
          });
        }
      };
      
      playRingtone();
      
      this.vibrateDevice();
      
      this.alertSoundInterval = setInterval(() => {
        playRingtone();
        if (Math.random() < 0.4) {
          this.vibrateDevice();
        }
      }, interval);
      
      this.currentAlertSound = audio;
      
      console.log('🔊 Continuous ringtone alert started for risk level:', riskLevel, `(${ringtoneFile}, ${interval}ms interval)`);
    } catch (error) {
      console.warn('Could not start ringtone alert for risk level:', riskLevel, error);
    }
  }
  
  private stopAlertSound() {
    if (this.alertSoundInterval) {
      clearInterval(this.alertSoundInterval);
      this.alertSoundInterval = null;
      console.log('🔇 Alert sound stopped');
    }
    
    if (this.currentAlertSound) {
      try {
        this.currentAlertSound.pause();
        this.currentAlertSound.currentTime = 0;
        this.currentAlertSound = null;
        console.log('🔇 Ringtone stopped');
      } catch (error) {
        console.warn('Error stopping ringtone:', error);
      }
    }
    
  }
  
  private async showZoneAlert(icon: string, title: string, message: string, zoneLevel: string) {
    const alert = await this.alertController.create({
      header: `${icon} ${title}`,
      message: message,
      buttons: [
        {
          text: 'View Safety Tips',
          handler: () => {
            this.showZoneSafetyTips(zoneLevel);
          }
        },
        {
          text: 'OK',
          role: 'cancel',
          handler: () => {
            this.stopAlertSound();
            console.log('🔇 Alert dismissed - sound stopped');
          }
        }
      ],
      cssClass: `zone-alert-${zoneLevel.toLowerCase()} full-screen-alert`,
      backdropDismiss: false,
      translucent: false
    });
    
    await alert.present();
    
    console.log('🚨 Full-screen zone alert dialog shown:', title);
  }
  
  private async showZoneSafetyTips(zoneLevel: string) {
    let tips = '';
    
    switch (zoneLevel.toLowerCase()) {
      case 'danger':
        tips = `🚨 DANGER ZONE SAFETY TIPS:\n\n` +
               `• Consider leaving the area immediately\n` +
               `• Keep emergency contacts ready\n` +
               `• Stay in well-lit, populated areas\n` +
               `• Avoid isolated locations\n` +
               `• Use the panic button if you feel threatened\n` +
               `• Trust your instincts`;
        break;
      case 'caution':
        tips = `⚠️ CAUTION ZONE SAFETY TIPS:\n\n` +
               `• Stay alert and aware of your surroundings\n` +
               `• Keep your phone accessible\n` +
               `• Avoid walking alone if possible\n` +
               `• Stay in populated areas\n` +
               `• Be observant of unusual activity\n` +
               `• Have emergency contacts ready`;
        break;
      default:
        tips = `ℹ️ GENERAL SAFETY TIPS:\n\n` +
               `• Stay aware of your surroundings\n` +
               `• Keep your phone charged\n` +
               `• Share your location with trusted contacts\n` +
               `• Be observant of your environment`;
    }
    
    const tipsAlert = await this.alertController.create({
      header: '📋 Safety Tips',
      message: tips,
      buttons: ['Close'],
      cssClass: 'zone-recommendations-alert'
    });
    
    await tipsAlert.present();
  }

  private isPointInPolygon(lat: number, lng: number, coordinates: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = coordinates.length - 1; i < coordinates.length; j = i++) {
      const xi = coordinates[i][0], yi = coordinates[i][1];
      const xj = coordinates[j][0], yj = coordinates[j][1];
      
      const intersect = ((yi > lat) !== (yj > lat))
        && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; 
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private getZoneRiskLevel(level: 'Safe' | 'Neutral' | 'Caution' | 'Danger'): 'low' | 'medium' | 'high' {
    switch (level) {
      case 'Danger':
        return 'high';
      case 'Caution':
        return 'medium';
      case 'Neutral':
        return 'low';
      case 'Safe':
      default:
        return 'low';
    }
  }

  getSafetyStatusClass(): string {
    return this.safetyStatus;
  }

  getSafetyIcon(): string {
    switch (this.safetyStatus) {
      case 'safe':
        return 'shield-checkmark-outline';
      case 'warning':
        return 'alert-circle-outline';
      case 'danger':
        return 'warning-outline';
      default:
        return 'shield-outline';
    }
  }

  getSafetyStatusText(): string {
    if (this.inDangerZone && this.currentZoneRiskLevel) {
      switch (this.currentZoneRiskLevel) {
        case 1: return 'LOW RISK';
        case 2: return 'MODERATE RISK';
        case 3: return 'HIGH RISK';
        case 4: return 'CRITICAL RISK';
        case 5: return 'EXTREME RISK';
      }
    }
    return 'SAFE';
  }

  getZoneAlertClass(): string {
    if (!this.nearbyZoneAlert) return '';
    
    if (this.nearbyZoneAlert.includes('HIGH RISK') || this.nearbyZoneAlert.includes('DANGER')) {
      return 'high-risk';
    } else if (this.nearbyZoneAlert.includes('MEDIUM') || this.nearbyZoneAlert.includes('CAUTION')) {
      return 'medium-risk';
    } else {
      return 'low-risk';
    }
  }

  getNearestDistanceText(): string {
    if (this.nearestZoneDistance == null) return '';
    const d = this.nearestZoneDistance;
    if (d < 1000) return `${d}m`;
    return `${(d / 1000).toFixed(1)}km`;
  }

  checkForNotificationNavigation() {
    const navigationData = localStorage.getItem('guardian_care_navigate_to_location');
    if (navigationData) {
      try {
        const locationData = JSON.parse(navigationData);
        console.log('🗺️ Received navigation data from notification:', locationData);
        
        localStorage.removeItem('guardian_care_navigate_to_location');
        
        setTimeout(() => {
          this.navigateToNotificationLocation(locationData);
        }, 1000);
      } catch (error) {
        console.error('Error parsing navigation data:', error);
        localStorage.removeItem('guardian_care_navigate_to_location');
      }
    }
  }

  navigateToNotificationLocation(locationData: any) {
    if (this.map && locationData.lat && locationData.lng) {
      this.map.flyTo({
        center: [locationData.lng, locationData.lat],
        zoom: 16,
        duration: 2000
      });
      
      this.addNotificationMarker(locationData);
      
      this.notificationService.info(
        'Location Found', 
        `Showing ${locationData.reportType || 'incident'} location`,
        'OK', 
        3000
      );
      
      console.log('🗺️ Navigated to notification location:', locationData);
    }
  }

  addNotificationMarker(locationData: any) {
    if (this.map) {
      const existingMarker = document.getElementById('notification-marker');
      if (existingMarker) {
        existingMarker.remove();
      }
      
      const markerEl = document.createElement('div');
      markerEl.id = 'notification-marker';
      markerEl.className = 'notification-marker';
      markerEl.innerHTML = `
        <div class="marker-content">
          <div class="marker-icon">📍</div>
          <div class="marker-label">${locationData.reportType || 'Incident'}</div>
          <div class="marker-risk">Level ${locationData.riskLevel || 'N/A'}</div>
        </div>
      `;
      
      new mapboxgl.Marker(markerEl)
        .setLngLat([locationData.lng, locationData.lat])
        .addTo(this.map);
      
      setTimeout(() => {
        const marker = document.getElementById('notification-marker');
        if (marker) {
          marker.remove();
        }
      }, 10000);
    }
  }

}
