import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { NotificationService } from '../shared/services/notification.service';
import { ZoneDangerEngineService, DangerZone } from './zone-danger-engine.service';
import { ReportService } from './report.service';

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
  private currentAlertAudio: HTMLAudioElement | null = null;
  private acknowledgedZones: Set<string> = new Set(); // Legacy - kept for compatibility
  private lastZoneCheckTime: number = 0; // Debounce rapid zone checks
  private currentEntryAcknowledged: boolean = false; // Track if current zone entry alert was acknowledged
  private acknowledgedZoneEntryId: string | null = null; // Track which zone entry was acknowledged
  private activeDialogForZoneId: string | null = null; // Track which zone currently has an alert dialog showing
  private lastZoneEntryTime: number = 0; // Track when we last entered a zone to prevent rapid duplicate alerts
  
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
    minimumRiskLevel: 1 // Changed from 2 to 1 to include green/low risk zones
  };
  
  private settings: ZoneNotificationSettings = { ...this.defaultSettings };

  constructor(
    private notificationService: NotificationService,
    private zoneEngine: ZoneDangerEngineService,
    private reportService: ReportService
  ) {
    this.loadSettings();
    this.clearExistingUIElements();
  }


  checkZoneEntry(location: { lat: number; lng: number }): void {
    // NO DELAY - Check immediately for instant response
    const now = Date.now();
    this.lastZoneCheckTime = now;
    
    // Detection radius constants - increased for practical detection
    const heatmapRadius = 50; // 50 meters radius (reasonable detection distance)
    const detectionRadius = heatmapRadius; // Keep in meters since calculateDistance returns meters
    
    // Get validated reports directly from report service (same data used for heatmap)
    this.reportService.getValidatedReports().pipe(take(1)).subscribe(validatedReports => {
      console.log(`🔍 Zone detection: Checking ${validatedReports.length} validated reports for heatmap zones`);
      
      const currentZone = this.findHeatmapZoneAtLocation(location, validatedReports);
      
      // Debug logging for zone detection
      console.log(`🔍 Checking heatmap zone entry at location:`, location, `Found zone:`, currentZone?.name || 'None');
      console.log(`🔍 Zone detection details:`, {
        userLocation: location,
        validatedReportsCount: validatedReports.length,
        currentZone: currentZone,
        detectionRadius: detectionRadius + 'm',
        enableSound: this.settings.enableSound,
        minimumRiskLevel: this.settings.minimumRiskLevel
      });
    
      // SCENARIO 1: User entered a NEW zone (check by zone ID, not object reference)
      const isNewZone = currentZone && (!this.currentZone || this.currentZone.id !== currentZone.id);
      
      if (isNewZone) {
        console.log(`📍 Heatmap zone entry detected! User moved into:`, currentZone.name, `(Risk Level: ${currentZone.riskLevel})`);
        console.log(`📍 Zone ID: ${currentZone.id}, Previous zone: ${this.previousZone?.name || 'none'}`);
        
        // No debounce - allow immediate alert on zone entry
        const now = Date.now();
        this.lastZoneEntryTime = now;
        
        // Clear previous zone
        this.previousZone = this.currentZone;
        this.currentZone = currentZone;
        
        // Reset acknowledgment state for new zone entry
        this.currentEntryAcknowledged = false;
        this.acknowledgedZoneEntryId = null;
        console.log(`🔄 State reset - entryAcknowledged: ${this.currentEntryAcknowledged}, zoneId: ${this.acknowledgedZoneEntryId}`);
        
        // Start ringing the Guardian Care ringtone (will loop continuously)
        if (this.settings.enableSound && this.shouldPlayRingtoneForZone(currentZone)) {
          console.log(`🔊 Starting Guardian Care ringtone loop for zone: ${currentZone.name} (Risk Level: ${currentZone.riskLevel})`);
          this.playRingtoneAlertInternal(currentZone.level);
        }
        
        // ALWAYS show alert dialog for new zone entry
        console.log(`🚨 Showing alert dialog for NEW zone entry: ${currentZone.name}`);
        this.triggerZoneEntryAlert(currentZone, location);
      }
      
      // SCENARIO 2: User is STILL in the SAME zone
      else if (this.currentZone && currentZone && this.currentZone.id === currentZone.id) {
        // User is still in the same zone - ensure ringtone continues looping
        if (!this.isRingtonePlaying() && this.shouldPlayRingtoneForZone(currentZone)) {
          console.log(`🔊 Restarting ringtone loop for continued presence in: ${currentZone.name}`);
          this.playRingtoneAlertInternal(currentZone.level);
        }
        // Ringtone should already be looping, so just return
        return;
      }
      
      // SCENARIO 3: User EXITED the current zone
      else if (this.currentZone && !currentZone) {
        console.log(`📍 Heatmap zone exit detected! User left: ${this.currentZone.name}`);
        
        // STOP ringtone IMMEDIATELY when user exits zone
        this.stopRingtone();
        console.log(`🔕 Ringtone stopped IMMEDIATELY - user exited ${this.currentZone.name}`);
        
        // Reset acknowledgment state for next zone entry
        this.currentEntryAcknowledged = false;
        this.acknowledgedZoneEntryId = null;
        this.activeDialogForZoneId = null; // Clear active dialog marker
        console.log(`🔄 Reset acknowledgment state - ready for next zone entry`);
        
        // Ready for next zone entry
        if (this.shouldTriggerAlert('zone_exit', this.currentZone)) {
          this.triggerZoneExitAlert(this.currentZone, location);
        }
        this.previousZone = this.currentZone;
        this.currentZone = null;
      }
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

  // Method to clear all acknowledged zones (useful for testing or reset)
  clearAcknowledgedZones(): void {
    this.acknowledgedZones.clear();
    console.log('🔄 Cleared all acknowledged zones - alerts will show again');
  }

  // Method to acknowledge alert but keep ringtone playing until zone exit
  acknowledgeAlert(alertId: string): void {
    console.log(`🔔 Acknowledging alert: ${alertId}`);
    
    // Mark the current entry as acknowledged
    this.currentEntryAcknowledged = true;
    this.acknowledgedZoneEntryId = this.currentZone?.id || null;
    this.activeDialogForZoneId = null; // Clear the active dialog marker
    console.log(`✅ Zone entry acknowledged for: ${this.currentZone?.name || 'current zone'}`);
    console.log(`✅ Alert dismissed - ringtone continues playing until zone exit`);
    
    // Clean up any existing dialogs and notification banners
    const existingDialogs = document.querySelectorAll('.zone-alert-dialog');
    existingDialogs.forEach(dialog => dialog.remove());
    
    const existingBanners = document.querySelectorAll('.notification-banner');
    existingBanners.forEach(banner => banner.remove());
    
    // Note: Do NOT stop the ringtone here - it should continue until user exits the zone
    // Only dismiss the alert from the UI
    this.dismissAlert(alertId);
    
    // Show a brief confirmation that the alert was acknowledged
    this.showAcknowledgmentConfirmation();
    
    console.log(`✅ Alert ${alertId} acknowledged, ringtone continues until zone exit`);
  }

  private showAcknowledgmentConfirmation(): void {
    // Create a brief confirmation toast
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #10b981;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      z-index: 10001;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      animation: slideDown 0.3s ease-out;
    `;
    
    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideDown {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
    
    toast.innerHTML = '✅ Alert acknowledged • Ringtone continues until you leave the zone';
    document.body.appendChild(toast);
    
    // Remove after 3 seconds
    setTimeout(() => {
      if (document.body.contains(toast)) {
        toast.style.animation = 'slideDown 0.3s ease-out reverse';
        setTimeout(() => toast.remove(), 300);
      }
    }, 3000);
  }

  // Public method to play ringtone (called from HomePage)
  public playRingtoneAlert(level: string): void {
    this.playRingtoneAlertInternal(level);
  }

  // Method to stop the current ringtone
  stopRingtone(): void {
    if (this.currentAlertAudio) {
      this.currentAlertAudio.pause();
      this.currentAlertAudio.currentTime = 0;
      this.currentAlertAudio = null;
      console.log('🔕 Ringtone stopped');
    }
  }

  // Method to check if ringtone is currently playing
  isRingtonePlaying(): boolean {
    return this.currentAlertAudio !== null && !this.currentAlertAudio.paused;
  }

  // Method to determine if ringtone should play for a zone
  private shouldPlayRingtoneForZone(zone: DangerZone): boolean {
    // Base ringtone triggering on heatmap risk levels instead of zone classification
    const heatmapRiskLevel = zone.riskLevel || 1;
    
    // Play ringtone for ALL risk levels (1-5) if sound is enabled
    return heatmapRiskLevel >= 1 && this.settings.enableSound;
  }

  // Method to get current zone status for debugging
  getZoneStatus(): { currentZone: DangerZone | null; isRingtonePlaying: boolean; alertCount: number } {
    return {
      currentZone: this.currentZone,
      isRingtonePlaying: this.isRingtonePlaying(),
      alertCount: this.activeAlerts.value.length
    };
  }

  // Method to force re-evaluation of current zone (useful when heatmap data changes)
  forceZoneReevaluation(location: { lat: number; lng: number }): void {
    console.log('🔄 Force zone re-evaluation triggered - checking current zone status');
    
    // Get the latest validated reports
    this.reportService.getValidatedReports().pipe(take(1)).subscribe(validatedReports => {
      console.log(`🔄 Force re-evaluation: Checking ${validatedReports.length} validated reports`);
      
      const currentZone = this.findHeatmapZoneAtLocation(location, validatedReports);
      
      console.log(`🔄 Force re-evaluation: Current zone found:`, currentZone?.name || 'None');
      console.log(`🔄 Force re-evaluation: Previous zone was:`, this.currentZone?.name || 'None');
      
      // If we were in a zone but no longer are (heatmap deleted), exit the zone
      if (this.currentZone && !currentZone) {
        console.log(`🔄 Force re-evaluation: Zone was deleted! Exiting zone:`, this.currentZone.name);
        
        // Stop the ringtone immediately
        this.stopRingtone();
        console.log(`🔕 Ringtone stopped - zone was deleted from heatmap`);
        
        // Clear the current zone
        this.previousZone = this.currentZone;
        this.currentZone = null;
        
        // Clear any active alerts for this zone
        const alertsToRemove = this.activeAlerts.value.filter(alert => 
          alert.zoneId === this.previousZone?.id
        );
        alertsToRemove.forEach(alert => this.dismissAlert(alert.id));
        
        console.log(`🔄 Force re-evaluation: Cleared ${alertsToRemove.length} alerts for deleted zone`);
      }
      // If we're still in the same zone, ensure ringtone continues if it should
      else if (this.currentZone && currentZone && this.currentZone.id === currentZone.id) {
        console.log(`🔄 Force re-evaluation: Still in same zone:`, currentZone.name);
        // Ensure ringtone continues if it should be playing
        if (!this.isRingtonePlaying() && this.shouldPlayRingtoneForZone(currentZone)) {
          console.log(`🔊 Restarting ringtone for continued zone presence: ${currentZone.name}`);
          this.playRingtoneAlertInternal(currentZone.level);
        }
      }
      // If we entered a new zone, handle zone entry
      // NOTE: Don't trigger alerts here - let checkZoneEntry() handle it to prevent duplicates
      else if (!this.currentZone && currentZone) {
        console.log(`🔄 Force re-evaluation: Entered new zone:`, currentZone.name);
        this.previousZone = this.currentZone;
        this.currentZone = currentZone;
        
        // Just ensure ringtone plays - don't show alert here to prevent duplicates
        // Alert will be shown by checkZoneEntry() which is called from home.page.ts
        if (this.settings.enableSound && this.shouldPlayRingtoneForZone(currentZone)) {
          console.log(`🔊 Force re-evaluation: Starting ringtone for: ${currentZone.name}`);
          this.playRingtoneAlertInternal(currentZone.level);
        }
      }
    });
  }

  private findHeatmapZoneAtLocation(location: { lat: number; lng: number }, validatedReports: any[]): DangerZone | null {
    // Find the closest validated report where the blue dot intersects with the heatmap zone
    // Using 50 meter radius for practical detection - this matches typical heatmap visualization
    const heatmapRadius = 50; // 50 meters radius (increased for practical detection)
    const detectionRadius = heatmapRadius / 1000; // Convert to km since we'll compare with distance in meters
    
    for (const report of validatedReports) {
      if (!report.location || !report.location.lat || !report.location.lng) continue;
      
      const distance = this.calculateDistance(
        location.lat, location.lng,
        report.location.lat, report.location.lng
      );
      
      // Compare distance (meters) with detectionRadius (meters)
      if (distance <= heatmapRadius) {
        // Convert report to DangerZone format
        const riskLevel = Number(report.riskLevel || report.level || report.validationLevel || 1);
        
        let level: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
        if (riskLevel <= 0) {
          level = 'Safe';
        } else if (riskLevel <= 1) {
          level = 'Neutral'; // Green zones
        } else if (riskLevel <= 2) {
          level = 'Neutral'; // Yellow zones
        } else if (riskLevel <= 3) {
          level = 'Caution'; // Orange zones
        } else {
          level = 'Danger'; // Red/Dark Red zones
        }
        
        const zone: DangerZone = {
          id: report.id || `report-${Date.now()}`,
          name: report.locationAddress || report.location?.simplifiedAddress || 'Heatmap Zone',
          level: level,
          riskLevel: riskLevel,
          coordinates: [], // Not needed for radius-based detection
          timeSlots: [],
          incidents: [],
          currentSeverity: (riskLevel / 5) * 10,
          crimeFrequency: { daily: 1, weekly: 1, monthly: 1, peakHours: [], peakDays: [] },
          timeBasedRisk: { morning: 0, afternoon: 0, evening: 0, night: 0, weekend: 0, weekday: 0 },
          alertSettings: { enablePushNotifications: true, enableVibration: true, enableSound: true, vibrationPattern: [], alertThreshold: 0 }
        };
        
        console.log(`📍 Found heatmap zone: ${zone.name} at distance ${(distance * 1000).toFixed(1)}m (Risk Level: ${riskLevel})`);
        console.log(`📍 Blue dot intersects with heatmap zone (detection radius: ${heatmapRadius}m)`);
        return zone;
      }
    }
    
    console.log(`📍 No heatmap zone found within ${heatmapRadius}m detection radius of location:`, location);
    console.log(`📍 Available reports:`, validatedReports.map(r => ({
      id: r.id,
      location: r.location,
      riskLevel: r.riskLevel || r.level || 1,
      distance: validatedReports.length > 0 ? (this.calculateDistance(location.lat, location.lng, r.location.lat, r.location.lng) * 1000).toFixed(1) + 'm' : 'N/A'
    })));
    return null;
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
    // Base alert triggering on heatmap risk levels instead of zone classification
    const heatmapRiskLevel = zone.riskLevel || 1;
    
    // Only exclude alerts for truly safe areas (risk level 0 or below)
    if (heatmapRiskLevel <= 0) {
      return false;
    }

    // Check minimum risk level based on heatmap levels
    if (heatmapRiskLevel < this.settings.minimumRiskLevel) {
      return false;
    }

    // For zone entry alerts, check if current entry is already acknowledged
    if (type === 'zone_entry' && this.currentEntryAcknowledged && this.acknowledgedZoneEntryId === zone.id) {
      console.log(`⏸️ Zone entry alert skipped - already acknowledged for entry into: ${zone.name}`);
      console.log(`   Ringtone continues - user must leave zone to trigger new alert`);
      return false;
    }

    const now = Date.now();
    // NO DELAY for zone_entry alerts - immediate response!
    const cooldownMs = type === 'zone_entry' ? 0 : this.settings.cooldownPeriod * 60 * 1000; // No cooldown for entry, 5 minutes for others
    
    if (type !== 'zone_entry' && now - this.lastNotificationTime < cooldownMs) {
      return false;
    }

    // Skip duplicate alert history check for zone_entry to allow immediate alerts
    if (type !== 'zone_entry') {
      const alertKey = `${type}-${zone.id}-${Math.floor(now / (cooldownMs))}`;
      if (this.alertHistory.has(alertKey)) {
        return false;
      }
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
    console.log(`🔍 Settings:`, {
      enableZoneEntryAlerts: this.settings.enableZoneEntryAlerts,
      enableSound: this.settings.enableSound,
      minimumRiskLevel: this.settings.minimumRiskLevel,
      currentEntryAcknowledged: this.currentEntryAcknowledged,
      acknowledgedZoneEntryId: this.acknowledgedZoneEntryId
    });
    
    // Check if there's already an active alert for this zone to prevent duplicates
    const existingAlert = this.activeAlerts.value.find(alert => 
      alert.zoneId === zone.id && alert.type === 'zone_entry' && alert.isActive
    );
    
    if (existingAlert) {
      console.log(`⏸️ Alert already exists for zone ${zone.name}, skipping duplicate alert creation`);
      return;
    }
    
    // Mark dialog as showing to prevent duplicates from rapid successive calls
    this.activeDialogForZoneId = zone.id;
    console.log(`📌 Marking dialog as active for zone: ${zone.name}`);
    
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
    
    // Note: Ringtone is already started in checkZoneEntry() to ensure it plays
    // even if alert is skipped. Only show the alert dialog here.
    
    // Show the white card alert dialog with Acknowledge button IMMEDIATELY
    console.log(`🎯 Calling showImmediateAlertDialog for alert: ${alert.id}`);
    this.showImmediateAlertDialog(alert);
    console.log(`✅ Alert dialog created for zone: ${zone.name}`);
    
    // Update last notification time for other alert types (not for zone_entry)
    this.lastNotificationTime = Date.now();
    
    if (this.settings.enableVibration) {
      this.triggerVibration(alert.zoneLevel);
    }
    
    if (this.settings.enablePushNotifications) {
      this.triggerPushNotification(alert);
    }
  }

  private triggerZoneExitAlert(zone: DangerZone, location: { lat: number; lng: number }): void {
    // Stop the ringtone when user exits the zone
    this.stopRingtone();
    console.log(`🔕 Ringtone stopped - user exited ${zone.name}`);
    
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
    
    return `${heatmapEmoji} You have entered a HEATMAP ZONE!\n📍 Location: ${zone.name}\n🎨 Heatmap Color: ${heatmapColor}\n⚠️ Risk Level: ${riskText} (Level ${riskLevel})`;
  }

  private generateZoneExitMessage(zone: DangerZone): string {
    const riskLevel = zone.riskLevel || 1;
    const heatmapEmoji = this.getHeatmapEmojiForRiskLevel(riskLevel);
    const riskText = this.getRiskText(riskLevel);
    
    return `${heatmapEmoji} You have left the heatmap zone\n📍 Location: ${zone.name}\n⚠️ Risk Level: ${riskText} (Level ${riskLevel})`;
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
      case 1: return '🟢'; // Green (#10b981) - matches heatmap level-1
      case 2: return '🟡'; // Yellow (#fbbf24) - matches heatmap level-2  
      case 3: return '🟠'; // Orange (#f97316) - matches heatmap level-3
      case 4: return '🔴'; // Red (#ef4444) - matches heatmap level-4
      case 5: return '🔴'; // Dark Red (#dc2626) - matches heatmap level-5
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
    
    // Sound is already handled in checkZoneEntry() - don't play duplicate sounds
    
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
    // Use the actual ringtone file for zone alerts
    this.playRingtoneAlertInternal(level);
  }

  private playRingtoneAlertInternal(level: string): void {
    try {
      // Stop any existing ringtone first
      this.stopRingtone();
      
      // Get volume and playback rate based on zone level (higher risk = louder AND faster)
      const volume = this.getVolumeForZoneLevel(level);
      const playbackRate = this.getPlaybackRateForZoneLevel(level);
      
      // Create audio element for the ringtone
      const audio = new Audio('/assets/sounds/GuardianCare - Ringtone.mp3');
      audio.loop = true; // Loop the ringtone until user exits zone
      audio.volume = volume; // Dynamic volume based on risk level
      audio.playbackRate = playbackRate; // Faster playback for higher urgency
      
      // Store reference to stop it later
      this.currentAlertAudio = audio;
      
      // Add event listeners for better control
      audio.addEventListener('loadstart', () => {
        console.log(`🔊 Ringtone loading started for ${level} zone (volume: ${volume}, speed: ${playbackRate}x)`);
      });
      
      audio.addEventListener('canplaythrough', () => {
        console.log(`🔊 Ringtone ready to play at volume ${volume} and speed ${playbackRate}x`);
      });
      
      audio.addEventListener('error', (e) => {
        console.warn('🔊 Ringtone error:', e);
        console.warn('⚠️ Guardian Care ringtone failed to load - no sound will play');
      });
      
      // Add event listener for when audio ends (shouldn't happen with loop=true, but safety)
      audio.addEventListener('ended', () => {
        console.log('🔊 Ringtone ended unexpectedly, restarting...');
        if (this.currentAlertAudio === audio) {
          audio.currentTime = 0;
          audio.play().catch(err => console.warn('Could not restart ringtone:', err));
        }
      });
      
      // Play the ringtone
      audio.play().then(() => {
        console.log(`🔊 Zone ${level} Guardian Care ringtone started at volume ${volume} and speed ${playbackRate}x - will loop until zone exit`);
      }).catch(error => {
        console.warn('Could not play ringtone:', error);
        console.warn('⚠️ No fallback sound - ringtone file must be available');
      });
      
    } catch (error) {
      console.warn('Could not create audio element:', error);
    }
  }

  private getVolumeForZoneLevel(level: string): number {
    // EXPONENTIAL volume scaling - dramatic difference between low and high risk
    // This creates a much more urgent feeling for extreme risk zones
    switch (level) {
      case 'Safe':
        return 0.2; // Level 1 - Low risk: very quiet (just a gentle alert)
      case 'Neutral':
        return 0.4; // Level 2 - Moderate risk: soft alert
      case 'Caution':
        return 0.65; // Level 3 - High risk: noticeable but not alarming
      case 'Danger':
        return 1.0; // Level 4-5 - Critical/Extreme risk: MAX VOLUME (immediate attention)
      default:
        return 0.5; // Default medium volume
    }
  }

  private getPlaybackRateForZoneLevel(level: string): number {
    // Adjust playback speed for urgency (faster = more urgent)
    // This makes extreme risk zones feel more alarming and immediate
    switch (level) {
      case 'Safe':
        return 0.9; // Level 1 - Low risk: slightly slower (gentle, non-alarming)
      case 'Neutral':
        return 1.0; // Level 2 - Moderate risk: normal speed
      case 'Caution':
        return 1.1; // Level 3 - High risk: slightly faster (building urgency)
      case 'Danger':
        return 1.3; // Level 4-5 - Critical/Extreme risk: 30% faster (max urgency)
      default:
        return 1.0; // Default normal speed
    }
  }

  // REMOVED: playFallbackSound() method
  // Only Guardian Care ringtone is used - no oscillator fallback sounds

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

  private showImmediateAlertDialog(alert: ZoneAlert): void {
    // Remove any existing alert dialogs first
    const existingDialogs = document.querySelectorAll('.zone-alert-dialog');
    existingDialogs.forEach(dialog => dialog.remove());
    
    // Create the alert dialog element
    const dialog = document.createElement('div');
    dialog.className = 'zone-alert-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    // Create the alert content
    const alertContent = document.createElement('div');
    alertContent.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 24px;
      margin: 20px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
      animation: slideIn 0.3s ease-out;
    `;
    
    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(-50px) scale(0.9);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    `;
    document.head.appendChild(style);
    
    // Get risk level info
    const riskLevel = alert.riskLevel || 1;
    const heatmapEmoji = this.getHeatmapEmojiForRiskLevel(riskLevel);
    const heatmapColor = this.getHeatmapColorForRiskLevel(riskLevel);
    const riskText = this.getRiskText(riskLevel);
    
    // Create alert content HTML
    alertContent.innerHTML = `
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="font-size: 48px; margin-bottom: 12px;">${heatmapEmoji}</div>
        <h2 style="margin: 0; color: #1f2937; font-size: 20px; font-weight: 600;">
          DANGER ZONE ENTERED
        </h2>
        <p style="margin: 8px 0 0 0; color: #6b7280; font-size: 14px;">
          Level ${riskLevel} • ${heatmapColor}
        </p>
      </div>
      
      <div style="margin-bottom: 20px;">
        <p style="margin: 0 0 8px 0; color: #374151; font-size: 16px; font-weight: 500;">
          📍 ${alert.zoneName}
        </p>
        <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.4;">
          ${alert.message.split('\n').slice(1).join('\n')}
        </p>
      </div>
      
      <div style="margin-bottom: 24px;">
        <h4 style="margin: 0 0 8px 0; color: #374151; font-size: 14px; font-weight: 600;">
          Safety Recommendations:
        </h4>
        <ul style="margin: 0; padding-left: 16px; color: #6b7280; font-size: 13px; line-height: 1.4;">
          ${alert.recommendations.map(rec => `<li>${rec}</li>`).join('')}
        </ul>
      </div>
      
      <div style="display: flex; gap: 12px;">
        <button id="acknowledge-btn" style="
          flex: 1;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 8px;
          padding: 12px 16px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s;
        ">
          ✓ Acknowledge
        </button>
        <button id="view-details-btn" style="
          flex: 1;
          background: #f3f4f6;
          color: #374151;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          padding: 12px 16px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s;
        ">
          View Details
        </button>
      </div>
    `;
    
    dialog.appendChild(alertContent);
    document.body.appendChild(dialog);
    
    // Add button event listeners
    const acknowledgeBtn = dialog.querySelector('#acknowledge-btn') as HTMLButtonElement;
    const viewDetailsBtn = dialog.querySelector('#view-details-btn') as HTMLButtonElement;
    
    acknowledgeBtn.addEventListener('click', () => {
      console.log(`✅ User acknowledged zone entry alert: ${alert.zoneName}`);
      this.acknowledgeAlert(alert.id);
      dialog.remove();
    });
    
    acknowledgeBtn.addEventListener('mouseenter', () => {
      acknowledgeBtn.style.backgroundColor = '#2563eb';
    });
    
    acknowledgeBtn.addEventListener('mouseleave', () => {
      acknowledgeBtn.style.backgroundColor = '#3b82f6';
    });
    
    viewDetailsBtn.addEventListener('click', () => {
      console.log(`📋 User requested details for zone: ${alert.zoneName}`);
      // You can implement additional details view here
      dialog.remove();
    });
    
    viewDetailsBtn.addEventListener('mouseenter', () => {
      viewDetailsBtn.style.backgroundColor = '#e5e7eb';
    });
    
    viewDetailsBtn.addEventListener('mouseleave', () => {
      viewDetailsBtn.style.backgroundColor = '#f3f4f6';
    });
    
    // Auto-close after 30 seconds if not acknowledged
    setTimeout(() => {
      if (document.body.contains(dialog)) {
        console.log(`⏰ Auto-closing unacknowledged alert for zone: ${alert.zoneName}`);
        dialog.remove();
      }
    }, 30000);
    
    console.log(`🚨 Immediate alert dialog shown for zone: ${alert.zoneName}`);
  }

  private clearExistingUIElements(): void {
    // Clear any existing dialogs and notification banners on service initialization
    setTimeout(() => {
      const existingDialogs = document.querySelectorAll('.zone-alert-dialog');
      existingDialogs.forEach(dialog => dialog.remove());
      
      const existingBanners = document.querySelectorAll('.notification-banner');
      existingBanners.forEach(banner => banner.remove());
      
      console.log('🧹 Cleared existing UI elements on service initialization');
    }, 100);
  }


}
