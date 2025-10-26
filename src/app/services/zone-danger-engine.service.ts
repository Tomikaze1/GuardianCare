import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';
import { ReportService } from './report.service';
import { BehaviorSubject, Observable, interval } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

export interface DangerZone {
  id: string;
  name: string;
  level: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
  riskLevel?: number; 
  coordinates: [number, number][]; 
  timeSlots: TimeSlot[];
  incidents: ZoneIncident[];
  currentSeverity: number;
  crimeFrequency: CrimeFrequency;
  timeBasedRisk: TimeBasedRisk;
  alertSettings: AlertSettings;
}

interface TimeSlot {
  startHour: number; 
  endHour: number; 
  baseSeverity: number;
  crimeMultiplier: number;
  description: string;
}

interface ZoneIncident {
  id: string;
  timestamp: Date;
  severity: number;
  type: 'theft' | 'assault' | 'vandalism' | 'harassment' | 'other';
  description?: string;
  level?: number; 
  riskLevel?: number; 
}

interface CrimeFrequency {
  daily: number;
  weekly: number;
  monthly: number;
  peakHours: number[];
  peakDays: number[];
}

interface TimeBasedRisk {
  morning: number;
  afternoon: number;
  evening: number;
  night: number;
  weekend: number;
  weekday: number;
}

interface AlertSettings {
  enablePushNotifications: boolean;
  enableVibration: boolean;
  enableSound: boolean;
  vibrationPattern: number[];
  alertThreshold: number;
}

@Injectable({
  providedIn: 'root'
})
export class ZoneDangerEngineService {
  private zones = new BehaviorSubject<DangerZone[]>([]);
  public zones$ = this.zones.asObservable();
  
  private currentLocation = new BehaviorSubject<{ lat: number; lng: number } | null>(null);
  public currentLocation$ = this.currentLocation.asObservable();

  private readonly weights = {
    timeSlot: 0.3,
    frequency: 0.25,
    recentness: 0.25,
    timeBasedRisk: 0.2
  };

  private alertHistory: Set<string> = new Set();
  private isInitialized = false;

  constructor(
    private firebaseService: FirebaseService,
    private reportService: ReportService
  ) {
  }

  private startPeriodicUpdates() {
    setInterval(() => this.updateAllZones(), 60 * 60 * 1000);
    // Disabled: setInterval(() => this.checkForAlerts(), 30 * 1000);
    // Alert system is now handled by ZoneNotificationService to avoid duplication
  }

  public initializeZones() {
    if (this.isInitialized) {
      console.log('ZoneDangerEngineService: Already initialized, skipping');
      return;
    }

    console.log('ZoneDangerEngineService: Loading validated reports for heatmap...');
    
    setTimeout(() => {
      this.loadValidatedReportsAsZones();
      this.startPeriodicUpdates();
      this.isInitialized = true;
    }, 1000);
  }

  private loadValidatedReportsAsZones() {
    try {
      this.reportService.getValidatedReports().subscribe({
        next: (validatedReports) => {
          console.log('ZoneDangerEngineService: Validated reports loaded:', validatedReports.length);
          
          if (validatedReports && validatedReports.length > 0) {
            const reportZones: DangerZone[] = validatedReports.map(report => {
              return this.convertReportToZone(report);
            });
            
            console.log('ZoneDangerEngineService: Converted reports to zones:', reportZones.length);
            this.zones.next(reportZones);
            this.updateAllZones();
          } else {
            console.log('ZoneDangerEngineService: No validated reports found, showing empty heatmap');
            this.zones.next([]);
          }
        },
        error: (error) => {
          console.error('ZoneDangerEngineService: Error loading validated reports:', error);
          this.zones.next([]);
        }
      });
    } catch (error) {
      console.error('ZoneDangerEngineService: Error in loadValidatedReportsAsZones:', error);
      this.zones.next([]);
    }
  }

