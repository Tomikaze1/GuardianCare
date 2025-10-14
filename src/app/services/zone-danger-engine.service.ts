import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';
import { ReportService } from './report.service';
import { BehaviorSubject, Observable, interval } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

export interface DangerZone {
  id: string;
  name: string;
  level: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
  riskLevel?: number; // Numeric risk level (1-5) from admin validation
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
  level?: number; // Admin's 1-5 star validation level
  riskLevel?: number; // Auto-calculated risk level from incident type
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
  soundType: 'beep' | 'siren' | 'chime';
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
    // Don't start periodic updates in constructor to avoid injection context issues
    // They will be started when initializeZones() is called
  }

  private startPeriodicUpdates() {
    setInterval(() => this.updateAllZones(), 60 * 60 * 1000);
    setInterval(() => this.checkForAlerts(), 30 * 1000);
  }

  public initializeZones() {
    if (this.isInitialized) {
      console.log('ZoneDangerEngineService: Already initialized, skipping');
      return;
    }

    console.log('ZoneDangerEngineService: Loading validated reports for heatmap...');
    
    // Load validated reports from the report service
    setTimeout(() => {
      this.loadValidatedReportsAsZones();
      this.startPeriodicUpdates();
      this.isInitialized = true;
    }, 1000);
  }

  private loadValidatedReportsAsZones() {
    try {
      // Subscribe to validated reports and convert them to heatmap zones
      this.reportService.getValidatedReports().subscribe({
        next: (validatedReports) => {
          console.log('ZoneDangerEngineService: Validated reports loaded:', validatedReports.length);
          
          if (validatedReports && validatedReports.length > 0) {
            // Convert validated reports to danger zones for heatmap
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
    // Get the risk level set by admin (this is the numeric 1-5 level)
    // Priority: riskLevel (admin's PRIMARY field) > level (compatibility) > validationLevel (legacy)
    const riskLevel = Number(report.riskLevel || report.level || report.validationLevel || 1);
    
    // Debug logging to verify correct level is being used
    console.log(`🔍 convertReportToZone: ${report.locationAddress || report.location?.simplifiedAddress || 'Unknown'}`, {
      reportId: report.id,
      riskLevel: report.riskLevel,
      level: report.level,
      validationLevel: report.validationLevel,
      finalRiskLevel: riskLevel,
      type: report.type,
      status: report.status
    });
    
    // Map risk level to severity (1-5 to 0-10)
    const currentSeverity = (riskLevel / 5) * 10;
    
    // Determine danger level based on risk level
    let level: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
    if (riskLevel <= 1) {
      level = 'Safe';
    } else if (riskLevel <= 2) {
      level = 'Neutral';
    } else if (riskLevel <= 3) {
      level = 'Caution';
    } else {
      level = 'Danger';
    }
    
    // Create a small area around the report location (0.001 degrees ≈ 111 meters)
    const radius = 0.002;
    const lat = report.location.lat;
    const lng = report.location.lng;
    
    return {
      id: report.id || `report-${Date.now()}`,
      name: report.location.simplifiedAddress || report.locationAddress || 'Reported Incident',
      level: level,
      riskLevel: riskLevel, // Store the numeric risk level for heatmap
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
        severity: riskLevel * 2, // Convert 1-5 to 2-10
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
        enablePushNotifications: riskLevel >= 3,
        enableVibration: riskLevel >= 3,
        enableSound: riskLevel >= 4,
        soundType: riskLevel >= 4 ? 'siren' : 'beep',
        vibrationPattern: riskLevel >= 4 ? [200, 100, 200, 100, 200] : [200, 200],
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
        }, Math.pow(2, retryCount) * 100); // Exponential backoff
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

      // Check if we're in a proper injection context before attempting Firebase operations
      try {
        // Test if we can access Firebase without injection context issues
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

      // Use a more robust approach to handle Firebase operations
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
    // No hardcoded zones anymore - heatmap is based purely on validated user reports
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
    const zones = this.zones.value;
    const now = new Date();
    
    const dangerZone = zones.find(z => z.level === 'Danger');
    if (dangerZone) {
      const recentTime = new Date(now.getTime() - 15 * 60 * 1000);
      dangerZone.incidents.push({
        id: 'recent-test-1',
        timestamp: recentTime,
        severity: 8,
        type: 'assault',
        description: 'Recent incident for testing alerts'
      });
    }

    const cautionZone = zones.find(z => z.level === 'Caution');
    if (cautionZone) {
      const nearbyTime = new Date(now.getTime() - 90 * 60 * 1000);
      cautionZone.incidents.push({
        id: 'nearby-test-1',
        timestamp: nearbyTime,
        severity: 6,
        type: 'theft',
        description: 'Nearby incident for testing alerts'
      });
    }

    this.zones.next([...zones]);
    console.log('🧪 Simulated recent incidents for testing');
  }

  public updateCurrentLocation(location: { lat: number; lng: number }) {
    this.currentLocation.next(location);
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
    const alertData = {
      zoneId: zone.id,
      zoneName: zone.name,
      severity: severity,
      timeRisk: timeRisk,
      location: location,
      timestamp: new Date(),
      recommendations: this.generateRecommendations(zone, severity, timeRisk)
    };

    if (zone.alertSettings.enableVibration) {
      this.triggerVibrationAlert(zone.alertSettings.vibrationPattern);
    }
    
    if (zone.alertSettings.enableSound) {
      this.triggerSoundAlert(zone.alertSettings.soundType);
    }
    
    if (zone.alertSettings.enablePushNotifications) {
      this.triggerPushNotification(alertData);
    }

    console.log('🚨 SMART ALERT TRIGGERED:', alertData);
  }

  private triggerVibrationAlert(pattern: number[]) {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }

  private triggerSoundAlert(soundType: 'beep' | 'siren' | 'chime') {
    // Disable sounds in localhost/development environment
    const isLocalhost = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1' ||
                       window.location.hostname.includes('localhost');
    
    if (isLocalhost) {
      console.log('🔕 Zone danger sound disabled in localhost environment:', soundType);
      return;
    }
    
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    switch (soundType) {
      case 'beep':
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
        break;
      case 'siren':
        
        const startTime = audioContext.currentTime;
        const duration = 2.0; 
        const pulseDuration = 0.5; 
        
        
        for (let i = 0; i < duration / pulseDuration; i++) {
          const pulseStart = startTime + (i * pulseDuration);
          
          
          oscillator.frequency.setValueAtTime(800, pulseStart);
          oscillator.frequency.setValueAtTime(600, pulseStart + 0.1);
          oscillator.frequency.setValueAtTime(800, pulseStart + 0.2);
          oscillator.frequency.setValueAtTime(600, pulseStart + 0.3);
          oscillator.frequency.setValueAtTime(800, pulseStart + 0.4);
          
          
          gainNode.gain.setValueAtTime(0, pulseStart);
          gainNode.gain.linearRampToValueAtTime(0.4, pulseStart + 0.05);
          gainNode.gain.linearRampToValueAtTime(0, pulseStart + 0.45);
        }
        
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
        return; 
        break;
      case 'chime':
        oscillator.frequency.setValueAtTime(523, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(659, audioContext.currentTime + 0.1);
        oscillator.frequency.setValueAtTime(784, audioContext.currentTime + 0.2);
        break;
    }
    
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  }

  private triggerPushNotification(alertData: any) {
    // Disable push notifications in localhost/development environment
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
    const isRecent = alertType === 'recent';
    const title = isRecent ? '🚨 RECENT INCIDENT ALERT' : '⚠️ NEARBY INCIDENT WARNING';
    
    const vibrationPattern = isRecent ? [300, 100, 300, 100, 300, 100, 300] : [200, 100, 200, 100, 200];
    
    const soundType = isRecent ? 'siren' : 'beep';

    if (this.shouldTriggerVibration()) {
      this.triggerVibrationAlert(vibrationPattern);
    }
    
    // Trigger sound for all incidents (risk levels 1-5)
    if (this.shouldTriggerSound()) {
      this.triggerSoundAlert(soundType);
    }
    
    if (this.shouldTriggerNotification()) {
      this.triggerEnhancedNotification(title, alertData);
    }

    console.log(`🚨 ${title}:`, alertData);
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

  private shouldTriggerSound(): boolean {
    // Only allow sound for high-risk scenarios
    // This method is used for nearby incidents and time-based alerts
    // Sound should be limited to the most critical situations
    return true; // Keep true for now, but individual methods can override with more specific logic
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
    const title = `🕐 ZONE LEVEL CHANGE: ${alertData.zoneName}`;
    const levelEmoji = this.getLevelEmoji(alertData.newLevel);
    const levelColor = this.getLevelColor(alertData.newLevel);
    
    const vibrationPattern = alertData.newLevel === 'Danger' ? [300, 100, 300, 100, 300] : [200, 200];
    const soundType = alertData.newLevel === 'Danger' ? 'siren' : 'beep';
    
    if (this.shouldTriggerVibration()) {
      this.triggerVibrationAlert(vibrationPattern);
    }
    
    if (this.shouldTriggerSound()) {
      this.triggerSoundAlert(soundType);
    }
    
    if (this.shouldTriggerNotification()) {
      this.triggerTimeBasedNotification(title, alertData);
    }
    
    console.log(`🕐 ${title}: ${alertData.oldLevel} → ${alertData.newLevel} (${alertData.timeSlot})`);
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
      case 'Safe': return '#10B981'; // Emerald-500
      case 'Neutral': return '#F59E0B'; // Amber-500
      case 'Caution': return '#F59E0B'; // Amber-500
      case 'Danger': return '#EF4444'; // Red-500
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
    // No longer syncing zones to Firestore - zones are now read-only from validated reports
    // This prevents injection context errors and is not needed for the new system
    console.log('Skipping Firestore sync - zones are derived from validated reports');
  }
}