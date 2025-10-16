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
  reportMarkers: mapboxgl.Marker[] = []; // For individual report markers
  validatedReports: any[] = []; // Store validated reports directly
  isHeatmapVisible = false;
  isPanicActive = false;
  inDangerZone = false;
  currentLanguage = 'en';
  gpsAccuracy: { accuracy: number; status: string } | null = null;
  isRefreshingLocation = false;
  currentAddress: string = '';
  private lastAddressUpdate: number = 0;
  
  // Safety and zone alert properties
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
  // Track current risk level when inside a heatmap zone (1-5). Null when safe/outside
  private currentZoneRiskLevel: number | null = null;
  // Quick Actions Sheet properties
  isQuickActionsOpen = false;
  private touchStartY = 0;
  private touchCurrentY = 0;
  private isDragging = false;
  private sheetHeight = 0;
  private isMouseDown = false;;
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
  
  // Zone notification properties
  activeZoneAlerts: ZoneAlert[] = [];
  currentZoneInfo: DangerZone | null = null;
  private reportsLoaded = false; // Guard to prevent multiple report loading
  private lastKnownReports: Set<string> = new Set(); // Track known reports for new report detection
  
  // Alert sound properties
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
    // Ensure content starts at the top whenever this tab becomes active
    this.content?.scrollToTop(0);
    this.zoneEngine.initializeZones();
    
    // Check for navigation from notifications
    this.checkForNotificationNavigation();
    
    // Clear all notification banners on successful login
    this.notificationService.dismissAll();
    
    // CRITICAL FIX: Reset heatmap visibility state FIRST to ensure clean initialization
    this.isHeatmapVisible = false;
    
    // CRITICAL FIX: Ensure completely clean state - remove ALL existing markers and heatmap layers
    this.removeReportMarkers();
    this.removeHeatmapLayer();
    
    // CRITICAL FIX: Force cleanup of any remaining visual elements
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
    this.stopAlertSound(); // Stop any playing alert sounds
    this.reportsLoaded = false; // Reset guard for next load
    // Remove report markers
    this.reportMarkers.forEach(marker => marker.remove());
    this.reportMarkers = [];
    if (this.map) {
      this.map.remove();
    }
    // Remove resize listener
    window.removeEventListener('resize', this.handleResize);
  }

  // Zone Notification Methods
  private initializeZoneNotifications() {
    // Zone notification service disabled - using main zone detection logic only
    // this.subscriptions.push(
    //   this.zoneNotificationService.activeAlerts$.subscribe(alerts => {
    //     this.activeZoneAlerts = alerts;
    //     
    //     // Trigger notifications for new alerts
    //     alerts.forEach(alert => {
    //       this.triggerZoneNotification(alert);
    //     });
    //   })
    // );

    // Request notification permissions
    this.requestNotificationPermissions();
  }

  // Load validated reports directly from report service
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
          // Filter only validated reports (same as admin approach)
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
          
          // On first load after sign-in, initialize baseline and DO NOT notify
          if (!this.reportsLoaded) {
            const definedIds = reports.map(r => r.id).filter((id: any) => typeof id === 'string') as string[];
            this.lastKnownReports = new Set(definedIds);
            this.reportsLoaded = true;
          } else {
            // Check for new admin-validated reports and trigger notifications
            this.checkForNewValidatedReports(reports);
            
            // Trigger notification for new reports in user's area
            this.checkForNearbyNewReports(reports);
          }
          
          // Store the original reports with their exact locations
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
            level: report.level, // Admin validation level
            createdAt: report.createdAt,
            status: report.status,
            reporterName: report.reporterName,
            reporterEmail: report.reporterEmail,
            emergencyContact: report.emergencyContact,
            media: report.media,
            anonymous: report.anonymous
          }));
          
          // Update markers and heatmap with the original report locations
          if (this.isHeatmapVisible) {
            // When heatmap is visible, only update heatmap layers, not individual markers
            this.updateHeatmapLayer();
          } else {
            // When heatmap is NOT visible, ensure no markers are shown and heatmap is completely removed
            this.removeReportMarkers();
            // CRITICAL FIX: Completely remove heatmap layers when not visible
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
    // Zone notification service disabled - using main zone detection logic only
    // this.zoneNotificationService.checkZoneEntry(location);
    // this.zoneNotificationService.checkZoneLevelChanges();
  }

  // Public method to dismiss zone alerts
  dismissZoneAlert(alertId: string) {
    this.zoneNotificationService.dismissAlert(alertId);
  }

  // Trigger notification for zone alerts
  private triggerZoneNotification(alert: ZoneAlert) {
    // Trigger sound notifications for all zone levels (risk levels 1, 2, 3, 4, 5)
    const priority = this.getNotificationPriority(alert.zoneLevel);
    const title = this.getAlertTitle(alert.type);
    
    this.notificationManager.addSafetyNotification(
      title,
      alert.message,
      priority
    );
    
    // Show 5-second notification toast when entering a zone
    if (alert.type === 'zone_entry') {
      this.showZoneEntryNotification(alert);
      this.showZoneEntryAlert(alert);
    }
  }
  
  // Show 5-second notification when entering a zone
  private showZoneEntryNotification(alert: ZoneAlert) {
    const notificationType = this.getNotificationType(alert.zoneLevel);
    const emoji = this.getZoneEmoji(alert.zoneLevel);
    
    this.notificationService.show({
      type: notificationType,
      title: `${emoji} Zone Alert`,
      message: `You've entered ${alert.zoneName} (${alert.zoneLevel} zone)`,
      actionText: 'OK',
      duration: 5000 // 5 seconds
    });
  }
  
  // Show alert dialog when entering a zone
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
  
  // Show zone recommendations in a separate alert
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
  
  // Get emoji based on zone level
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
  
  // Get alert message based on zone level
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
  
  // Get notification type based on zone level
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

  // Get notification priority based on zone level
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

  // Check for new admin-validated reports and trigger detailed notifications
  private checkForNewValidatedReports(reports: any[]) {
    const currentReportIds = new Set(reports.map(r => r.id));
    
    // Find new reports that weren't in our last known set
    const newReports = reports.filter(report => 
      !this.lastKnownReports.has(report.id) && 
      report.status === 'validated'
    );

    console.log(`🔔 Checking for new validated reports: ${newReports.length} new reports found`);

    newReports.forEach(report => {
      if (report.status === 'validated') {
        // Calculate distance from user if location is available
        let distanceFromUser: number | undefined;
        if (this.currentLocation && report.location?.lat && report.location?.lng) {
          distanceFromUser = this.calculateDistance(
            this.currentLocation.lat,
            this.currentLocation.lng,
            report.location.lat,
            report.location.lng
          );
        }

        // Check if the new report is in user's immediate vicinity (within 500m)
        if (distanceFromUser && distanceFromUser <= 500) {
          // This is a NEW report near the user - trigger full alert with sound
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
          
          // Start continuous alert sound for NEW incidents using specific risk level
          // Play sound for all risk levels (1, 2, 3, 4, 5)
          if (this.inDangerZone || this.currentZoneRiskLevel) {
            this.startContinuousAlertSoundForRiskLevel(riskLevel);
          }
          
          // Show full-screen alert dialog
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
          // Report is far away - just show regular notification
          this.notificationManager.addAdminValidatedReportNotification({
            type: report.type,
            locationAddress: report.locationAddress || report.location?.fullAddress || report.location?.simplifiedAddress || 'Unknown Location',
            riskLevel: report.riskLevel || report.level || 1,
            validatedAt: new Date(report.createdAt || Date.now()),
            distanceFromUser: distanceFromUser
          });
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

    // Update our known reports set
    this.lastKnownReports = currentReportIds;
  }

  // Check for new reports in user's vicinity
  private checkForNearbyNewReports(newReports: any[]) {
    if (!this.currentLocation) return;

    const userLat = this.currentLocation.lat;
    const userLng = this.currentLocation.lng;
    const nearbyRadius = 1000; // 1km radius

    newReports.forEach(report => {
      if (report.location?.lat && report.location?.lng) {
        const distance = this.calculateDistance(
          userLat, userLng,
          report.location.lat, report.location.lng
        );

        if (distance <= nearbyRadius) {
          const priority = this.getReportNotificationPriority(report.riskLevel || report.level);
          
          this.notificationManager.addLocationNotification(
            'New Incident Nearby',
            `${report.type} reported ${Math.round(distance)}m away`,
            priority
          );
        }
      }
    });
  }

  // Get notification priority based on report risk level
  private getReportNotificationPriority(riskLevel: any): 'low' | 'medium' | 'high' {
    if (!riskLevel) return 'medium';
    
    const level = typeof riskLevel === 'number' ? riskLevel : parseInt(riskLevel);
    
    if (level >= 4) return 'high';
    if (level >= 2) return 'medium';
    return 'low';
  }


  // Get current zone information
  getCurrentZoneInfo(): DangerZone | null {
    return this.zoneNotificationService.getCurrentZone();
  }

  // Casual Notification Methods
  onNotificationClick(notification: any) {
    console.log('Notification clicked:', notification);
    // Mark as read is handled by the component
    // You can add additional logic here if needed
  }

  private async getPresentingElement() {
    return document.querySelector('ion-app') || undefined;
  }

  // Start monitoring for new admin-validated reports
  private startReportValidationMonitoring() {
    console.log('🔔 Starting report validation monitoring...');
    
    // Check for new validated reports every 30 seconds
    setInterval(() => {
      if (this.isRealTimeTracking) {
        console.log('🔔 Checking for new admin-validated reports...');
        this.reportService.getAllReports().subscribe({
          next: (allReports) => {
            // Filter only validated reports (same as admin approach)
            const reports = allReports.filter(r => r.status === 'Validated');
            this.checkForNewValidatedReports(reports);
          },
          error: (error) => {
            console.error('Error checking for new validated reports:', error);
          }
        });
      }
    }, 30000); // Check every 30 seconds

    // Add sample notifications for testing (remove in production)
    // this.addSampleNotifications();
  }

  // Add sample notifications for testing
  private addSampleNotifications() {
    // no-op in production
  }

  // Helper methods for alert display
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
          
          // Check for zone notifications
          this.checkZoneNotifications(location);
          
          // Update address for new location (throttled to avoid too many API calls)
          if (!this.lastAddressUpdate || Date.now() - this.lastAddressUpdate > 10000) { // Update every 10 seconds
            this.getCurrentAddress(location.lat, location.lng);
            this.lastAddressUpdate = Date.now();
          }
          
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

    // Start monitoring for new admin-validated reports
    this.startReportValidationMonitoring();
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

    // Battery optimization notification banner removed as requested
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
      
      // Keep arrow pointing up relative to screen. Important: do NOT set
      // transform on the marker root element because Mapbox uses it to
      // position the marker via translate(). Changing it hides the marker.
      if (location.heading !== undefined && location.heading !== null) {
        const markerElement = this.userMarker.getElement();
        const arrowEl = markerElement?.querySelector('.waze-arrow') as HTMLElement | null;
        if (arrowEl) {
          arrowEl.style.transform = 'rotate(0deg)';
        }
      }
      
      // Check for nearby zones and update safety status
      this.checkNearbyZones(location);
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
      
      // Get readable address for initial location
      await this.getCurrentAddress(location.lat, location.lng);
      
      this.zoneEngine.updateCurrentLocation(location);
      
      // Check for zone notifications
      this.checkZoneNotifications(location);
      
      // Check GPS accuracy
      await this.checkGPSAccuracy();
      
      // Check nearby zones for initial safety status
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
        // Force map to recalculate its size
        this.map.getContainer().style.height = '100%';
        
        // CRITICAL FIX: Ensure heatmap layers are completely removed on initial load
        if (!this.isHeatmapVisible) {
          this.removeHeatmapLayer();
        }
      }
    }, 100);

    this.setupEdgeHandleDrag();
    this.initializeQuickActionsSheet();
  }

  // Quick Actions Sheet Methods
  initializeQuickActionsSheet() {
    // Calculate sheet height
    setTimeout(() => {
      const sheet = document.querySelector('.quick-actions-sheet');
      if (sheet) {
        this.sheetHeight = sheet.scrollHeight;
      }
    }, 100);
  }

  toggleQuickActions() {
    this.isQuickActionsOpen = !this.isQuickActionsOpen;
  }

  onTouchStart(event: TouchEvent) {
    this.touchStartY = event.touches[0].clientY;
    this.touchCurrentY = this.touchStartY;
    this.isDragging = true;
  }

  onTouchMove(event: TouchEvent) {
    if (!this.isDragging) return;
    
    this.touchCurrentY = event.touches[0].clientY;
    const deltaY = this.touchCurrentY - this.touchStartY;
    
    // Prevent default scrolling when dragging
    if (Math.abs(deltaY) > 10) {
      event.preventDefault();
    }
  }

  onTouchEnd(event: TouchEvent) {
    if (!this.isDragging) return;
    
    const deltaY = this.touchCurrentY - this.touchStartY;
    const threshold = 50; // Minimum distance to trigger action
    
    if (deltaY < -threshold) {
      // Swipe up - open sheet
      this.isQuickActionsOpen = true;
    } else if (deltaY > threshold) {
      // Swipe down - close sheet
      this.isQuickActionsOpen = false;
    }
    
    this.isDragging = false;
  }

  // Mouse event handlers for browser testing
  onMouseDown(event: MouseEvent) {
    this.touchStartY = event.clientY;
    this.touchCurrentY = this.touchStartY;
    this.isMouseDown = true;
    this.isDragging = true;
  }

  onMouseMove(event: MouseEvent) {
    if (!this.isDragging || !this.isMouseDown) return;
    
    this.touchCurrentY = event.clientY;
    const deltaY = this.touchCurrentY - this.touchStartY;
    
    // Prevent default scrolling when dragging
    if (Math.abs(deltaY) > 10) {
      event.preventDefault();
    }
  }

  onMouseUp(event: MouseEvent) {
    if (!this.isDragging || !this.isMouseDown) return;
    
    const deltaY = this.touchCurrentY - this.touchStartY;
    const threshold = 50; // Minimum distance to trigger action
    
    if (deltaY < -threshold) {
      // Drag up - open sheet
      this.isQuickActionsOpen = true;
    } else if (deltaY > threshold) {
      // Drag down - close sheet
      this.isQuickActionsOpen = false;
    }
    
    this.isDragging = false;
    this.isMouseDown = false;
  }

  onMouseLeave(event: MouseEvent) {
    // Reset dragging state when mouse leaves the element
    this.isDragging = false;
    this.isMouseDown = false;
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
      
      // Check for zone notifications
      this.checkZoneNotifications(location);
      
      // Get readable address using reverse geocoding
      await this.getCurrentAddress(location.lat, location.lng);
      
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

  async getCurrentAddress(lat: number, lng: number) {
    try {
      // Using Mapbox Geocoding API for reverse geocoding
      const accessToken = 'pk.eyJ1IjoidG9taWthemUxIiwiYSI6ImNtY25rM3NxazB2ZG8ybHFxeHVoZWthd28ifQ.Vnf9pMEQAryEI2rMJeMQGQ';
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${accessToken}&types=address,poi,place,locality,neighborhood&limit=1`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        
        // Extract readable address components
        const context = feature.context || [];
        const placeName = feature.place_name || '';
        
        // Try to get a shorter, more readable address
        let readableAddress = '';
        
        if (feature.properties && feature.properties.address) {
          // Use specific address if available
          readableAddress = `${feature.properties.address}`;
          if (context.length > 0) {
            const locality = context.find((c: any) => c.id.startsWith('locality'));
            const region = context.find((c: any) => c.id.startsWith('region'));
            if (locality) readableAddress += `, ${locality.text}`;
            if (region) readableAddress += `, ${region.text}`;
          }
        } else if (placeName) {
          // Parse the full place name to get a shorter version
          const parts = placeName.split(',');
          if (parts.length >= 2) {
            // Take first 2 parts for a more readable address
            readableAddress = parts.slice(0, 2).join(', ').trim();
          } else {
            readableAddress = placeName;
          }
        } else {
          // Fallback to coordinates
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
      anchor: 'bottom', // Bottom of triangle at exact GPS location (like Waze)
      rotationAlignment: 'map', // Rotate with map
      pitchAlignment: 'map' // Tilt with map pitch
    })
      .setLngLat([this.currentLocation.lng, this.currentLocation.lat])
      .addTo(this.map);

    this.map.on('load', () => {
      console.log('Map loaded in HomePage - Simple Waze-like navigation');
      
      // Resize map to ensure it fills the container properly
      this.map!.resize();
      
      // Keep it simple - just streets, no 3D buildings
      // Clean Waze-like experience with flat streets and navigation arrow
      
      setTimeout(() => {
        this.map!.addControl(new mapboxgl.NavigationControl({
          showCompass: true,
          showZoom: true
        }), 'top-right');
        
        // Add Geolocate (recenter) control to quickly return to user's location
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

    // Refresh markers visibility when zoom changes (matching admin)
    this.map.on('zoomend', () => {
      const currentZoom = this.map?.getZoom() || 0;
      console.log(`📍 ZOOM EVENT: Zoom level changed to ${currentZoom}, heatmap visible: ${this.isHeatmapVisible}`);
      
      if (this.isHeatmapVisible) {
        console.log('📍 ZOOM EVENT: Heatmap mode - using heatmap layers, not individual markers');
        // Don't call updateReportMarkers() in heatmap mode - use heatmap layers instead
      } else {
        console.log('📍 ZOOM EVENT: Navigation mode - keeping map completely clean, no markers');
        // Navigation mode should be completely clean - no markers or heatmap elements
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
        
        // Store zones for zone notifications only
        this.zones = zones || [];
        
        // Don't modify validatedReports here - they're loaded directly from database
        // This prevents location precision loss from zone conversion
      },
      error: (error) => {
        console.error('Error loading zones:', error);
        this.zones = [];
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
      // Only add heatmap layer, not individual markers to avoid duplicates
      this.updateHeatmapLayer();
      
      // Real-time user location removed from heatmap to prevent user location glow
    } else {
      // CRITICAL FIX: Completely remove heatmap layers when turned off
      this.removeHeatmapLayer();
      
      // Remove ALL markers when heatmap is OFF
      this.removeReportMarkers();
      this.removeRealTimeUserLocationFromHeatmap();
      
      // Also ensure no individual report markers are visible
      this.reportMarkers.forEach(marker => marker.remove());
      this.reportMarkers = [];
    }

    console.log('Heatmap updated successfully');
  }

  private updateReportMarkers() {
    if (!this.map) return;

    // Only show individual markers at high zoom to avoid color stacking (matching admin)
    const zoom = this.map.getZoom();
    const shouldShowMarkers = zoom >= 14;

    // AGGRESSIVE CLEANUP: Remove ALL existing markers first
    console.log(`📍 AGGRESSIVE CLEANUP: Removing ${this.reportMarkers.length} existing markers`);
    this.reportMarkers.forEach((marker, index) => {
      console.log(`📍 Removing marker ${index + 1}`);
      marker.remove();
    });
    this.reportMarkers = [];

    if (!shouldShowMarkers) {
      console.log('📍 Not showing markers due to zoom level:', zoom);
      return; // keep map clean at lower zooms; heat layers convey density
    }

    // CRITICAL FIX: Navigation mode should be completely clean - NO markers or heatmap elements
    // Individual markers should NEVER be created in navigation mode
    // Heatmap elements should ONLY appear when heatmap toggle is explicitly ON
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

    // Add markers for each validated report (same as admin)
        // NO DEDUPLICATION - show all reports as they come from admin
        const validReports = this.validatedReports.filter(report => {
          // Only check for valid coordinates
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
    
    // Additional debugging for marker creation
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
      
      // Skip reports without valid risk level
      const hasRiskLevel = (report.riskLevel !== null && report.riskLevel !== undefined) || 
                           (report.level !== null && report.level !== undefined);
      if (!hasRiskLevel) {
        console.warn('Skipping report without risk level:', report.id);
        return;
      }

      // Create custom marker element with proper centering
      const el = document.createElement('div');
      el.className = 'custom-marker';
      el.style.width = '30px';
      el.style.height = '30px';
      el.style.borderRadius = '50%';
      el.style.cursor = 'pointer';
      el.style.border = '3px solid white';
      el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
      el.style.position = 'absolute';
      el.style.left = '-15px'; // Half of width to center horizontally
      el.style.top = '-15px';  // Half of height to center vertically
      
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

      // Debug: Log coordinates for verification
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

      // Add marker to map
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

    // CRITICAL FIX: Always remove existing layers first to prevent duplicates
    console.log('📍 Heatmap: Updating heatmap layer with validated reports');
    
    // Remove any existing heatmap layers before creating new ones
    const existingHeatLayers = ['heat-l1', 'heat-l2', 'heat-l3', 'heat-l4', 'heat-l5'];
    const existingClusterLayers = ['cluster-count', 'cluster-circles', 'unclustered-points'];
    
    [...existingHeatLayers, ...existingClusterLayers].forEach(layerId => {
      if (this.map!.getLayer(layerId)) {
        console.log(`📍 Heatmap: Removing existing layer ${layerId} before recreating`);
        this.map!.removeLayer(layerId);
      }
    });

    // Create GeoJSON from validated reports (matching admin implementation)
        // NO DEDUPLICATION - show all 8 reports as they come from admin
        const validReports = this.validatedReports.filter(report => {
          // Only check for valid coordinates
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
          
          // Debug logging to check risk levels and coordinates
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
    console.log('📍 Heatmap points being created:', geojson.features.map(f => ({
      coordinates: f.geometry.coordinates,
      weight: f.properties.weight
    })));

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
        clusterMaxZoom: 20, // CRITICAL FIX: Keep clusters visible at high zoom levels
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

    // Add per-level heatmap layers (matching admin exactly) - ALL 5 LEVELS
    heatLayers.forEach(layer => {
      if (!this.map!.getLayer(layer.id)) {
        console.log(`📍 Heatmap: Adding layer ${layer.id} for level ${layer.level} (${layer.rgba.join(',')} color)`);
        this.map!.addLayer({
          id: layer.id,
          type: 'heatmap',
          source: sourceId,
          minzoom: 5,
          maxzoom: 22, // CRITICAL FIX: Allow heatmap to be visible at all zoom levels
          filter: ['==', ['get', 'weight'], layer.level],
          layout: {
            // CRITICAL FIX: Always visible when heatmap is on - show all zone levels
            visibility: 'visible'
          },
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
            'heatmap-opacity': 0.6, // CRITICAL FIX: Always visible when heatmap is on
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

    // Add cluster circles to show numbered markers (like in screenshot)
    if (!this.map.getLayer('cluster-circles')) {
      this.map.addLayer({
        id: 'cluster-circles',
        type: 'circle',
        source: clusterSourceId,
        filter: ['has', 'point_count'],
        maxzoom: 22, // CRITICAL FIX: Allow circles to be visible at all zoom levels
        layout: {
          // CRITICAL FIX: Always visible when heatmap is on - show all zone levels
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
          'circle-opacity': 0.9, // CRITICAL FIX: Make circles highly visible like in screenshot
          'circle-stroke-width': 2,
          'circle-stroke-color': 'white'
        }
      } as any);
    }

    // Add cluster count labels to show numbers (like in screenshot)
    if (!this.map.getLayer('cluster-count')) {
      this.map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: clusterSourceId,
        filter: ['has', 'point_count'],
        maxzoom: 22, // CRITICAL FIX: Allow labels to be visible at all zoom levels
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 14,
          // CRITICAL FIX: Always visible when heatmap is on - show all zone levels
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
    
    // DEBUG: List all existing layers before removal
    const allLayers = this.map.getStyle().layers;
    console.log('📍 Heatmap: All existing layers before removal:', allLayers.map(l => l.id));
    
    // Remove all per-level heatmap layers (matching admin)
    const heatLayers = ['heat-l1', 'heat-l2', 'heat-l3', 'heat-l4', 'heat-l5'];
    heatLayers.forEach(layerId => {
      if (this.map!.getLayer(layerId)) {
        console.log(`📍 Heatmap: Removing layer ${layerId}`);
        this.map!.removeLayer(layerId);
      } else {
        console.log(`📍 Heatmap: Layer ${layerId} does not exist`);
      }
    });

    // Remove cluster layers (matching admin)
    const clusterLayers = ['cluster-count', 'cluster-circles', 'unclustered-points'];
    clusterLayers.forEach(layerId => {
      if (this.map!.getLayer(layerId)) {
        console.log(`📍 Heatmap: Removing cluster layer ${layerId}`);
        this.map!.removeLayer(layerId);
      } else {
        console.log(`📍 Heatmap: Cluster layer ${layerId} does not exist`);
      }
    });
    
    // Remove sources - CRITICAL FIX: Remove sources AFTER removing layers
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
    
    // CRITICAL FIX: Also remove any individual report markers when removing heatmap
    this.removeReportMarkers();
    
    // DEBUG: List all remaining layers after removal
    const remainingLayers = this.map.getStyle().layers;
    console.log('📍 Heatmap: Remaining layers after removal:', remainingLayers.map(l => l.id));
    
    // CRITICAL FIX: Force map to refresh/render after layer removal
    // This ensures the map properly updates its display
    if (this.map.isStyleLoaded()) {
      this.map.resize();
    }
    
    console.log('📍 Heatmap: Comprehensive layer removal completed - all heatmap zones and markers removed');
  }

  private ensureCleanNavigationMode() {
    if (!this.map) return;
    
    console.log('📍 NAVIGATION: Ensuring completely clean navigation mode...');
    
    // Remove all heatmap layers
    this.removeHeatmapLayer();
    
    // Remove all report markers
    this.removeReportMarkers();
    
    // Remove any other potential visual elements
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
    
    // CRITICAL FIX: Use layout visibility property instead of just opacity for complete hiding
    // Update per-level heatmap layers - use both layout visibility and paint opacity
    const heatLayers = ['heat-l1', 'heat-l2', 'heat-l3', 'heat-l4', 'heat-l5'];
    heatLayers.forEach(layerId => {
      if (this.map!.getLayer(layerId)) {
        this.map!.setLayoutProperty(layerId, 'visibility', isVisible as any);
        this.map!.setPaintProperty(layerId, 'heatmap-opacity', opacity);
      }
    });

    // Update cluster layers visibility - use layout visibility for complete hiding
    if (this.map.getLayer('cluster-circles')) {
      this.map.setLayoutProperty('cluster-circles', 'visibility', isVisible as any);
      this.map.setPaintProperty('cluster-circles', 'circle-opacity', clusterOpacity);
    }
    if (this.map.getLayer('cluster-count')) {
      this.map.setLayoutProperty('cluster-count', 'visibility', isVisible as any);
    }
    
    // Update unclustered points visibility - use layout visibility for complete hiding
    if (this.map.getLayer('unclustered-points')) {
      this.map.setLayoutProperty('unclustered-points', 'visibility', isVisible as any);
      this.map.setPaintProperty('unclustered-points', 'circle-opacity', unclusteredOpacity);
    }
  }

  private ensureHeatmapLayersExist() {
    if (!this.map || !this.isHeatmapVisible) return;
    
    // Check if heatmap layers already exist
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
      
      // CRITICAL FIX: Always remove any existing heatmap layers first to prevent duplicates
      this.removeHeatmapLayer();
      
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
        
        // Hide user marker in heatmap mode - only show heatmap data
        if (this.userMarker) {
          this.userMarker.remove();
        }
        
        // CRITICAL FIX: Remove any existing heatmap layers before creating new ones
        this.removeHeatmapLayer();
        
        // Create fresh heatmap layers
        this.updateHeatmapLayer();
        
        console.log('✅ Heatmap mode active - navigation disabled, map is user-controlled');
      });
    } else {
      console.log('🧭 NAVIGATION MODE: Restoring Waze-style camera following...');
      
      // CRITICAL FIX: Remove heatmap layers BEFORE switching styles to ensure complete cleanup
      console.log('📍 NAVIGATION: Removing heatmap layers before style switch');
      this.removeHeatmapLayer();
      
      // Restore Waze-style clean streets map
      this.map.setStyle('mapbox://styles/mapbox/streets-v12');
      
      // Wait for style to load before restoring navigation
      this.map.once('styledata', () => {
        if (!this.map) return;
        
        console.log('📍 NAVIGATION: Style loaded, cleaning up any remaining heatmap elements');
        
        // Re-add or recreate the blue navigation arrow marker
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

            // Ensure required CSS exists (idempotent)
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
        
        // CRITICAL FIX: Ensure completely clean navigation mode
        this.ensureCleanNavigationMode();
        
        // DEBUG: Final check - list all layers after complete cleanup
        const finalLayers = this.map.getStyle().layers;
        console.log('📍 NAVIGATION: Final layers after complete cleanup:', finalLayers.map(l => l.id));
        
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

  // Check for nearby zones and update safety status
  private checkNearbyZones(location: { lat: number; lng: number }) {
    // Store previous state for change detection
    const previousStatus = this.safetyStatus;
    const wasInZone = this.inDangerZone;
    
    // Check if there are any validated reports first
    if (!this.validatedReports || this.validatedReports.length === 0) {
      // No reports at all - completely safe
      this.safetyStatus = 'safe';
      this.nearbyZoneAlert = '';
      this.nearestZoneDistance = null;
      this.hasNearbyReports = false;
      this.nearbyReportsCount = 0;
      this.inDangerZone = false;
      this.locationSafetyMessage = '✓ Your location is SAFE - No incidents reported in this area';
      
      // Update previous state
      this.previousSafetyStatus = this.safetyStatus;
      this.wasInDangerZone = this.inDangerZone;
      return;
    }

    // Calculate distance to each validated report
    const reportsWithDistance = this.validatedReports.map(report => {
      const distance = this.calculateDistance(
        location.lat,
        location.lng,
        report.location.lat,
        report.location.lng
      );
      return { report, distance };
    });

    // Sort by distance
    reportsWithDistance.sort((a, b) => a.distance - b.distance);

    // Check if user is at exact location of a report (within 50m)
    const reportsAtLocation = reportsWithDistance.filter(r => r.distance * 1000 <= 50);
    
    if (reportsAtLocation.length > 0) {
      // User is at a location with reports
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
      
      // Check for state changes and show notifications
      this.checkAndNotifyZoneChanges(previousStatus, wasInZone);
      
      // Update previous state
      this.previousSafetyStatus = this.safetyStatus;
      this.wasInDangerZone = this.inDangerZone;
      return;
    }

    // Get the nearest report
    const nearest = reportsWithDistance[0];
    const distanceInMeters = Math.round(nearest.distance * 1000);
    this.nearestZoneDistance = distanceInMeters;

    // Determine zone radius for nearest report level
    const nearestRiskLevel = nearest.report.level || nearest.report.riskLevel || 1;
    const zoneRadius = this.getZoneRadiusMeters(nearestRiskLevel);

    // Check proximity alerts
    const nearbyReports = reportsWithDistance.filter(r => r.distance * 1000 <= 1000); // within 1km
    this.nearbyReportsCount = nearbyReports.length;
    this.hasNearbyReports = nearbyReports.length > 0;

    // Only treat as inside a zone if within the zone radius
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
      
      // Check for state changes and show notifications
      this.checkAndNotifyZoneChanges(previousStatus, wasInZone);
      
      // Update previous state
      this.previousSafetyStatus = this.safetyStatus;
      this.wasInDangerZone = this.inDangerZone;
      return;
    }

    // Outside zone radius => safe, clear in-zone risk level
    this.currentZoneRiskLevel = null;

    // If outside zone radius but still within 1km, show nearby info but keep safe unless high levels within 100m handled above
    if (distanceInMeters <= 1000) {
      this.safetyStatus = 'safe';
      this.locationSafetyMessage = `✓ Your location is SAFE - Nearest incident is ${distanceInMeters}m away`;
      this.nearbyZoneAlert = `ⓘ ${nearbyReports.length} REPORT(S) WITHIN 1KM`;
      this.inDangerZone = false;
      this.stopAlertSound();

      // Check for state changes and show notifications
      this.checkAndNotifyZoneChanges(previousStatus, wasInZone);
      
      // Update previous state
      this.previousSafetyStatus = this.safetyStatus;
      this.wasInDangerZone = this.inDangerZone;
      return;
    }

    // No reports nearby (>1km away)
    this.safetyStatus = 'safe';
    this.nearbyZoneAlert = '';
    this.nearestZoneDistance = distanceInMeters;
    this.hasNearbyReports = false;
    this.locationSafetyMessage = `✓ Your location is SAFE - No incidents reported nearby (nearest: ${(distanceInMeters/1000).toFixed(1)}km)`;
    this.inDangerZone = false;
    
    // Check for state changes and show notifications
    this.checkAndNotifyZoneChanges(previousStatus, wasInZone);
    
    // Update previous state
    this.previousSafetyStatus = this.safetyStatus;
    this.wasInDangerZone = this.inDangerZone;
  }

  // Get risk level text description
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

  // Heatmap radius per level (meters)
  private getZoneRadiusMeters(riskLevel: number): number {
    switch (riskLevel) {
      case 1: return 25;   // low risk - very small radius
      case 2: return 35;   // moderate
      case 3: return 50;   // high
      case 4: return 70;   // critical
      case 5: return 90;   // extreme
      default: return 40;
    }
  }

  // Check for zone changes and show appropriate notifications
  private checkAndNotifyZoneChanges(previousStatus: 'safe' | 'warning' | 'danger', wasInZone: boolean) {
    const now = Date.now();
    // Throttle notifications to avoid spam (minimum 10 seconds between notifications)
    if (now - this.lastNotificationTime < 10000) {
      return;
    }

    console.log('📍 Zone detection active - checking for zone entry alerts');

    // SCENARIO 1: User entered any heatmap zone (within 100m of ANY incident with risk level 1-5)
    if (!wasInZone && this.inDangerZone && this.safetyStatus === 'danger') {
      this.lastNotificationTime = now;
      
      // Find the nearest report to get details (ANY risk level 1-5)
      const nearestIncident = this.validatedReports
        .filter(report => {
          const distance = this.calculateDistance(
            this.currentLocation!.lat, this.currentLocation!.lng,
            report.location.lat, report.location.lng
          );
          const riskLevel = report.level || report.riskLevel || 1;
          return distance * 1000 <= 100 && riskLevel >= 1 && riskLevel <= 5; // ALL risk levels 1-5
        })
        .sort((a, b) => {
          const distA = this.calculateDistance(this.currentLocation!.lat, this.currentLocation!.lng, a.location.lat, a.location.lng);
          const distB = this.calculateDistance(this.currentLocation!.lat, this.currentLocation!.lng, b.location.lat, b.location.lng);
          return distA - distB;
        })[0];

      if (nearestIncident) {
        const riskLevel = nearestIncident.level || nearestIncident.riskLevel || 1;
        
        // Start continuous alert sound only if inside zone radius
        if (this.inDangerZone || this.currentZoneRiskLevel) {
          this.startContinuousAlertSoundForRiskLevel(riskLevel);
        }
        
        // Show full-screen alert for any heatmap zone
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

    // SCENARIO 2: User entered any heatmap zone (within 100m of ANY incident with risk level 1-5) - Warning status
    if (!wasInZone && this.inDangerZone && this.safetyStatus === 'warning') {
      this.lastNotificationTime = now;
      
      // Find the nearest incident (ANY risk level 1-5)
      const nearestIncident = this.validatedReports
        .filter(report => {
          const distance = this.calculateDistance(
            this.currentLocation!.lat, this.currentLocation!.lng,
            report.location.lat, report.location.lng
          );
          const riskLevel = report.level || report.riskLevel || 1;
          return distance * 1000 <= 100 && riskLevel >= 1 && riskLevel <= 5; // ALL risk levels 1-5
        })
        .sort((a, b) => {
          const distA = this.calculateDistance(this.currentLocation!.lat, this.currentLocation!.lng, a.location.lat, a.location.lng);
          const distB = this.calculateDistance(this.currentLocation!.lat, this.currentLocation!.lng, b.location.lat, b.location.lng);
          return distA - distB;
        })[0];

      if (nearestIncident) {
        const riskLevel = nearestIncident.level || nearestIncident.riskLevel || 1;
        
        // Start continuous alert sound only if inside zone radius
        if (this.inDangerZone || this.currentZoneRiskLevel) {
          this.startContinuousAlertSoundForRiskLevel(riskLevel);
        }
        
        // Show full-screen alert for any heatmap zone
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

    // SCENARIO 3: User's status changed to warning (nearby zones detected)
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

    // SCENARIO 4: User has nearby reports (within 1km) but location is safe
    if (this.hasNearbyReports && this.safetyStatus === 'safe' && !this.wasInDangerZone && this.nearbyReportsCount > 0) {
      // Only notify once when nearby reports are first detected
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

  // Start continuous alert sound for zone entry using ringtone
  private startContinuousAlertSound(zoneLevel: string) {
    // Stop any existing alert sound first
    this.stopAlertSound();
    
    try {
      // Use ringtone file instead of generated sound
      const audio = new Audio();
      
      // Set ringtone file path based on zone level
      let ringtoneFile: string;
      let interval: number;
      
      // Use the same ringtone file for all zone levels but vary the interval
      ringtoneFile = '/assets/sounds/GuardianCare - Ringtone.mp3';
      
      switch (zoneLevel.toLowerCase()) {
        case 'danger':
          interval = 2500; // Play every 2.5 seconds - critical alert
          break;
        case 'caution':
          interval = 3500; // Play every 3.5 seconds - moderate alert
          break;
        default:
          interval = 4500; // Play every 4.5 seconds - gentle alert
      }
      
      audio.src = ringtoneFile;
      audio.volume = 0.8; // Set volume to 80%
      audio.loop = false; // Don't loop the file itself
      
      // Function to play the ringtone
      const playRingtone = () => {
        if (audio.paused || audio.ended) {
          audio.currentTime = 0; // Reset to beginning
          audio.play().catch(error => {
            console.warn('Could not play ringtone:', error);
            // No fallback sound - only use GuardianCare ringtone
          });
        }
      };
      
      // Play initial ringtone
      playRingtone();
      
      // Vibrate on initial alert
      this.vibrateDevice();
      
      // Set up continuous ringtone playing
      this.alertSoundInterval = setInterval(() => {
        playRingtone();
        // Vibrate occasionally with ringtone
        if (Math.random() < 0.4) { // 40% chance to vibrate with each ringtone
          this.vibrateDevice();
        }
      }, interval);
      
      // Store audio reference for cleanup
      this.currentAlertSound = audio;
      
      console.log('🔊 Continuous ringtone alert started:', zoneLevel, `(${ringtoneFile}, ${interval}ms interval)`);
    } catch (error) {
      console.warn('Could not start ringtone alert:', error);
      // No fallback sound - only use GuardianCare ringtone
    }
  }
  
  // Start continuous alert sound based on specific risk level (1-5)
  private startContinuousAlertSoundForRiskLevel(riskLevel: number) {
    // Stop any existing alert sound first
    this.stopAlertSound();
    
    try {
      // Use ringtone file based on specific risk level
      const audio = new Audio();
      
      let ringtoneFile: string;
      let interval: number;
      
      // Use the same ringtone file for all risk levels but vary the interval
      ringtoneFile = '/assets/sounds/GuardianCare - Ringtone.mp3';
      
      switch (riskLevel) {
        case 1:
          interval = 10000; // Play every 10 seconds - low risk, gentle reminder
          break;
        case 2:
          interval = 8000; // Play every 8 seconds - moderate risk, regular alert
          break;
        case 3:
          interval = 6000; // Play every 6 seconds - high risk, frequent alert
          break;
        case 4:
          interval = 4000; // Play every 4 seconds - critical risk, urgent alert
          break;
        case 5:
          interval = 2000; // Play every 2 seconds - extreme risk, continuous alert
          break;
        default:
          interval = 8000; // Default to moderate
      }
      
      audio.src = ringtoneFile;
      audio.volume = 0.8; // Set volume to 80%
      audio.loop = false; // Don't loop the file itself
      
      // Function to play the ringtone
      const playRingtone = () => {
        if (audio.paused || audio.ended) {
          audio.currentTime = 0; // Reset to beginning
          audio.play().catch(error => {
            console.warn('Could not play ringtone:', error);
            // No fallback sound - only use GuardianCare ringtone
          });
        }
      };
      
      // Play initial ringtone
      playRingtone();
      
      // Vibrate on initial alert
      this.vibrateDevice();
      
      // Set up continuous ringtone playing
      this.alertSoundInterval = setInterval(() => {
        playRingtone();
        // Vibrate occasionally with ringtone
        if (Math.random() < 0.4) { // 40% chance to vibrate with each ringtone
          this.vibrateDevice();
        }
      }, interval);
      
      // Store audio reference for cleanup
      this.currentAlertSound = audio;
      
      console.log('🔊 Continuous ringtone alert started for risk level:', riskLevel, `(${ringtoneFile}, ${interval}ms interval)`);
    } catch (error) {
      console.warn('Could not start ringtone alert for risk level:', riskLevel, error);
      // No fallback sound - only use GuardianCare ringtone
    }
  }
  
  
  // Stop continuous alert sound
  private stopAlertSound() {
    if (this.alertSoundInterval) {
      clearInterval(this.alertSoundInterval);
      this.alertSoundInterval = null;
      console.log('🔇 Alert sound stopped');
    }
    
    // Stop ringtone audio if playing
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
    
    // Audio context cleanup no longer needed - only using ringtone file
  }
  
  // Show full-screen zone alert dialog
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
            // Stop the alert sound when user clicks OK
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
  
  // Show safety tips based on zone level
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

  // Check if a point is inside a polygon using ray casting algorithm
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

  // Calculate distance between two coordinates (returns km)
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in km
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

  // Get risk level from zone level
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

  // Safety Status Methods
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

  // Helper: formatted nearest distance text (e.g., 250m or 1.2km)
  getNearestDistanceText(): string {
    if (this.nearestZoneDistance == null) return '';
    const d = this.nearestZoneDistance;
    if (d < 1000) return `${d}m`;
    return `${(d / 1000).toFixed(1)}km`;
  }

  // Handle navigation from notifications
  checkForNotificationNavigation() {
    const navigationData = localStorage.getItem('guardian_care_navigate_to_location');
    if (navigationData) {
      try {
        const locationData = JSON.parse(navigationData);
        console.log('🗺️ Received navigation data from notification:', locationData);
        
        // Clear the navigation data
        localStorage.removeItem('guardian_care_navigate_to_location');
        
        // Navigate to the location after a short delay to ensure map is ready
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
      // Fly to the location with animation
      this.map.flyTo({
        center: [locationData.lng, locationData.lat],
        zoom: 16,
        duration: 2000
      });
      
      // Add a marker for the notification location
      this.addNotificationMarker(locationData);
      
      // Show a toast notification
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
      // Remove any existing notification markers
      const existingMarker = document.getElementById('notification-marker');
      if (existingMarker) {
        existingMarker.remove();
      }
      
      // Create a custom marker element
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
      
      // Add marker to map
      new mapboxgl.Marker(markerEl)
        .setLngLat([locationData.lng, locationData.lat])
        .addTo(this.map);
      
      // Remove marker after 10 seconds
      setTimeout(() => {
        const marker = document.getElementById('notification-marker');
        if (marker) {
          marker.remove();
        }
      }, 10000);
    }
  }

}