  private convertReportToZone(report: any): DangerZone {
    // Use heatmap risk levels directly from admin validation
    const heatmapRiskLevel = Number(report.riskLevel || report.level || report.validationLevel || 1);
    
    console.log(`🔍 convertReportToZone: ${report.locationAddress || report.location?.simplifiedAddress || 'Unknown'}`, {
      reportId: report.id,
      riskLevel: report.riskLevel,
      level: report.level,
      validationLevel: report.validationLevel,
      finalHeatmapRiskLevel: heatmapRiskLevel,
      type: report.type,
      status: report.status
    });
    
    const currentSeverity = (heatmapRiskLevel / 5) * 10;
    
    // Map heatmap risk levels to zone levels for compatibility
    let level: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
    if (heatmapRiskLevel <= 0) {
      level = 'Safe'; // Only truly safe areas (risk level 0)
    } else if (heatmapRiskLevel <= 1) {
      level = 'Neutral'; // Green zones (heatmap level 1) - LOW
    } else if (heatmapRiskLevel <= 2) {
      level = 'Neutral'; // Yellow zones (heatmap level 2) - MODERATE
    } else if (heatmapRiskLevel <= 3) {
      level = 'Caution'; // Orange zones (heatmap level 3) - HIGH
    } else {
      level = 'Danger'; // Red/Dark Red zones (heatmap level 4-5) - CRITICAL/EXTREME
    }
    
    // 15 meters radius converted to degrees for Cebu latitude (~10.3°)
    // At this latitude, 1 degree ≈ 109.5km, so 15m ≈ 0.000137 degrees
    // Further reduced to 15m for more precise heatmap visualization as shown in screenshot
    const radius = 0.000137;
    const lat = report.location.lat;
    const lng = report.location.lng;
    
    return {
      id: report.id || `report-${Date.now()}`,
      name: report.location.simplifiedAddress || report.locationAddress || 'Reported Incident',
      level: level,
      riskLevel: heatmapRiskLevel, // Use heatmap risk level directly
      coordinates: [
        [lng - radius, lat - radius],
        [lng + radius, lat - radius],
        [lng + radius, lat + radius],
        [lng - radius, lat + radius],
        [lng - radius, lat - radius]
      ],
      timeSlots: [],
      incidents: [{
        id: report.id || `incident-${Date.now()}`,
        timestamp: report.createdAt?.toDate ? report.createdAt.toDate() : new Date(report.createdAt),
        severity: heatmapRiskLevel * 2, 
        type: this.mapReportTypeToIncidentType(report.type),
        description: report.description
      }],
      currentSeverity: currentSeverity,
      crimeFrequency: {
        daily: 1,
        weekly: 1,
        monthly: 1,
        peakHours: [],
        peakDays: []
      },
      timeBasedRisk: {
        morning: currentSeverity / 10,
        afternoon: currentSeverity / 10,
        evening: currentSeverity / 10,
        night: currentSeverity / 10,
        weekend: currentSeverity / 10,
        weekday: currentSeverity / 10
      },
      alertSettings: {
        enablePushNotifications: heatmapRiskLevel >= 1, // Enable for all heatmap zones
        enableVibration: heatmapRiskLevel >= 1, // Enable for all heatmap zones
        enableSound: heatmapRiskLevel >= 1, // Enable for all heatmap zones
        vibrationPattern: heatmapRiskLevel >= 4 ? [200, 100, 200, 100, 200] : [200, 200],
        alertThreshold: currentSeverity * 0.8
      }
    };
  }

  private mapReportTypeToIncidentType(reportType: string): 'theft' | 'assault' | 'vandalism' | 'harassment' | 'other' {
    const typeMap: { [key: string]: 'theft' | 'assault' | 'vandalism' | 'harassment' | 'other' } = {
      'crime-theft': 'theft',
      'theft-property': 'theft',
      'vehicle-theft': 'theft',
      'burglary': 'theft',
      'assault-minor': 'assault',
      'assault-severe': 'assault',
      'armed-robbery': 'assault',
      'harassment-verbal': 'harassment',
      'vandalism': 'vandalism'
    };
    
    return typeMap[reportType] || 'other';
  }

  private loadZonesWithRetry(retryCount = 0, maxRetries = 3) {
    try {
      this.loadZones();
    } catch (error: any) {
      if (retryCount < maxRetries && error.message && error.message.includes('NG0203')) {
        console.warn(`ZoneDangerEngineService: Retry ${retryCount + 1}/${maxRetries} due to injection error`);
        setTimeout(() => {
          this.loadZonesWithRetry(retryCount + 1, maxRetries);
        }, Math.pow(2, retryCount) * 100); 
      } else {
        console.error('ZoneDangerEngineService: Max retries reached, using fallback zones');
        this.loadFallbackZones();
      }
    }
  }

