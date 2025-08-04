import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';
import { BehaviorSubject, Observable, interval } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

export interface DangerZone {
  id: string;
  name: string;
  level: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
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

  constructor(private firebaseService: FirebaseService) {
    this.startPeriodicUpdates();
  }

  private startPeriodicUpdates() {
    setInterval(() => this.updateAllZones(), 60 * 60 * 1000);
    setInterval(() => this.checkForAlerts(), 30 * 1000);
  }

  public initializeZones() {
    this.loadZones();
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
          console.error('ZoneDangerEngineService: Error loading zones:', error);
          this.loadFallbackZones();
        }
      });
    } catch (error) {
      console.error('ZoneDangerEngineService: Error in loadZones:', error);
      this.loadFallbackZones();
    }
  }

  private loadFallbackZones() {
    const fallbackZones: DangerZone[] = [
      {
        id: 'guadalupe-danger-zone',
        name: 'Guadalupe Danger Zone',
        level: 'Danger',
        coordinates: [[123.895, 10.315], [123.905, 10.315], [123.905, 10.325], [123.895, 10.325], [123.895, 10.315]],
        timeSlots: [],
        incidents: [],
        currentSeverity: 9,
        crimeFrequency: { daily: 8, weekly: 45, monthly: 180, peakHours: [22, 23, 0, 1, 2], peakDays: [5, 6] },
        timeBasedRisk: { morning: 0.6, afternoon: 0.7, evening: 0.8, night: 0.9, weekend: 0.9, weekday: 0.7 },
        alertSettings: { enablePushNotifications: true, enableVibration: true, enableSound: true, soundType: 'siren', vibrationPattern: [200, 100, 200, 100, 200], alertThreshold: 6 }
      },
      {
        id: 'mabolo-caution-zone',
        name: 'Mabolo Caution Zone',
        level: 'Caution',
        coordinates: [[123.910, 10.320], [123.920, 10.320], [123.920, 10.330], [123.910, 10.330], [123.910, 10.320]],
        timeSlots: [],
        incidents: [],
        currentSeverity: 7,
        crimeFrequency: { daily: 4, weekly: 25, monthly: 100, peakHours: [18, 19, 20, 21], peakDays: [4, 5] },
        timeBasedRisk: { morning: 0.4, afternoon: 0.5, evening: 0.7, night: 0.8, weekend: 0.8, weekday: 0.6 },
        alertSettings: { enablePushNotifications: true, enableVibration: true, enableSound: true, soundType: 'beep', vibrationPattern: [200, 200], alertThreshold: 7 }
      },
      {
        id: 'lahug-neutral-zone',
        name: 'Lahug Neutral Zone',
        level: 'Neutral',
        coordinates: [[123.880, 10.325], [123.890, 10.325], [123.890, 10.335], [123.880, 10.335], [123.880, 10.325]],
        timeSlots: [],
        incidents: [],
        currentSeverity: 4,
        crimeFrequency: { daily: 2, weekly: 12, monthly: 50, peakHours: [20, 21, 22], peakDays: [5, 6] },
        timeBasedRisk: { morning: 0.2, afternoon: 0.3, evening: 0.4, night: 0.5, weekend: 0.5, weekday: 0.3 },
        alertSettings: { enablePushNotifications: false, enableVibration: false, enableSound: false, soundType: 'chime', vibrationPattern: [100], alertThreshold: 8 }
      },
      {
        id: 'ayala-safe-zone',
        name: 'Ayala Center Cebu Safe Zone',
        level: 'Safe',
        coordinates: [[123.925, 10.305], [123.935, 10.305], [123.935, 10.315], [123.925, 10.315], [123.925, 10.305]],
        timeSlots: [],
        incidents: [],
        currentSeverity: 1,
        crimeFrequency: { daily: 0, weekly: 1, monthly: 5, peakHours: [], peakDays: [] },
        timeBasedRisk: { morning: 0.1, afternoon: 0.1, evening: 0.2, night: 0.3, weekend: 0.2, weekday: 0.1 },
        alertSettings: { enablePushNotifications: false, enableVibration: false, enableSound: false, soundType: 'chime', vibrationPattern: [50], alertThreshold: 9 }
      },
      {
        id: 'sm-city-safe-zone',
        name: 'SM City Cebu Safe Zone',
        level: 'Safe',
        coordinates: [[123.870, 10.300], [123.880, 10.300], [123.880, 10.310], [123.870, 10.310], [123.870, 10.300]],
        timeSlots: [],
        incidents: [],
        currentSeverity: 1,
        crimeFrequency: { daily: 0, weekly: 1, monthly: 5, peakHours: [], peakDays: [] },
        timeBasedRisk: { morning: 0.1, afternoon: 0.1, evening: 0.2, night: 0.3, weekend: 0.2, weekday: 0.1 },
        alertSettings: { enablePushNotifications: false, enableVibration: false, enableSound: false, soundType: 'chime', vibrationPattern: [50], alertThreshold: 9 }
      },
      {
        id: 'talamban-safe-zone',
        name: 'Talamban Safe Zone',
        level: 'Safe',
        coordinates: [[123.840, 10.340], [123.850, 10.340], [123.850, 10.350], [123.840, 10.350], [123.840, 10.340]],
        timeSlots: [],
        incidents: [],
        currentSeverity: 1,
        crimeFrequency: { daily: 0, weekly: 1, monthly: 2, peakHours: [], peakDays: [] },
        timeBasedRisk: { morning: 0.1, afternoon: 0.1, evening: 0.2, night: 0.3, weekend: 0.2, weekday: 0.1 },
        alertSettings: { enablePushNotifications: false, enableVibration: false, enableSound: false, soundType: 'chime', vibrationPattern: [50], alertThreshold: 9 }
      }
    ];
    
    console.log('ZoneDangerEngineService: Loading fallback zones:', fallbackZones.length);
    this.zones.next(fallbackZones);
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
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(400, audioContext.currentTime + 0.2);
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
      
      const updatedZones = currentZones.map(zone => 
        this.calculateZoneDanger(zone)
      );
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
    const firestore = this.firebaseService.getFirestoreInstance();
    
    for (const zone of zones) {
      try {
        await firestore.collection('dangerZones').doc(zone.id).update({
          level: zone.level,
          currentSeverity: zone.currentSeverity,
          incidents: zone.incidents
        });
      } catch (error) {
        console.error(`Error updating zone ${zone.id}:`, error);
      }
    }
  }
}