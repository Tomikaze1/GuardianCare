import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { NotificationService } from '../shared/services/notification.service';
import { ZoneDangerEngineService, DangerZone } from './zone-danger-engine.service';

export interface ZoneAlert {
  id: string;
  type: 'zone_entry' | 'zone_exit' | 'zone_level_change' | 'nearby_zone';
  zoneId: string;
  zoneName: string;
  zoneLevel: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
  riskLevel: number;
  message: string;
  recommendations: string[];
  timestamp: Date;
  location: { lat: number; lng: number };
  distance?: number;
  isActive: boolean;
}

export interface ZoneNotificationSettings {
  enableZoneEntryAlerts: boolean;
  enableZoneExitAlerts: boolean;
  enableLevelChangeAlerts: boolean;
  enableNearbyZoneAlerts: boolean;
  enableVibration: boolean;
  enableSound: boolean;
  enablePushNotifications: boolean;
  alertRadius: number; 
  cooldownPeriod: number; 
  minimumRiskLevel: number; 
}

@Injectable({
  providedIn: 'root'
})
export class ZoneNotificationService {
  private activeAlerts = new BehaviorSubject<ZoneAlert[]>([]);
  public activeAlerts$ = this.activeAlerts.asObservable();
  
  private currentZone: DangerZone | null = null;
  private previousZone: DangerZone | null = null;
  private lastNotificationTime: number = 0;
  private alertHistory: Set<string> = new Set();
  
  private defaultSettings: ZoneNotificationSettings = {
    enableZoneEntryAlerts: true,
    enableZoneExitAlerts: true,
    enableLevelChangeAlerts: true,
    enableNearbyZoneAlerts: true,
    enableVibration: true,
    enableSound: true,
    enablePushNotifications: true,
    alertRadius: 25, // Optimized for walking detection - 25 meters provides better precision for pedestrians 
    cooldownPeriod: 5, 
    minimumRiskLevel: 2 
  };
  
  private settings: ZoneNotificationSettings = { ...this.defaultSettings };

  constructor(
    private notificationService: NotificationService,
    private zoneEngine: ZoneDangerEngineService
  ) {
    this.loadSettings();
  }


  checkZoneEntry(location: { lat: number; lng: number }): void {
    this.zoneEngine.zones$.pipe(take(1)).subscribe(zones => {
      const currentZone = this.findZoneAtLocation(location, zones);
      
      // Debug logging for zone detection
      console.log(`🔍 Checking zone entry at location:`, location, `Found zone:`, currentZone?.name || 'None');
    
      if (currentZone && currentZone !== this.currentZone) {
        console.log(`📍 Zone entry detected! User moved into:`, currentZone.name, `(Level: ${currentZone.level})`);
        this.previousZone = this.currentZone;
        this.currentZone = currentZone;
        
        if (this.shouldTriggerAlert('zone_entry', currentZone)) {
          this.triggerZoneEntryAlert(currentZone, location);
        } else {
          console.log(`⏸️ Zone entry alert skipped due to cooldown or settings`);
        }
      }
      
      if (this.currentZone && !currentZone) {
        if (this.shouldTriggerAlert('zone_exit', this.currentZone)) {
          this.triggerZoneExitAlert(this.currentZone, location);
        }
        this.previousZone = this.currentZone;
        this.currentZone = null;
      }
      
      this.checkNearbyZones(location, zones);
    });
  }

  checkZoneLevelChanges(): void {
    if (!this.currentZone) return;
    
    this.zoneEngine.zones$.pipe(take(1)).subscribe(zones => {
      const updatedZone = zones.find((z: DangerZone) => z.id === this.currentZone!.id);
      
      if (updatedZone && this.currentZone && updatedZone.level !== this.currentZone.level) {
        const oldLevel = this.currentZone.level;
        this.currentZone = updatedZone;
        
        if (this.shouldTriggerAlert('zone_level_change', updatedZone)) {
          this.triggerZoneLevelChangeAlert(updatedZone, oldLevel);
        }
      }
    });
  }

  updateSettings(settings: Partial<ZoneNotificationSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.saveSettings();
  }


  getSettings(): ZoneNotificationSettings {
    return { ...this.settings };
  }

  resetSettings(): void {
    this.settings = { ...this.defaultSettings };
    this.saveSettings();
  }