  private loadZones() {
    try {
      if (!this.firebaseService) {
        console.warn('ZoneDangerEngineService: Firebase service not available, using fallback zones');
        this.loadFallbackZones();
        return;
      }

      const firestoreInstance = this.firebaseService.getFirestoreInstance();
      if (!firestoreInstance) {
        console.warn('ZoneDangerEngineService: Firestore instance not available, using fallback zones');
        this.loadFallbackZones();
        return;
      }


      try {
        const testDoc = firestoreInstance.collection('dangerZones').doc('test');
        if (!testDoc) {
          throw new Error('Cannot access Firestore document');
        }
      } catch (injectionError: any) {
        if (injectionError.message && injectionError.message.includes('NG0203')) {
          console.warn('ZoneDangerEngineService: Injection context not available, using fallback zones');
          this.loadFallbackZones();
          return;
        }
        throw injectionError;
      }


      this.safeFirebaseOperation(() => {
        try {
          this.firebaseService.getDocuments('dangerZones').subscribe({
            next: (zones) => {
              console.log('ZoneDangerEngineService: Zones loaded from Firestore:', zones);
              if (zones && zones.length > 0) {
                this.zones.next(zones as DangerZone[]);
              } else {
                console.log('ZoneDangerEngineService: No zones found in Firestore, using fallback zones');
                this.loadFallbackZones();
              }
              this.updateAllZones();
            },
            error: (error) => {
              console.error('ZoneDangerEngineService: Error loading zones from Firestore:', error);
              this.loadFallbackZones();
            }
          });
        } catch (injectionError: any) {
          console.error('ZoneDangerEngineService: Injection error in getDocuments call:', injectionError);
          if (injectionError.message && injectionError.message.includes('NG0203')) {
            console.warn('ZoneDangerEngineService: Angular injection context error in getDocuments, using fallback zones');
          }
          this.loadFallbackZones();
        }
      });
    } catch (error) {
      console.error('ZoneDangerEngineService: Error in loadZones:', error);
      this.loadFallbackZones();
    }
  }

  private safeFirebaseOperation(operation: () => void) {
    try {
      operation();
    } catch (injectionError: any) {
      console.error('ZoneDangerEngineService: Injection error in Firebase operation:', injectionError);
      if (injectionError.message && injectionError.message.includes('NG0203')) {
        console.warn('ZoneDangerEngineService: Angular injection context error detected, using fallback');
      }
      this.loadFallbackZones();
    }
  }

  private loadFallbackZones() {
    console.log('ZoneDangerEngineService: No fallback zones - using only validated reports from admin');
    this.zones.next([]);
  }

  public processIncident(location: { lat: number; lng: number }, severity: 'low' | 'medium' | 'high', type: 'theft' | 'assault' | 'vandalism' | 'harassment' | 'other' = 'other', description?: string) {
    const zones = this.zones.value;
    const affectedZones = this.findZonesContainingLocation(location, zones);
    
    affectedZones.forEach(zone => {
      zone.incidents.push({
        id: Date.now().toString(),
        timestamp: new Date(),
        severity: this.mapSeverityToValue(severity),
        type: type,
        description: description
      });
      this.calculateZoneDanger(zone);
    });

    this.syncToFirestore(affectedZones);
  }

  public simulateRecentIncidents() {
    console.log('🧪 Incident simulation disabled - no test incidents created');
    return;
  }

  public updateCurrentLocation(location: { lat: number; lng: number }) {
    this.currentLocation.next(location);
  }

