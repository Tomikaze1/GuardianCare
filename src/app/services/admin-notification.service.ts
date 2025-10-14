import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { getFirestore, collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { ReportService, Report } from './report.service';
import { NotificationManagerService } from './notification-manager.service';
import { AuthService } from './auth.service';
import { LocationService } from './location.service';

/**
 * Interface for admin validation events
 */
interface AdminValidationEvent {
  reportId: string;
  reportType: string;
  locationAddress: string;
  riskLevel: number;
  validatedAt: Date;
  isForCurrentUser: boolean;
  userId: string;
  location?: { lat: number; lng: number };
  distanceKm?: number;
}

/**
 * Interface for notification settings
 */
export interface ZoneNotificationSettings {
  notificationRadiusKm: number;
  nearbyThresholdKm: number;
  closeThresholdKm: number;
  enableLocationNotifications: boolean;
  enableTimeInformation: boolean;
}

/**
 * AdminNotificationService
 * 
 * This service handles location-based notifications when admin validates reports and adds zones to the heatmap.
 * 
 * Features:
 * - Real-time monitoring of admin-validated reports
 * - Distance calculation from user's current location to new zones
 * - Smart notification filtering based on distance (default: 10km radius)
 * - Detailed time information (e.g., "just now", "5 minutes ago")
 * - Priority-based notifications based on distance and risk level:
 *   - Very Close (< 500m): High priority for medium-high risk
 *   - Nearby (< 1km): High priority for high-critical risk
 *   - In Your Area (< 5km): Medium-high priority
 *   - Near You (< 10km): Medium priority
 * 
 * Notification Format:
 * - Title: "[Emoji] [Proximity]: Zone Added" (e.g., "🚨 Very Close: Zone Added")
 * - Message: "[Type] at [Location] • [Distance] • [Risk] Risk • Reported [Time]"
 * - Example: "Crime / Theft at Downtown Cebu • 1.2km away • High Risk • Reported 15 minutes ago"
 * 
 * Configuration:
 * - NOTIFICATION_RADIUS_KM: Maximum distance for notifications (default: 10km)
 * - NEARBY_THRESHOLD_KM: Distance threshold for "nearby" classification (default: 1km)
 * - CLOSE_THRESHOLD_KM: Distance threshold for "very close" classification (default: 500m)
 */
@Injectable({
  providedIn: 'root'
})
export class AdminNotificationService {
  private validationEventsSubject = new BehaviorSubject<AdminValidationEvent[]>([]);
  public validationEvents$ = this.validationEventsSubject.asObservable();

  private subscriptions: Subscription[] = [];
  private lastProcessedValidationTime: Date | null = null;
  private processedReportIds = new Set<string>(); // Track processed reports to avoid duplicates
  
  // Configuration for location-based notifications (can be customized)
  private NOTIFICATION_RADIUS_KM = 10; // Notify users within 10km of new zone
  private NEARBY_THRESHOLD_KM = 1; // Consider "nearby" if within 1km
  private CLOSE_THRESHOLD_KM = 0.5; // Consider "very close" if within 500m
  private enableLocationNotifications = true;
  private enableTimeInformation = true;

  constructor(
    private reportService: ReportService,
    private notificationManager: NotificationManagerService,
    private authService: AuthService,
    private locationService: LocationService
  ) {
    this.initializeAdminValidationListener();
    this.loadNotificationSettings();
    this.syncOfflineNotifications();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private initializeAdminValidationListener() {
    console.log('🔔 Initializing AdminNotificationService listener...');
    const db = getFirestore();
    
    // Listen to ALL incidents, filter for Validated status in real-time
    const allIncidentsQuery = query(
      collection(db, 'incidents')
      // Removed orderBy to avoid index requirement - we'll sort in memory
    );

    this.subscriptions.push(
      new Observable<Report[]>(observer => {
        const unsubscribe = onSnapshot(allIncidentsQuery, snapshot => {
          console.log('📡 Admin validation listener: snapshot received', snapshot.size, 'docs');
          
          const reports = snapshot.docs.map(doc => {
            const data = doc.data();
            
            // Parse location data
            const locationData = data['location'];
            const locationObj = typeof locationData === 'object' ? locationData : {
              lat: data['lat'] || 0,
              lng: data['lng'] || 0
            };
            
            const report: Report = {
              id: doc.id,
              type: data['type'] || 'Incident Report',
              description: data['description'] || '',
              location: locationObj,
              locationAddress: data['locationAddress'] || 'Unknown Location',
              status: data['status'] || 'Pending',
              level: data['level'] || undefined,
              riskLevel: data['riskLevel'] || 1,
              validatedAt: data['validatedAt']?.toDate ? data['validatedAt'].toDate() : data['validatedAt'],
              media: data['media'] || [],
              userId: data['userId'] || '',
              anonymous: data['anonymous'] || false,
              isSilent: data['isSilent'] || false,
              createdAt: data['createdAt']?.toDate() || undefined,
              updatedAt: data['updatedAt']?.toDate() || undefined,
              reporterName: data['reporterName'] || undefined,
              reporterEmail: data['reporterEmail'] || undefined,
              emergencyContact: data['emergencyContact'] || undefined
            };
            
            return report;
          });
          
          observer.next(reports);
        }, error => {
          console.error('❌ Error listening to admin validated reports:', error);
          observer.error(error);
        });
        return unsubscribe;
      }).subscribe(async (reports) => {
        const currentUser = await this.authService.getCurrentUser();
        if (!currentUser) {
          console.log('👤 No current user, skipping admin validation processing');
          return;
        }

        const newEvents: AdminValidationEvent[] = [];
        
        // Filter for reports that were JUST validated (within last 30 seconds)
        const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
        
        const newlyValidatedReports = reports.filter(report => {
          return report.status === 'Validated' && 
                 report.validatedAt && 
                 report.validatedAt > thirtySecondsAgo &&
                 !this.processedReportIds.has(report.id!);
                 // Removed user filter - now shows ALL validated reports
        });
        
        console.log('✅ Found newly validated reports:', newlyValidatedReports.length);
        
        newlyValidatedReports.forEach(async report => {
          // Mark as processed to avoid duplicate notifications
          this.processedReportIds.add(report.id!);
          
          const isForCurrentUser = report.userId === currentUser.uid;
          
          // Get user's current location to calculate distance
          let distanceKm: number | undefined;
          let distanceText = '';
          
          try {
            const userLocation = await this.locationService.getCurrentLocation();
            
            if (userLocation && report.location) {
              // Calculate distance in meters
              const distanceMeters = this.locationService.calculateDistance(
                userLocation.lat,
                userLocation.lng,
                report.location.lat,
                report.location.lng
              );
              
              distanceKm = distanceMeters / 1000; // Convert to kilometers
              
              // Format distance text
              if (distanceKm < this.CLOSE_THRESHOLD_KM) {
                distanceText = `${Math.round(distanceMeters)}m away`;
              } else if (distanceKm < 1) {
                distanceText = `${Math.round(distanceMeters)}m away`;
              } else {
                distanceText = `${distanceKm.toFixed(1)}km away`;
              }
              
              console.log(`📍 Distance from user to report: ${distanceText}`);
            }
          } catch (error) {
            console.warn('Could not get user location for distance calculation:', error);
          }
          
          const event: AdminValidationEvent = {
            reportId: report.id!,
            reportType: report.type || 'Incident Report',
            locationAddress: report.locationAddress || 'Unknown Location',
            riskLevel: report.level || report.riskLevel || 1,
            validatedAt: report.validatedAt!,
            isForCurrentUser: isForCurrentUser,
            userId: report.userId!,
            location: report.location,
            distanceKm: distanceKm
          };
          newEvents.push(event);

          // Create notification
          const timeStr = this.formatTimeAgoDetailed(report.validatedAt!);
          const riskText = this.getRiskLevelText(report.level || report.riskLevel || 1);
          
          if (isForCurrentUser) {
            // For report owner - show validation confirmation
            this.notificationManager.addReportNotification(
              `✅ Your Report Validated`,
              `${report.type} • ${event.locationAddress} • Reported ${timeStr}`,
              report.id!
            );
          } else {
            // For other users - show location-based notification
            
            // Check if location notifications are enabled
            if (!this.enableLocationNotifications) {
              console.log('📍 Location notifications disabled, skipping');
              return;
            }
            
            // Only notify if within configured radius
            if (distanceKm !== undefined && distanceKm <= this.NOTIFICATION_RADIUS_KM) {
              const locationDetail = report.location?.simplifiedAddress || event.locationAddress;
              const proximityDesc = this.getProximityDescription(distanceKm);
              
              // Determine urgency based on distance and risk level
              let priority: 'low' | 'medium' | 'high' = 'medium';
              let urgencyPrefix = '🔴';
              
              if (distanceKm < this.CLOSE_THRESHOLD_KM) {
                priority = event.riskLevel >= 3 ? 'high' : 'medium';
                urgencyPrefix = '🚨';
              } else if (distanceKm < this.NEARBY_THRESHOLD_KM) {
                priority = event.riskLevel >= 4 ? 'high' : 'medium';
                urgencyPrefix = '⚠️';
              } else {
                priority = event.riskLevel >= 4 ? 'high' : 'medium';
                urgencyPrefix = '📍';
              }
              
              // Create comprehensive notification message with distance and time
              const notificationTitle = `${urgencyPrefix} ${proximityDesc}: Zone Added`;
              
              // Build message with optional time information
              let notificationMessage = `${report.type} at ${locationDetail} • ${distanceText} • ${riskText} Risk`;
              if (this.enableTimeInformation) {
                notificationMessage += ` • Reported ${timeStr}`;
              }
              
              this.notificationManager.addLocationNotification(
                notificationTitle,
                notificationMessage,
                priority
              );
              
              console.log(`🔔 Location-based notification sent: ${distanceText} from user${this.enableTimeInformation ? ', reported ' + timeStr : ''}`);
            } else if (distanceKm === undefined) {
              // Fallback notification without distance (if location not available)
              let fallbackMessage = `${report.type} at ${event.locationAddress} • ${riskText} Risk`;
              if (this.enableTimeInformation) {
                fallbackMessage += ` • Reported ${timeStr}`;
              }
              
              this.notificationManager.addLocationNotification(
                `🔴 New Zone Added`,
                fallbackMessage,
                event.riskLevel >= 3 ? 'high' : 'medium'
              );
              
              console.log('🔔 General notification sent (location unavailable)');
            } else {
              console.log(`📍 Report too far (${distanceKm.toFixed(1)}km), no notification sent`);
            }
          }
          
          console.log('🔔 Created validation notification for report:', report.id);
        });

        if (newEvents.length > 0) {
          this.validationEventsSubject.next([...this.validationEventsSubject.value, ...newEvents]);
          console.log('📊 Admin validation events updated:', newEvents.length, 'new events');
        }
        
        // Clean up old processed IDs (keep only last 100 to prevent memory issues)
        if (this.processedReportIds.size > 100) {
          const idsArray = Array.from(this.processedReportIds);
          this.processedReportIds.clear();
          idsArray.slice(-50).forEach(id => this.processedReportIds.add(id));
        }
      })
    );
  }

  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
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

  // Method to manually trigger notification check (useful for testing)
  public checkForNewValidations() {
    console.log('🔍 Manual validation check triggered');
    // The listener will automatically pick up any new validations
  }

  /**
   * Get recent validation events
   */
  getRecentValidations(limit: number = 10): Observable<AdminValidationEvent[]> {
    return this.validationEvents$.pipe(
      map(events => events.slice(0, limit))
    );
  }

  /**
   * Get validation events for a specific user
   */
  getUserValidations(userId: string): Observable<AdminValidationEvent[]> {
    return this.validationEvents$.pipe(
      map(events => events.filter(event => event.userId === userId))
    );
  }

  /**
   * Clear old validation events (older than 24 hours)
   */
  clearOldEvents() {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const currentEvents = this.validationEventsSubject.value;
    const recentEvents = currentEvents.filter(event => event.validatedAt > oneDayAgo);
    
    this.validationEventsSubject.next(recentEvents);
  }

  /**
   * Clear all processed report IDs to start fresh
   */
  clearProcessedReports() {
    this.processedReportIds.clear();
    this.lastProcessedValidationTime = null;
    console.log('🧹 Cleared processed report IDs from AdminNotificationService');
  }

  /**
   * Get the current notification radius in kilometers
   */
  getNotificationRadius(): number {
    return this.NOTIFICATION_RADIUS_KM;
  }

  /**
   * Get current notification settings
   */
  getNotificationSettings(): ZoneNotificationSettings {
    return {
      notificationRadiusKm: this.NOTIFICATION_RADIUS_KM,
      nearbyThresholdKm: this.NEARBY_THRESHOLD_KM,
      closeThresholdKm: this.CLOSE_THRESHOLD_KM,
      enableLocationNotifications: this.enableLocationNotifications,
      enableTimeInformation: this.enableTimeInformation
    };
  }

  /**
   * Update notification settings
   */
  updateNotificationSettings(settings: Partial<ZoneNotificationSettings>): void {
    if (settings.notificationRadiusKm !== undefined) {
      this.NOTIFICATION_RADIUS_KM = settings.notificationRadiusKm;
    }
    if (settings.nearbyThresholdKm !== undefined) {
      this.NEARBY_THRESHOLD_KM = settings.nearbyThresholdKm;
    }
    if (settings.closeThresholdKm !== undefined) {
      this.CLOSE_THRESHOLD_KM = settings.closeThresholdKm;
    }
    if (settings.enableLocationNotifications !== undefined) {
      this.enableLocationNotifications = settings.enableLocationNotifications;
    }
    if (settings.enableTimeInformation !== undefined) {
      this.enableTimeInformation = settings.enableTimeInformation;
    }
    
    this.saveNotificationSettings();
    console.log('🔧 Notification settings updated:', this.getNotificationSettings());
  }

  /**
   * Load notification settings from localStorage
   */
  private loadNotificationSettings(): void {
    try {
      const savedSettings = localStorage.getItem('zoneNotificationSettings');
      if (savedSettings) {
        const settings: ZoneNotificationSettings = JSON.parse(savedSettings);
        this.updateNotificationSettings(settings);
        console.log('📥 Loaded notification settings from localStorage');
      }
    } catch (error) {
      console.warn('Could not load notification settings:', error);
    }
  }

  /**
   * Save notification settings to localStorage
   */
  private saveNotificationSettings(): void {
    try {
      const settings = this.getNotificationSettings();
      localStorage.setItem('zoneNotificationSettings', JSON.stringify(settings));
      console.log('💾 Saved notification settings to localStorage');
    } catch (error) {
      console.warn('Could not save notification settings:', error);
    }
  }

  /**
   * Reset notification settings to defaults
   */
  resetNotificationSettings(): void {
    this.NOTIFICATION_RADIUS_KM = 10;
    this.NEARBY_THRESHOLD_KM = 1;
    this.CLOSE_THRESHOLD_KM = 0.5;
    this.enableLocationNotifications = true;
    this.enableTimeInformation = true;
    
    this.saveNotificationSettings();
    console.log('🔄 Reset notification settings to defaults');
  }

  /**
   * Sync notifications that occurred while user was offline
   */
  private async syncOfflineNotifications() {
    try {
      console.log('🔄 Syncing offline notifications...');
      
      // Check if user was offline for a significant time
      if (this.notificationManager.wasOfflineForSignificantTime()) {
        console.log('📱 User was offline for significant time, checking for missed notifications...');
        
        // Get the last sync time
        const lastSyncTime = localStorage.getItem('last_notification_sync');
        let syncFromTime: Date;
        
        if (lastSyncTime) {
          syncFromTime = new Date(lastSyncTime);
        } else {
          // If no previous sync, check last 24 hours
          syncFromTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
        }
        
        console.log('🔍 Checking for reports validated since:', syncFromTime.toISOString());
        
        // Get all reports validated since last sync
        const recentReports = await this.getValidatedReportsSince(syncFromTime);
        
        if (recentReports.length > 0) {
          console.log(`📬 Found ${recentReports.length} reports validated while offline`);
          await this.processOfflineReports(recentReports);
        } else {
          console.log('✅ No new validated reports found');
        }
      }
      
      // Update sync time
      await this.notificationManager.syncOfflineNotifications();
      
    } catch (error) {
      console.warn('Could not sync offline notifications:', error);
    }
  }

  /**
   * Get validated reports since a specific time
   */
  private async getValidatedReportsSince(since: Date): Promise<Report[]> {
    try {
      const db = getFirestore();
      const reportsQuery = query(
        collection(db, 'incidents'),
        where('status', '==', 'Validated'),
        where('validatedAt', '>=', since)
      );
      
      return new Promise((resolve, reject) => {
        const unsubscribe = onSnapshot(reportsQuery, snapshot => {
          const reports = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Report[];
          
          unsubscribe();
          resolve(reports);
        }, reject);
      });
    } catch (error) {
      console.warn('Could not get validated reports since:', error);
      return [];
    }
  }

  /**
   * Process reports that were validated while user was offline
   */
  private async processOfflineReports(reports: Report[]) {
    try {
      const currentUser = await this.authService.getCurrentUser();
      if (!currentUser) {
        console.log('👤 No current user, skipping offline report processing');
        return;
      }

      console.log(`🔄 Processing ${reports.length} offline reports for user:`, currentUser.uid);

      for (const report of reports) {
        const isForCurrentUser = report.userId === currentUser.uid;
        
        // Get user's current location to calculate distance
        let distanceKm: number | undefined;
        let distanceText = '';

        try {
          const userLocation = await this.locationService.getCurrentLocation();

          if (userLocation && report.location) {
            // Calculate distance in meters
            const distanceMeters = this.locationService.calculateDistance(
              userLocation.lat,
              userLocation.lng,
              report.location.lat,
              report.location.lng
            );

            distanceKm = distanceMeters / 1000; // Convert to kilometers

            // Format distance text
            if (distanceKm < this.CLOSE_THRESHOLD_KM) {
              distanceText = `${Math.round(distanceMeters)}m away`;
            } else if (distanceKm < 1) {
              distanceText = `${Math.round(distanceMeters)}m away`;
            } else {
              distanceText = `${distanceKm.toFixed(1)}km away`;
            }

            console.log(`📍 Offline report distance: ${distanceText}`);
          }
        } catch (error) {
          console.warn('Could not get user location for offline report:', error);
        }

        if (isForCurrentUser) {
          // For report owner - show validation confirmation
          this.notificationManager.addReportNotification(
            `✅ Your Report Validated`,
            `${report.type} • ${report.locationAddress || 'Unknown Location'} • Reported ${this.formatTimeAgoDetailed(report.validatedAt!)}`,
            report.id!
          );
        } else {
          // For other users - show location-based notification if within radius
          if (distanceKm !== undefined && distanceKm <= this.NOTIFICATION_RADIUS_KM) {
            const locationDetail = report.location?.simplifiedAddress || report.locationAddress || 'Unknown Location';
            const proximityDesc = this.getProximityDescription(distanceKm);
            const timeStr = this.formatTimeAgoDetailed(report.validatedAt!);
            const riskText = this.getRiskLevelText(report.level || report.riskLevel || 1);

            // Determine urgency based on distance and risk level
            let priority: 'low' | 'medium' | 'high' = 'medium';
            let urgencyPrefix = '🔴';

            const riskLevel = report.level || report.riskLevel || 1;
            
            if (distanceKm < this.CLOSE_THRESHOLD_KM) {
              priority = riskLevel >= 3 ? 'high' : 'medium';
              urgencyPrefix = '🚨';
            } else if (distanceKm < this.NEARBY_THRESHOLD_KM) {
              priority = riskLevel >= 4 ? 'high' : 'medium';
              urgencyPrefix = '⚠️';
            } else {
              priority = riskLevel >= 4 ? 'high' : 'medium';
              urgencyPrefix = '📍';
            }

            // Create notification for offline report
            const notificationTitle = `${urgencyPrefix} ${proximityDesc}: Zone Added (Offline)`;
            let notificationMessage = `${report.type} at ${locationDetail} • ${distanceText} • ${riskText} Risk`;
            if (this.enableTimeInformation) {
              notificationMessage += ` • Reported ${timeStr}`;
            }

            this.notificationManager.addLocationNotification(
              notificationTitle,
              notificationMessage,
              priority
            );

            console.log(`🔔 Offline notification sent: ${distanceText} from user`);
          }
        }
      }

      console.log('✅ Finished processing offline reports');
      
    } catch (error) {
      console.warn('Error processing offline reports:', error);
    }
  }

  /**
   * Get formatted distance text based on distance in kilometers
   */
  private formatDistance(distanceKm: number): string {
    if (distanceKm < 0.001) {
      return 'very close';
    } else if (distanceKm < 0.1) {
      return `${Math.round(distanceKm * 1000)}m away`;
    } else if (distanceKm < 1) {
      return `${Math.round(distanceKm * 1000)}m away`;
    } else if (distanceKm < 10) {
      return `${distanceKm.toFixed(1)}km away`;
    } else {
      return `${Math.round(distanceKm)}km away`;
    }
  }

  /**
   * Get proximity description based on distance
   */
  private getProximityDescription(distanceKm: number): string {
    if (distanceKm < this.CLOSE_THRESHOLD_KM) {
      return 'Very Close';
    } else if (distanceKm < this.NEARBY_THRESHOLD_KM) {
      return 'Nearby';
    } else if (distanceKm < 5) {
      return 'In Your Area';
    } else {
      return 'Near You';
    }
  }

  /**
   * Enhanced time ago formatting with more detail
   */
  private formatTimeAgoDetailed(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (seconds < 30) return 'just now';
    if (seconds < 60) return `${seconds} seconds ago`;
    if (minutes === 1) return '1 minute ago';
    if (minutes < 60) return `${minutes} minutes ago`;
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  }
}