  getCurrentZone(): DangerZone | null {
    return this.currentZone;
  }


  getActiveAlerts(): ZoneAlert[] {
    return this.activeAlerts.value;
  }

  dismissAlert(alertId: string): void {
    const alerts = this.activeAlerts.value.filter(alert => alert.id !== alertId);
    this.activeAlerts.next(alerts);
  }

  dismissAllAlerts(): void {
    this.activeAlerts.next([]);
  }

  private findZoneAtLocation(location: { lat: number; lng: number }, zones: DangerZone[]): DangerZone | null {
    return zones.find(zone => this.isPointInPolygon([location.lng, location.lat], zone.coordinates)) || null;
  }

  private checkNearbyZones(location: { lat: number; lng: number }, zones: DangerZone[]): void {
    const nearbyZones = zones.filter(zone => {
      const distance = this.calculateDistanceToZone(location, zone);
      return distance <= this.settings.alertRadius && zone !== this.currentZone;
    });

    nearbyZones.forEach(zone => {
      if (this.shouldTriggerAlert('nearby_zone', zone)) {
        this.triggerNearbyZoneAlert(zone, location);
      }
    });
  }

  private calculateDistanceToZone(location: { lat: number; lng: number }, zone: DangerZone): number {
    const zoneCenter = this.calculateZoneCenter(zone.coordinates);
    return this.calculateDistance(
      location.lat, location.lng,
      zoneCenter[1], zoneCenter[0]
    );
  }

  private calculateZoneCenter(coordinates: [number, number][]): [number, number] {
    const lngSum = coordinates.reduce((sum, coord) => sum + coord[0], 0);
    const latSum = coordinates.reduce((sum, coord) => sum + coord[1], 0);
    return [lngSum / coordinates.length, latSum / coordinates.length];
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
    return R * c * 1000; 
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI/180);
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

  private shouldTriggerAlert(type: string, zone: DangerZone): boolean {
    if (zone.level === 'Safe') {
      return false;
    }

    if (zone.riskLevel && zone.riskLevel < this.settings.minimumRiskLevel) {
      return false;
    }

    const now = Date.now();
    // Use shorter cooldown for zone entry alerts to ensure immediate response
    const cooldownMs = type === 'zone_entry' ? 30 * 1000 : this.settings.cooldownPeriod * 60 * 1000; // 30 seconds for entry, 5 minutes for others
    
    if (type !== 'zone_entry' && now - this.lastNotificationTime < cooldownMs) {
      return false;
    }

    const alertKey = `${type}-${zone.id}-${Math.floor(now / (cooldownMs))}`;
    if (this.alertHistory.has(alertKey)) {
      return false;
    }

    switch (type) {
      case 'zone_entry':
        return this.settings.enableZoneEntryAlerts;
      case 'zone_exit':
        return this.settings.enableZoneExitAlerts;
      case 'zone_level_change':
        return this.settings.enableLevelChangeAlerts;
      case 'nearby_zone':
        return this.settings.enableNearbyZoneAlerts;
      default:
        return false;
    }
  }

  private triggerZoneEntryAlert(zone: DangerZone, location: { lat: number; lng: number }): void {
    console.log(`🚨 ZONE ENTRY DETECTED: User entered ${zone.name} (${zone.level} zone) at location:`, location);
    console.log(`📍 Zone coordinates:`, zone.coordinates);
    
    const alert: ZoneAlert = {
      id: `entry-${zone.id}-${Date.now()}`,
      type: 'zone_entry',
      zoneId: zone.id,
      zoneName: zone.name,
      zoneLevel: zone.level,
      riskLevel: zone.riskLevel || 1,
      message: this.generateZoneEntryMessage(zone),
      recommendations: this.generateZoneRecommendations(zone),
      timestamp: new Date(),
      location: location,
      isActive: true
    };

    this.addAlert(alert);
    this.triggerNotification(alert);
    this.recordAlertHistory(alert);
  }

  private triggerZoneExitAlert(zone: DangerZone, location: { lat: number; lng: number }): void {
    const alert: ZoneAlert = {
      id: `exit-${zone.id}-${Date.now()}`,
      type: 'zone_exit',
      zoneId: zone.id,
      zoneName: zone.name,
      zoneLevel: zone.level,
      riskLevel: zone.riskLevel || 1,
      message: this.generateZoneExitMessage(zone),
      recommendations: this.generateZoneExitRecommendations(zone),
      timestamp: new Date(),
      location: location,
      isActive: true
    };

    this.addAlert(alert);
    this.triggerNotification(alert);
    this.recordAlertHistory(alert);
  }