  public getNearbyIncidents(location: { lat: number; lng: number }, radiusKm: number = 0.5): Array<{ zone: DangerZone; incident: ZoneIncident; distance: number }> {
    const zones = this.zones.value;
    const now = new Date();
    const recentThreshold = 24 * 60 * 60 * 1000; // 24 hours
    const nearbyIncidents: Array<{ zone: DangerZone; incident: ZoneIncident; distance: number }> = [];

    zones.forEach(zone => {
      const zoneCenter = this.calculateZoneCenter(zone.coordinates);
      const distance = this.calculateDistance(
        location.lat, location.lng,
        zoneCenter[1], zoneCenter[0]
      );

      if (distance <= radiusKm) {
        const recentIncidents = zone.incidents.filter(incident => {
          const incidentTime = new Date(incident.timestamp);
          return (now.getTime() - incidentTime.getTime()) < recentThreshold;
        });

        recentIncidents.forEach(incident => {
          nearbyIncidents.push({
            zone: zone,
            incident: incident,
            distance: distance
          });
        });
      }
    });

    return nearbyIncidents.sort((a, b) => a.distance - b.distance);
  }

  private checkForAlerts() {
    const currentLocation = this.currentLocation.value;
    const zones = this.zones.value;
    
    if (!currentLocation || !zones.length) return;
    
    zones.forEach(zone => {
      if (this.isPointInPolygon([currentLocation.lng, currentLocation.lat], zone.coordinates)) {
        this.evaluateZoneAlert(zone, currentLocation);
        this.checkRecentIncidents(zone, currentLocation);
      }
    });
    
    this.checkNearbyIncidents(currentLocation);
  }

  private evaluateZoneAlert(zone: DangerZone, location: { lat: number; lng: number }) {
    const alertKey = `${zone.id}-${Math.floor(Date.now() / 30000)}`;
    
    if (this.alertHistory.has(alertKey)) return;
    
    const currentSeverity = zone.currentSeverity;
    const currentTime = new Date();
    const timeBasedRisk = this.calculateTimeBasedRisk(zone, currentTime);
    
    if (currentSeverity >= zone.alertSettings.alertThreshold || timeBasedRisk >= 0.7) {
      this.triggerSmartAlert(zone, currentSeverity, timeBasedRisk, location);
      this.alertHistory.add(alertKey);
      
      setTimeout(() => {
        this.alertHistory.delete(alertKey);
      }, 5 * 60 * 1000);
    }
  }

  private triggerSmartAlert(zone: DangerZone, severity: number, timeRisk: number, location: { lat: number; lng: number }) {
    // DISABLED: Alert system is now handled by ZoneNotificationService to avoid duplication
    console.log('🚨 SMART ALERT DISABLED - Using ZoneNotificationService instead:', {
      zoneId: zone.id,
      zoneName: zone.name,
      severity: severity,
      timeRisk: timeRisk,
      location: location
    });
  }

  private triggerVibrationAlert(pattern: number[]) {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }

  private triggerPushNotification(alertData: any) {
    const isLocalhost = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1' ||
                       window.location.hostname.includes('localhost');
    
    if (isLocalhost) {
      console.log('🔕 Zone danger push notification disabled in localhost environment:', alertData.zoneName);
      return;
    }
    
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('🚨 Zone Alert', {
        body: `High risk detected in ${alertData.zoneName}. Severity: ${Math.round(alertData.severity * 100)}%`,
        icon: '/assets/icon/favicon.png',
        tag: 'zone-alert',
        requireInteraction: true
      });
    }
  }

  private generateRecommendations(zone: DangerZone, severity: number, timeRisk: number): string[] {
    const recommendations: string[] = [];
    
    if (severity > 0.8) {
      recommendations.push('🚨 HIGH RISK: Consider leaving the area immediately');
    } else if (severity > 0.6) {
      recommendations.push('⚠️ MODERATE RISK: Stay alert and avoid isolated areas');
    }
    
    if (timeRisk > 0.8) {
      recommendations.push('🌙 NIGHT RISK: This area is particularly dangerous at this time');
    }
    
    if (zone.crimeFrequency.daily > 5) {
      recommendations.push('📊 HIGH CRIME: Multiple incidents reported recently');
    }
    
    recommendations.push('📱 Keep your phone accessible for emergency calls');
    recommendations.push('👥 Stay in well-lit, populated areas');
    
    return recommendations;
  }

  private calculateTimeBasedRisk(zone: DangerZone, currentTime: Date): number {
    const hour = currentTime.getHours();
    const day = currentTime.getDay();
    const isWeekend = day === 0 || day === 6;
    
    let timeRisk = 0;
    
    if (hour >= 6 && hour < 12) {
      timeRisk = zone.timeBasedRisk.morning;
    } else if (hour >= 12 && hour < 18) {
      timeRisk = zone.timeBasedRisk.afternoon;
    } else if (hour >= 18 && hour < 24) {
      timeRisk = zone.timeBasedRisk.evening;
    } else {
      timeRisk = zone.timeBasedRisk.night;
    }
    
    const dayRisk = isWeekend ? zone.timeBasedRisk.weekend : zone.timeBasedRisk.weekday;
    
    return (timeRisk + dayRisk) / 2;
  }

  private checkRecentIncidents(zone: DangerZone, location: { lat: number; lng: number }) {
    const now = new Date();
    const recentThreshold = 2 * 60 * 60 * 1000;
    const recentIncidents = zone.incidents.filter(incident => {
      const incidentTime = new Date(incident.timestamp);
      return (now.getTime() - incidentTime.getTime()) < recentThreshold;
    });

    if (recentIncidents.length > 0) {
      this.triggerRecentIncidentAlert(zone, recentIncidents, location);
    }
  }

  private checkNearbyIncidents(location: { lat: number; lng: number }) {
    const zones = this.zones.value;
    const now = new Date();
    const nearbyThreshold = 5 * 60 * 60 * 1000;
    const searchRadius = 0.01;

    let nearbyIncidents: Array<{ zone: DangerZone; incident: ZoneIncident; distance: number }> = [];

    zones.forEach(zone => {
      const zoneCenter = this.calculateZoneCenter(zone.coordinates);
      const distance = this.calculateDistance(
        location.lat, location.lng,
        zoneCenter[1], zoneCenter[0]
      );

      if (distance <= searchRadius) {
        const recentIncidents = zone.incidents.filter(incident => {
          const incidentTime = new Date(incident.timestamp);
          return (now.getTime() - incidentTime.getTime()) < nearbyThreshold;
        });

        recentIncidents.forEach(incident => {
          nearbyIncidents.push({
            zone: zone,
            incident: incident,
            distance: distance
          });
        });
      }
    });

    if (nearbyIncidents.length > 0) {
      this.triggerNearbyIncidentAlert(nearbyIncidents, location);
    }
  }

  private triggerRecentIncidentAlert(zone: DangerZone, incidents: ZoneIncident[], location: { lat: number; lng: number }) {
    const alertKey = `recent-${zone.id}-${Math.floor(Date.now() / 60000)}`;
    
    if (this.alertHistory.has(alertKey)) return;

    const mostRecent = incidents[0];
    const timeAgo = this.getTimeAgo(new Date(mostRecent.timestamp));
    
    const alertData = {
      type: 'recent-incident',
      zoneId: zone.id,
      zoneName: zone.name,
      incidentCount: incidents.length,
      mostRecentType: mostRecent.type,
      timeAgo: timeAgo,
      location: location,
      severity: mostRecent.severity,
      recommendations: this.generateRecentIncidentRecommendations(zone, incidents)
    };

    this.triggerEnhancedAlert(alertData, 'recent');
    this.alertHistory.add(alertKey);

    setTimeout(() => {
      this.alertHistory.delete(alertKey);
    }, 10 * 60 * 1000);
  }

  private triggerNearbyIncidentAlert(incidents: Array<{ zone: DangerZone; incident: ZoneIncident; distance: number }>, location: { lat: number; lng: number }) {
    const alertKey = `nearby-${Math.floor(Date.now() / 120000)}`;
    
    if (this.alertHistory.has(alertKey)) return;

    const sortedIncidents = incidents.sort((a, b) => a.distance - b.distance);
    const closest = sortedIncidents[0];
    const timeAgo = this.getTimeAgo(new Date(closest.incident.timestamp));

    const alertData = {
      type: 'nearby-incident',
      incidentCount: incidents.length,
      closestZone: closest.zone.name,
      closestDistance: this.formatDistance(closest.distance),
      mostRecentType: closest.incident.type,
      timeAgo: timeAgo,
      location: location,
      severity: closest.incident.severity,
      recommendations: this.generateNearbyIncidentRecommendations(incidents)
    };

    this.triggerEnhancedAlert(alertData, 'nearby');
    this.alertHistory.add(alertKey);

    setTimeout(() => {
      this.alertHistory.delete(alertKey);
    }, 15 * 60 * 1000);
  }

  private triggerEnhancedAlert(alertData: any, alertType: 'recent' | 'nearby') {
    // DISABLED: Alert system is now handled by ZoneNotificationService to avoid duplication
    console.log('🚨 ENHANCED ALERT DISABLED - Using ZoneNotificationService instead:', alertData);
  }

  private triggerEnhancedNotification(title: string, alertData: any) {
    if ('Notification' in window && Notification.permission === 'granted') {
      const body = alertData.type === 'recent' 
        ? `${alertData.incidentCount} recent incident(s) in ${alertData.zoneName}. Last: ${alertData.mostRecentType} (${alertData.timeAgo})`
        : `${alertData.incidentCount} nearby incident(s). Closest: ${alertData.closestZone} (${alertData.closestDistance} away)`;

      new Notification(title, {
        body: body,
        icon: '/assets/icon/favicon.png',
        tag: 'incident-alert',
        requireInteraction: true,
        badge: '/assets/icon/favicon.png'
      });
    }
  }

  private generateRecentIncidentRecommendations(zone: DangerZone, incidents: ZoneIncident[]): string[] {
    const recommendations: string[] = [];
    
    recommendations.push(`🚨 ${incidents.length} recent incident(s) in this area`);
    recommendations.push(`⏰ Last incident: ${this.getTimeAgo(new Date(incidents[0].timestamp))} ago`);
    
    if (incidents.length > 3) {
      recommendations.push('📊 HIGH ACTIVITY: Multiple recent incidents detected');
      recommendations.push('🚶‍♀️ Consider leaving the area immediately');
    } else if (incidents.length > 1) {
      recommendations.push('⚠️ MODERATE ACTIVITY: Stay extra vigilant');
      recommendations.push('📱 Keep emergency contacts accessible');
    }
    
    recommendations.push('👥 Stay in well-lit, populated areas');
    recommendations.push('📞 Have emergency numbers ready');
    
    return recommendations;
  }

  private generateNearbyIncidentRecommendations(incidents: Array<{ zone: DangerZone; incident: ZoneIncident; distance: number }>): string[] {
    const recommendations: string[] = [];
    
    recommendations.push(`⚠️ ${incidents.length} incident(s) reported nearby`);
    recommendations.push(`📍 Closest: ${this.formatDistance(incidents[0].distance)} away`);
    
    const highSeverityCount = incidents.filter(i => i.incident.severity > 7).length;
    if (highSeverityCount > 0) {
      recommendations.push(`🚨 ${highSeverityCount} high-severity incident(s) nearby`);
      recommendations.push('🛡️ Exercise extreme caution');
    }
    
    recommendations.push('🔍 Be aware of your surroundings');
    recommendations.push('📱 Keep your phone accessible');
    recommendations.push('👥 Avoid isolated areas');
    
    return recommendations;
  }

  private calculateZoneCenter(coordinates: [number, number][]): [number, number] {
    const lngSum = coordinates.reduce((sum, coord) => sum + coord[0], 0);
    const latSum = coordinates.reduce((sum, coord) => sum + coord[1], 0);
    return [lngSum / coordinates.length, latSum / coordinates.length];
  }

  private getTimeAgo(timestamp: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} minute(s) ago`;
    if (diffHours < 24) return `${diffHours} hour(s) ago`;
    return `${Math.floor(diffHours / 24)} day(s) ago`;
  }

  private formatDistance(distance: number): string {
    if (distance < 0.001) return 'very close';
    if (distance < 0.005) return 'close by';
    if (distance < 0.01) return 'nearby';
    return `${(distance * 111).toFixed(1)}km away`;
  }

  private shouldTriggerVibration(): boolean {
    return true;
  }

  private shouldTriggerNotification(): boolean {
    return true;
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

  private updateAllZones() {
    try {
      const currentZones = this.zones.value;
      if (!currentZones || currentZones.length === 0) {
        console.log('ZoneDangerEngineService: No zones to update');
        return;
      }
      
      const updatedZones = currentZones.map(zone => {
        const updatedZone = this.calculateZoneDanger(zone);
        return this.updateZoneLevelBasedOnTime(updatedZone);
      });
      
      this.zones.next(updatedZones);
      this.syncToFirestore(updatedZones);
    } catch (error) {
      console.error('ZoneDangerEngineService: Error updating zones:', error);
    }
  }

  private calculateZoneDanger(zone: DangerZone): DangerZone {
    const currentTime = new Date();
    const timeSlotSeverity = this.calculateTimeSlotSeverity(zone, currentTime);
    const incidentSeverity = this.calculateIncidentSeverity(zone, currentTime);
    
    const totalSeverity = (
      timeSlotSeverity * this.weights.timeSlot +
      incidentSeverity * this.weights.frequency +
      incidentSeverity * this.weights.recentness
    );
    
    zone.currentSeverity = Math.min(10, Math.max(0, totalSeverity));
    zone.level = this.classifyDangerLevel(zone.currentSeverity);
    
    return zone;
  }

  private updateZoneLevelBasedOnTime(zone: DangerZone): DangerZone {
    const currentTime = new Date();
    const currentHour = currentTime.getHours();
    
    
    const activeSlot = zone.timeSlots.find(slot => 
      this.isTimeInSlot(currentHour, slot)
    );
    
    if (activeSlot) {
      
      const newLevel = this.getLevelFromSeverity(activeSlot.baseSeverity);
      const oldLevel = zone.level;
      
      if (newLevel !== oldLevel) {
        console.log(`🕐 Time-based zone update: ${zone.name} changed from ${oldLevel} to ${newLevel} (${activeSlot.description})`);
        zone.level = newLevel;
        zone.currentSeverity = activeSlot.baseSeverity;
        
        
        this.triggerTimeBasedZoneChangeAlert(zone, oldLevel, newLevel, activeSlot);
      }
    }
    
    return zone;
  }

  private getLevelFromSeverity(severity: number): 'Safe' | 'Neutral' | 'Caution' | 'Danger' {
    if (severity <= 2) return 'Safe';
    if (severity <= 4) return 'Neutral';
    if (severity <= 7) return 'Caution';
    return 'Danger';
  }

  private triggerTimeBasedZoneChangeAlert(zone: DangerZone, oldLevel: string, newLevel: string, timeSlot: TimeSlot) {
    const currentLocation = this.currentLocation.value;
    if (!currentLocation) return;
    
    
    if (this.isPointInPolygon([currentLocation.lng, currentLocation.lat], zone.coordinates)) {
      const alertKey = `time-change-${zone.id}-${Math.floor(Date.now() / 300000)}`; 
      
      if (this.alertHistory.has(alertKey)) return;
      
      const alertData = {
        type: 'time-based-change',
        zoneId: zone.id,
        zoneName: zone.name,
        oldLevel: oldLevel,
        newLevel: newLevel,
        timeSlot: timeSlot.description,
        currentHour: new Date().getHours(),
        location: currentLocation,
        recommendations: this.generateTimeBasedChangeRecommendations(zone, oldLevel, newLevel, timeSlot)
      };
      
      this.triggerTimeBasedAlert(alertData);
      this.alertHistory.add(alertKey);
      
      setTimeout(() => {
        this.alertHistory.delete(alertKey);
      }, 5 * 60 * 1000);
    }
  }

  private triggerTimeBasedAlert(alertData: any) {
    // DISABLED: Alert system is now handled by ZoneNotificationService to avoid duplication
    console.log('🚨 TIME-BASED ALERT DISABLED - Using ZoneNotificationService instead:', alertData);
  }

  private getLevelEmoji(level: string): string {
    switch (level) {
      case 'Safe': return '🟢';
      case 'Neutral': return '🟡';
      case 'Caution': return '🟠';
      case 'Danger': return '🔴';
      default: return '⚪';
    }
  }

  private getLevelColor(level: string): string {
    switch (level) {
      case 'Safe': return '#10B981';
      case 'Neutral': return '#F59E0B'; 
      case 'Caution': return '#F59E0B'; 
      case 'Danger': return '#EF4444'; 
      default: return '#9E9E9E';
    }
  }

  private triggerTimeBasedNotification(title: string, alertData: any) {
    if ('Notification' in window && Notification.permission === 'granted') {
      const levelEmoji = this.getLevelEmoji(alertData.newLevel);
      const body = `${levelEmoji} ${alertData.zoneName} is now ${alertData.newLevel.toUpperCase()}\n⏰ ${alertData.timeSlot}\n📍 You are currently in this area`;
      
      new Notification(title, {
        body: body,
        icon: '/assets/icon/favicon.png',
        tag: 'time-zone-change',
        requireInteraction: true,
        badge: '/assets/icon/favicon.png'
      });
    }
  }

  private generateTimeBasedChangeRecommendations(zone: DangerZone, oldLevel: string, newLevel: string, timeSlot: TimeSlot): string[] {
    const recommendations: string[] = [];
    
    recommendations.push(`🕐 Time-based change: ${timeSlot.description}`);
    recommendations.push(`${this.getLevelEmoji(newLevel)} Zone level: ${oldLevel} → ${newLevel}`);
    
    if (newLevel === 'Danger') {
      recommendations.push('🚨 HIGH RISK: Consider leaving the area immediately');
      recommendations.push('📱 Keep your panic button accessible');
      recommendations.push('👥 Stay in well-lit, populated areas');
    } else if (newLevel === 'Caution') {
      recommendations.push('⚠️ MODERATE RISK: Stay alert and be cautious');
      recommendations.push('📱 Keep your phone accessible');
      recommendations.push('🔍 Be aware of your surroundings');
    } else if (newLevel === 'Neutral') {
      recommendations.push('🟡 NEUTRAL: Normal vigilance recommended');
      recommendations.push('📱 Stay aware of your surroundings');
    } else {
      recommendations.push('🟢 SAFE: Normal activities can resume');
    }
    
    if (timeSlot.crimeMultiplier > 1.0) {
      recommendations.push(`📊 Crime risk is ${(timeSlot.crimeMultiplier * 100).toFixed(0)}% higher during this time`);
    }
    
    return recommendations;
  }

  private calculateTimeSlotSeverity(zone: DangerZone, currentTime: Date): number {
    const currentHour = currentTime.getHours();
    const activeSlot = zone.timeSlots.find(slot => 
      this.isTimeInSlot(currentHour, slot)
    );
    return activeSlot ? activeSlot.baseSeverity : 0;
  }

  private calculateIncidentSeverity(zone: DangerZone, currentTime: Date): number {
    if (zone.incidents.length === 0) return 0;
    
    const recentIncidents = zone.incidents.filter(incident => {
      const timeDiff = currentTime.getTime() - incident.timestamp.getTime();
      return timeDiff <= 24 * 60 * 60 * 1000;
    });
    
    if (recentIncidents.length === 0) return 0;
    
    const totalSeverity = recentIncidents.reduce((sum, incident) => 
      sum + incident.severity, 0
    );
    
    return Math.min(10, totalSeverity / recentIncidents.length);
  }

  private findZonesContainingLocation(location: { lat: number; lng: number }, zones: DangerZone[]): DangerZone[] {
    return zones.filter(zone => 
      this.isPointInPolygon([location.lng, location.lat], zone.coordinates)
    );
  }

  private isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
    const [x, y] = point;
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  private isTimeInSlot(hour: number, slot: TimeSlot): boolean {
    if (slot.startHour <= slot.endHour) {
      return hour >= slot.startHour && hour <= slot.endHour;
    } else {
      return hour >= slot.startHour || hour <= slot.endHour;
    }
  }

  private classifyDangerLevel(severity: number): 'Safe' | 'Neutral' | 'Caution' | 'Danger' {
    if (severity <= 2) return 'Safe';
    if (severity <= 4) return 'Neutral';
    if (severity <= 7) return 'Caution';
    return 'Danger';
  }

  private mapSeverityToValue(severity: 'low' | 'medium' | 'high'): number {
    switch (severity) {
      case 'low': return 3;
      case 'medium': return 6;
      case 'high': return 9;
      default: return 5;
    }
  }

  private async syncToFirestore(zones: DangerZone[]) {
    console.log('Skipping Firestore sync - zones are derived from validated reports');
  }
}