  private triggerZoneLevelChangeAlert(zone: DangerZone, oldLevel: string): void {
    const alert: ZoneAlert = {
      id: `level-change-${zone.id}-${Date.now()}`,
      type: 'zone_level_change',
      zoneId: zone.id,
      zoneName: zone.name,
      zoneLevel: zone.level,
      riskLevel: zone.riskLevel || 1,
      message: this.generateZoneLevelChangeMessage(zone, oldLevel),
      recommendations: this.generateZoneRecommendations(zone),
      timestamp: new Date(),
      location: { lat: 0, lng: 0 }, 
      isActive: true
    };

    this.addAlert(alert);
    this.triggerNotification(alert);
    this.recordAlertHistory(alert);
  }

  private triggerNearbyZoneAlert(zone: DangerZone, location: { lat: number; lng: number }): void {
    const distance = this.calculateDistanceToZone(location, zone);
    
    const alert: ZoneAlert = {
      id: `nearby-${zone.id}-${Date.now()}`,
      type: 'nearby_zone',
      zoneId: zone.id,
      zoneName: zone.name,
      zoneLevel: zone.level,
      riskLevel: zone.riskLevel || 1,
      message: this.generateNearbyZoneMessage(zone, distance),
      recommendations: this.generateNearbyZoneRecommendations(zone, distance),
      timestamp: new Date(),
      location: location,
      distance: distance,
      isActive: true
    };

    this.addAlert(alert);
    this.triggerNotification(alert);
    this.recordAlertHistory(alert);
  }

  private generateZoneEntryMessage(zone: DangerZone): string {
    const riskLevel = zone.riskLevel || 1;
    const heatmapEmoji = this.getHeatmapEmojiForRiskLevel(riskLevel);
    const riskText = this.getRiskText(riskLevel);
    const heatmapColor = this.getHeatmapColorForRiskLevel(riskLevel);
    
    return `${heatmapEmoji} You have entered ${zone.name}\nHeatmap Color: ${heatmapColor} | Risk Level: ${riskText} (Level ${riskLevel})`;
  }

  private generateZoneExitMessage(zone: DangerZone): string {
    const levelEmoji = this.getLevelEmoji(zone.level);
    
    return `${levelEmoji} You have left ${zone.name}\nZone Level: ${zone.level}`;
  }

  private generateZoneLevelChangeMessage(zone: DangerZone, oldLevel: string): string {
    const levelEmoji = this.getLevelEmoji(zone.level);
    
    return `${levelEmoji} Zone level changed in ${zone.name}\n${oldLevel} → ${zone.level}`;
  }

  private generateNearbyZoneMessage(zone: DangerZone, distance: number): string {
    const levelEmoji = this.getLevelEmoji(zone.level);
    const distanceText = distance < 1000 ? `${Math.round(distance)}m` : `${(distance/1000).toFixed(1)}km`;
    
    return `${levelEmoji} High-risk zone nearby: ${zone.name}\nDistance: ${distanceText} | Level: ${zone.level}`;
  }

  private generateZoneRecommendations(zone: DangerZone): string[] {
    const recommendations: string[] = [];
    
    switch (zone.level) {
      case 'Danger':
        recommendations.push('🚨 HIGH RISK: Consider leaving immediately');
        recommendations.push('📱 Keep emergency contacts accessible');
        recommendations.push('👥 Stay in well-lit, populated areas');
        recommendations.push('🚶‍♀️ Avoid isolated areas');
        break;
      case 'Caution':
        recommendations.push('⚠️ MODERATE RISK: Stay alert and cautious');
        recommendations.push('📱 Keep your phone accessible');
        recommendations.push('🔍 Be aware of your surroundings');
        recommendations.push('👥 Stay near other people when possible');
        break;
      case 'Neutral':
        recommendations.push('🟡 NEUTRAL: Normal vigilance recommended');
        recommendations.push('📱 Stay aware of your surroundings');
        recommendations.push('🔍 Be observant of unusual activity');
        break;
      case 'Safe':
        recommendations.push('🟢 SAFE: Normal activities can resume');
        recommendations.push('📱 Continue to stay aware');
        break;
    }
    
    if (zone.riskLevel && zone.riskLevel >= 4) {
      recommendations.push('🚨 Multiple incidents reported in this area');
    }
    
    return recommendations;
  }

  private generateZoneExitRecommendations(zone: DangerZone): string[] {
    const recommendations: string[] = [];
    
    if (zone.level === 'Danger' || zone.level === 'Caution') {
      recommendations.push('✅ You have left a high-risk area');
      recommendations.push('📱 Continue to stay alert');
      recommendations.push('🔍 Be aware of your surroundings');
    } else {
      recommendations.push('✅ You have left the zone');
      recommendations.push('📱 Stay aware of your surroundings');
    }
    
    return recommendations;
  }

  private generateNearbyZoneRecommendations(zone: DangerZone, distance: number): string[] {
    const recommendations: string[] = [];
    
    recommendations.push(`⚠️ High-risk zone ${Math.round(distance)}m away`);
    
    if (zone.level === 'Danger') {
      recommendations.push('🚨 EXTREME CAUTION: Very dangerous area nearby');
      recommendations.push('📱 Keep emergency contacts ready');
      recommendations.push('👥 Stay in populated areas');
      recommendations.push('🚶‍♀️ Avoid walking alone');
    } else if (zone.level === 'Caution') {
      recommendations.push('⚠️ MODERATE CAUTION: Risky area nearby');
      recommendations.push('📱 Keep your phone accessible');
      recommendations.push('🔍 Be extra vigilant');
    }
    
    recommendations.push('📱 Stay aware of your surroundings');
    recommendations.push('🔍 Be observant of unusual activity');
    
    return recommendations;
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

  private getRiskText(riskLevel: number): string {
    switch (riskLevel) {
      case 1: return 'Very Low';
      case 2: return 'Low';
      case 3: return 'Moderate';
      case 4: return 'High';
      case 5: return 'Very High';
      default: return 'Unknown';
    }
  }

  private getLevelColor(level: string): string {
    switch (level) {
      case 'Safe': return 'Green';
      case 'Neutral': return 'Yellow';
      case 'Caution': return 'Orange';
      case 'Danger': return 'Red';
      default: return 'Unknown';
    }
  }

  private getHeatmapColorForRiskLevel(riskLevel: number): string {
    switch (riskLevel) {
      case 1: return 'Green (Low)';
      case 2: return 'Yellow (Moderate)';
      case 3: return 'Orange (High)';
      case 4: return 'Red (Critical)';
      case 5: return 'Dark Red (Extreme)';
      default: return 'Unknown';
    }
  }

  private getHeatmapEmojiForRiskLevel(riskLevel: number): string {
    switch (riskLevel) {
      case 1: return '🟢'; // Green - matches heatmap level-1
      case 2: return '🟡'; // Yellow - matches heatmap level-2  
      case 3: return '🟠'; // Orange - matches heatmap level-3
      case 4: return '🔴'; // Red - matches heatmap level-4
      case 5: return '⛑️'; // Dark Red/Extreme - matches heatmap level-5
      default: return '⚪';
    }
  }

  private addAlert(alert: ZoneAlert): void {
    const alerts = [...this.activeAlerts.value, alert];
    this.activeAlerts.next(alerts);
  }

  private triggerNotification(alert: ZoneAlert): void {
    this.lastNotificationTime = Date.now();
    

    if (this.settings.enableVibration) {
      this.triggerVibration(alert.zoneLevel);
    }
    
    if (this.settings.enableSound) {
      this.triggerSound(alert.zoneLevel);
    }
    
    this.showNotificationBanner(alert);
    
    if (this.settings.enablePushNotifications) {
      this.triggerPushNotification(alert);
    }
  }

  private triggerVibration(level: string): void {
    if ('vibrate' in navigator) {
      let pattern: number[];
      
      switch (level) {
        case 'Danger':
          pattern = [300, 100, 300, 100, 300, 100, 300];
          break;
        case 'Caution':
          pattern = [200, 100, 200, 100, 200];
          break;
        case 'Neutral':
          pattern = [200, 200];
          break;
        default:
          pattern = [100];
      }
      
      navigator.vibrate(pattern);
    }
  }

  private triggerSound(level: string): void {

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      let frequency: number;
      let duration: number;
      
      switch (level) {
        case 'Safe':
          frequency = 400;
          duration = 0.2;
          break;
        case 'Neutral':
          frequency = 500;
          duration = 0.3;
          break;
        case 'Caution':
          frequency = 600;
          duration = 0.4;
          break;
        case 'Danger':
          frequency = 800;
          duration = 0.5;
          break;
        default:
          frequency = 400;
          duration = 0.2;
      }
      
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + duration);
      
      console.log(`🔊 Zone ${level} sound alert triggered (risk level 1-5)`);
    } catch (error) {
      console.warn('Could not play sound:', error);
    }
  }

  private showNotificationBanner(alert: ZoneAlert): void {
    const riskLevel = alert.riskLevel || 1;
    const notificationType = alert.type === 'zone_entry' 
      ? this.getNotificationTypeForRiskLevel(riskLevel)
      : this.getNotificationType(alert.zoneLevel);
    const heatmapEmoji = alert.type === 'zone_entry' 
      ? this.getHeatmapEmojiForRiskLevel(riskLevel)
      : this.getLevelEmoji(alert.zoneLevel);
    const heatmapColor = alert.type === 'zone_entry' 
      ? this.getHeatmapColorForRiskLevel(riskLevel)
      : this.getLevelColor(alert.zoneLevel);
    
    const title = alert.type === 'zone_entry' 
      ? `${heatmapEmoji} ENTERED LEVEL ${riskLevel} ZONE (${heatmapColor})`
      : this.getAlertTitle(alert.type);
    
    this.notificationService.show({
      type: notificationType,
      title: title,
      message: alert.message,
      actionText: 'View Details',
      duration: alert.type === 'zone_entry' ? 10000 : 8000 // Longer duration for entry alerts
    });
  }

  private triggerPushNotification(alert: ZoneAlert): void {
    if ('Notification' in window && Notification.permission === 'granted') {
      const title = this.getAlertTitle(alert.type);
      const body = alert.message;
      
      new Notification(title, {
        body: body,
        icon: '/assets/icon/favicon.png',
        tag: 'zone-alert',
        requireInteraction: true,
        badge: '/assets/icon/favicon.png'
      });
    }
  }

  private getNotificationType(level: string): 'success' | 'warning' | 'error' | 'info' {
    switch (level) {
      case 'Danger': return 'error';
      case 'Caution': return 'warning';
      case 'Neutral': return 'info';
      case 'Safe': return 'success';
      default: return 'info';
    }
  }

  private getNotificationTypeForRiskLevel(riskLevel: number): 'success' | 'warning' | 'error' | 'info' {
    switch (riskLevel) {
      case 1: return 'success';  // Green - Low risk
      case 2: return 'info';     // Yellow - Moderate risk  
      case 3: return 'warning';  // Orange - High risk
      case 4: return 'error';    // Red - Critical risk
      case 5: return 'error';    // Dark Red - Extreme risk
      default: return 'info';
    }
  }

  private getAlertTitle(type: string): string {
    switch (type) {
      case 'zone_entry': return '🚨 Zone Entry Alert';
      case 'zone_exit': return '✅ Zone Exit Alert';
      case 'zone_level_change': return '🔄 Zone Level Change';
      case 'nearby_zone': return '⚠️ Nearby Zone Alert';
      default: return '📍 Zone Alert';
    }
  }

  private recordAlertHistory(alert: ZoneAlert): void {
    const alertKey = `${alert.type}-${alert.zoneId}-${Math.floor(Date.now() / (this.settings.cooldownPeriod * 60 * 1000))}`;
    this.alertHistory.add(alertKey);
    

    setTimeout(() => {
      this.alertHistory.delete(alertKey);
    }, this.settings.cooldownPeriod * 60 * 1000 * 2);
  }

  private loadSettings(): void {
    try {
      const saved = localStorage.getItem('zoneNotificationSettings');
      if (saved) {
        this.settings = { ...this.defaultSettings, ...JSON.parse(saved) };
      }
    } catch (error) {
      console.warn('Could not load zone notification settings:', error);
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem('zoneNotificationSettings', JSON.stringify(this.settings));
    } catch (error) {
      console.warn('Could not save zone notification settings:', error);
    }
  }
}
