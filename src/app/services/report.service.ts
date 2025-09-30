import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { LocationService } from './location.service';
import { NotificationService } from '../shared/services/notification.service';
import { RateLimitingService } from './rate-limiting.service';
import { Observable, from, of, throwError, BehaviorSubject } from 'rxjs';
import { map, switchMap, catchError, tap } from 'rxjs/operators';
import { Haptics } from '@capacitor/haptics';

// Native Firebase imports
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, serverTimestamp } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { environment } from '../../environments/environment';

export interface ReportFormData {
  type: string;
  description: string;
  location: {
    lat: number;
    lng: number;
  };
  anonymous: boolean;
  media?: File[];
  isSilent?: boolean;
  customDateTime?: Date | null;
}

export interface Report {
  id?: string;
  type: string;
  description: string;
  location: {
    lat: number;
    lng: number;
    simplifiedAddress?: string; // Short location description
    fullAddress?: string; // Full address for reference
  };
  locationAddress: string;
  anonymous: boolean;
  userId: string;
  media: string[];
  riskLevel: number;
  isSilent: boolean;
  status: 'Pending' | 'In Progress' | 'Resolved' | 'Closed';
  createdAt?: any;
  updatedAt?: any;
  // Enhanced fields
  timezone?: string; // User's timezone
  zoneDangerLevel?: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
  zoneName?: string; // Name of the danger zone if applicable
  timeOfDay?: 'Morning' | 'Afternoon' | 'Evening' | 'Night';
  dayOfWeek?: string; // Day of the week
  localTime?: string; // Formatted local time
}

export interface QueuedReport {
  id: string;
  data: ReportFormData;
  timestamp: number;
  retryCount: number;
}

@Injectable({
  providedIn: 'root'
})
export class ReportService {
  private readonly collectionName = 'incidents';
  private readonly queueKey = 'guardian_care_report_queue';
  private readonly maxRetries = 3;
  
  private isOnline = true;
  private queueProcessing = false;
  private queueSubject = new BehaviorSubject<QueuedReport[]>([]);

  // Cloudinary configuration
  private readonly cloudinaryConfig = {
    cloudName: 'dbxtrosvd',
    apiKey: '455876314373661',
    uploadPreset: 'guardian_care_reports' 
  };

  constructor(
    private authService: AuthService,
    private locationService: LocationService,
    private notificationService: NotificationService,
    private rateLimitingService: RateLimitingService
  ) {
    console.log('🔧 ReportService initialized with native Firebase SDK');
    
    // Initialize Firebase if not already initialized
    try {
      initializeApp(environment.firebaseConfig);
      console.log('✅ Firebase initialized successfully');
    } catch (error) {
      console.log('ℹ️ Firebase already initialized');
    }
    
    this.initializeNetworkMonitoring();
    this.loadQueuedReports();
  }

  /**
   * Test Cloudinary connection using browser-compatible method
   */
  async testStorageConnection(): Promise<boolean> {
    try {
      console.log('Testing Cloudinary connection...');
      
      // Create a simple test request to Cloudinary
      const response = await fetch(`https://res.cloudinary.com/${this.cloudinaryConfig.cloudName}/image/upload/v1/sample.jpg`);
      
      if (response.ok) {
        console.log('✅ Cloudinary connection successful');
        return true;
      } else {
        console.log('❌ Cloudinary connection failed');
        return false;
      }
    } catch (error) {
      console.error('❌ Cloudinary connection error:', error);
      return false;
    }
  }

  /**
   * Convert file to base64 string (for Cloudinary upload)
   */
  private async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  }

  /**
   * 📸 Upload Media to Cloudinary (FREE - 25GB Storage!)
   * Uploads images/audio files to Cloudinary using browser-compatible API
   * FREE tier: 25GB storage, 25GB bandwidth/month
   * Works on both web and mobile browsers
   */
  async uploadMedia(files: File[]): Promise<string[]> {
    try {
      console.log('🚀 Uploading media files to Cloudinary (FREE tier)...');
      console.log('📋 Cloudinary Config:', {
        cloudName: this.cloudinaryConfig.cloudName,
        uploadPreset: this.cloudinaryConfig.uploadPreset
      });
      
      const uploadPromises = files.map(async (file, index) => {
        console.log(`📤 Uploading file ${index + 1}/${files.length}: ${file.name} (${file.size} bytes)`);
        
        try {
          // Create FormData for Cloudinary upload
          const formData = new FormData();
          formData.append('file', file);
          formData.append('upload_preset', this.cloudinaryConfig.uploadPreset);
          
          // Upload to Cloudinary using fetch API
          const response = await fetch(
            `https://api.cloudinary.com/v1_1/${this.cloudinaryConfig.cloudName}/auto/upload`,
            {
              method: 'POST',
              body: formData
            }
          );
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Cloudinary error response: ${errorText}`);
            console.error(`❌ Response status: ${response.status} ${response.statusText}`);
            throw new Error(`Cloudinary upload failed: ${response.status} ${response.statusText} - ${errorText}`);
          }
          
          const result = await response.json();
          console.log(`✅ File uploaded successfully: ${result.secure_url}`);
          return result.secure_url;
        } catch (uploadError) {
          console.error(`❌ Failed to upload ${file.name} to Cloudinary:`, uploadError);
          // Fallback to base64 for this specific file
          console.log(`🔄 Converting ${file.name} to base64 as fallback...`);
          return await this.fileToBase64(file);
        }
      });
      
      const urls = await Promise.all(uploadPromises);
      console.log('🎉 All media files processed successfully!');
      console.log('💰 Cost: $0 (FREE tier: 25GB storage, 25GB bandwidth/month)');
      
      return urls;
    } catch (error) {
      console.error('❌ Error uploading media to Cloudinary:', error);
      console.log('🔄 Falling back to base64 storage for all files...');
      
      // Fallback to base64 if Cloudinary fails
      try {
        const base64Promises = files.map(async (file, index) => {
          console.log(`📤 Converting file ${index + 1}/${files.length} to base64: ${file.name}`);
          return await this.fileToBase64(file);
        });
        
        const base64Strings = await Promise.all(base64Promises);
        console.log('✅ All media files converted to base64 as fallback!');
        console.log('💰 Cost: $0 (FREE - No storage fees!)');
        
        return base64Strings;
      } catch (base64Error) {
        console.error('❌ Base64 fallback also failed:', base64Error);
        throw error;
      }
    }
  }

  /**
   * 📍 Reverse Geocoding Support
   * Converts GPS coordinates to readable address using Nominatim
   */
  async getReadableAddress(lat: number, lng: number): Promise<string> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Geocoding failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.display_name) {
        return data.display_name;
      } else {
        return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      }
    } catch (error) {
      console.error('Error getting address:', error);
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  }

  /**
   * 🚦 Auto Risk Level Assignment
   * Based on incident type, assigns risk level 1-5
   */
  getRiskLevel(type: string): number {
    const riskLevels: { [key: string]: number } = {
      // Public incident types (shown to users)
      'lost-item': 1,
      'suspicious-activity': 2,
      'crime-theft': 3,
      'emergency': 4,
      'life-threatening': 5,
      // Level 1 - Low Risk (Minor incidents)
      'vandalism': 1,
      'noise-complaint': 1,
      'parking-violation': 1,
      'littering': 1,
      'trespassing-minor': 1,
      
      // Level 2 - Moderate Risk (Suspicious/Concerning)
      'suspicious-person': 2,
      'suspicious-vehicle': 2,
      'harassment-verbal': 2,
      'loitering': 2,
      'drug-activity-suspected': 2,
      'gang-activity-suspected': 2,
      
      // Level 3 - High Risk (Criminal activity)
      'assault-minor': 3,
      'theft-property': 3,
      'burglary': 3,
      'vehicle-theft': 3,
      'drug-dealing': 3,
      'weapon-possession': 3,
      'domestic-dispute': 3,
      
      // Level 4 - Critical Risk (Emergency situations)
      'assault-severe': 4,
      'armed-robbery': 4,
      'fire-outbreak': 4,
      'medical-emergency': 4,
      'suicide-attempt': 4,
      'hostage-situation': 4,
      'bomb-threat': 4,
      'active-shooter': 4,
      'terrorism-suspected': 4,
      
      // Level 5 - Extreme Risk (Life-threatening emergencies)
      'mass-casualty': 5,
      'terrorism-confirmed': 5,
      'biological-threat': 5,
      'chemical-attack': 5,
      'nuclear-threat': 5,
      'cyber-terrorism': 5,
      'infrastructure-attack': 5,
      'pandemic-outbreak': 5,
      'natural-disaster-severe': 5
    };

    return riskLevels[type.toLowerCase()] || 2;
  }

  /**
   * 🔕 Silent Panic Mode Submission
   * Handles silent submissions with haptic feedback
   */
  private async handleSilentSubmission(): Promise<void> {
    try {
      await Haptics.vibrate({ duration: 1000 });
      await Haptics.vibrate({ duration: 500 });
      await Haptics.vibrate({ duration: 1000 });
    } catch (error) {
      console.error('Error with haptic feedback:', error);
    }
  }

  /**
   * 🔁 Offline Queueing
   * Queues reports when offline and processes when online
   */
  private async queueReport(data: ReportFormData): Promise<void> {
    const queuedReport: QueuedReport = {
      id: this.generateId(),
      data,
      timestamp: Date.now(),
      retryCount: 0
    };

    const queue = this.getQueuedReports();
    queue.push(queuedReport);
    this.saveQueuedReports(queue);
    this.queueSubject.next(queue);

    console.log('Report queued for offline processing:', queuedReport.id);
  }

  private getQueuedReports(): QueuedReport[] {
    try {
      const stored = localStorage.getItem(this.queueKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error reading queued reports:', error);
      return [];
    }
  }

  private saveQueuedReports(queue: QueuedReport[]): void {
    try {
      localStorage.setItem(this.queueKey, JSON.stringify(queue));
    } catch (error) {
      console.error('Error saving queued reports:', error);
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Check if device is online
   */
  private checkOnlineStatus(): boolean {
    return navigator.onLine;
  }

  /**
   * 🎯 Main Report Submission Method
   * Handles the complete report submission process
   */
  async submitReport(data: ReportFormData): Promise<void> {
    try {
      console.log('🚀 Starting report submission process...');
      
      // Check rate limiting first
      const clientIP = this.rateLimitingService.getClientIPAddress();
      console.log('🔒 Checking rate limit for IP:', clientIP);
      
      const rateLimitInfo = await this.rateLimitingService.checkRateLimit(clientIP).pipe(
        map(info => info)
      ).toPromise();
      
      if (rateLimitInfo?.isBlocked) {
        const timeUntilReset = this.rateLimitingService.getTimeUntilResetString(clientIP);
        const errorMessage = `Rate limit exceeded. You can submit maximum 5 reports per hour. Try again in ${timeUntilReset}.`;
        
        console.log('🚫 Rate limit exceeded:', rateLimitInfo);
        
        if (!data.isSilent) {
          this.notificationService.error(
            'Rate Limit Exceeded',
            errorMessage,
            'OK',
            5000
          );
        }
        
        throw new Error(errorMessage);
      }
      
      console.log('✅ Rate limit check passed. Remaining reports:', rateLimitInfo?.remainingReports);
      
      // Check network connectivity
      this.isOnline = this.checkOnlineStatus();
      console.log('📡 Network status:', this.isOnline ? 'Online' : 'Offline');

      if (!this.isOnline) {
        console.log('📱 Device is offline, queuing report...');
        await this.queueReport(data);
        if (!data.isSilent) {
          this.notificationService.warning(
            'Offline Mode',
            'Report queued for submission when connection is restored.',
            'OK',
            3000
          );
        }
        return;
      }

      // Get current user
      console.log('👤 Getting current user...');
      const user = await this.authService.getCurrentUser();
      console.log('👤 Current user:', user ? `UID: ${user.uid}` : 'No user found');
      
      if (!user) {
        console.error('❌ User not authenticated');
        throw new Error('User not authenticated. Please log in and try again.');
      }

      // Handle silent mode
      if (data.isSilent) {
        console.log('🔇 Silent mode enabled, triggering haptic feedback...');
        await this.handleSilentSubmission();
      }

      // Upload media files
      let mediaUrls: string[] = [];
      if (data.media && data.media.length > 0) {
        console.log(`📸 Uploading ${data.media.length} media files...`);
        mediaUrls = await this.uploadMedia(data.media);
        console.log(`✅ Media upload complete: ${mediaUrls.length} files`);
      } else {
        console.log('📸 No media files to upload');
      }

      // Get readable address
      console.log('📍 Getting readable address...');
      const locationAddress = await this.getReadableAddress(
        data.location.lat,
        data.location.lng
      );
      console.log('📍 Address:', locationAddress);

      // Determine risk level
      const riskLevel = this.getRiskLevel(data.type);
      console.log(`⚠️ Risk level for ${data.type}: ${riskLevel}`);

      // Create report object with enhanced information
      console.log('📝 Creating report object...');
      
      // Get enhanced location and time information
      const enhancedLocation = await this.getEnhancedLocationInfo(data.location.lat, data.location.lng);
      const timeInfo = data.customDateTime ? this.getTimeInformationFromDate(data.customDateTime) : this.getTimeInformation();
      const zoneInfo = await this.getZoneInformation(data.location.lat, data.location.lng);
      
      const report: Omit<Report, 'id'> = {
        type: data.type,
        description: data.description,
        location: {
          ...data.location,
          simplifiedAddress: enhancedLocation.simplifiedAddress,
          fullAddress: enhancedLocation.fullAddress
        },
        locationAddress,
        anonymous: data.anonymous,
        userId: user.uid,
        media: mediaUrls,
        riskLevel,
        isSilent: data.isSilent || false,
        status: 'Pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        // Enhanced fields
        timezone: timeInfo.timezone,
        zoneDangerLevel: zoneInfo.dangerLevel,
        zoneName: zoneInfo.zoneName,
        timeOfDay: timeInfo.timeOfDay,
        dayOfWeek: timeInfo.dayOfWeek,
        localTime: timeInfo.localTime
      };

      console.log('📝 Report object created:', {
        type: report.type,
        description: report.description.substring(0, 50) + '...',
        location: report.location,
        userId: report.userId,
        mediaCount: report.media.length,
        riskLevel: report.riskLevel
      });

      // Save to Firestore
      console.log('🔥 Saving to Firestore...');
      try {
        const docRef = await addDoc(collection(getFirestore(), this.collectionName), report);
        console.log('✅ Report submitted successfully! Document ID:', docRef.id);
        
        // Record the successful submission for rate limiting
        await this.rateLimitingService.recordReportSubmission(clientIP).pipe(
          map(result => result)
        ).toPromise();
        console.log('📊 Rate limit updated for IP:', clientIP);
        
      } catch (firestoreError) {
        console.error('❌ Firestore save error:', firestoreError);
        throw new Error(`Failed to save report to database: ${firestoreError}`);
      }

      // Show success notification (unless silent)
      if (!data.isSilent) {
        this.notificationService.success(
          'Report Submitted',
          `Your ${data.type} report has been submitted successfully.`,
          'OK',
          3000
        );
      }

      // Process any queued reports
      console.log('🔄 Processing queued reports...');
      await this.processQueuedReports();

    } catch (error) {
      console.error('❌ Error submitting report:', error);
      
      // Provide more specific error messages
      let errorMessage = 'There was an error submitting your report. Please try again.';
      
      if (error instanceof Error) {
        if (error.message.includes('User not authenticated')) {
          errorMessage = 'Please log in to submit a report.';
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
          errorMessage = 'Network error. Please check your connection and try again.';
        } else if (error.message.includes('permission')) {
          errorMessage = 'Permission denied. Please check your account settings.';
        }
      }
      
      if (!data.isSilent) {
        this.notificationService.error(
          'Submission Failed',
          errorMessage,
          'OK',
          5000
        );
      }
      
      throw error;
    }
  }

  /**
   * Process queued reports when back online
   */
  private async processQueuedReports(): Promise<void> {
    if (this.queueProcessing) return;
    
    this.queueProcessing = true;
    const queue = this.getQueuedReports();
    
    if (queue.length === 0) {
      this.queueProcessing = false;
      return;
    }

    console.log(`Processing ${queue.length} queued reports...`);

    for (const queuedReport of queue) {
      try {
        if (queuedReport.retryCount >= this.maxRetries) {
          console.warn(`Skipping report ${queuedReport.id} - max retries exceeded`);
          continue;
        }

        await this.submitReport(queuedReport.data);
        
        // Remove from queue on success
        const updatedQueue = queue.filter(r => r.id !== queuedReport.id);
        this.saveQueuedReports(updatedQueue);
        this.queueSubject.next(updatedQueue);
        
      } catch (error) {
        console.error(`Error processing queued report ${queuedReport.id}:`, error);
        
        // Increment retry count
        queuedReport.retryCount++;
        this.saveQueuedReports(queue);
        this.queueSubject.next(queue);
      }
    }

    this.queueProcessing = false;
  }

  /**
   * Initialize network monitoring
   */
  private async initializeNetworkMonitoring(): Promise<void> {
    try {
      this.isOnline = this.checkOnlineStatus();

      // Listen for online/offline events
      window.addEventListener('online', () => {
        this.isOnline = true;
        console.log('Network connection restored');
        this.processQueuedReports();
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
        console.log('Network connection lost');
      });
    } catch (error) {
      console.error('Error initializing network monitoring:', error);
    }
  }

  /**
   * Load queued reports on service initialization
   */
  private loadQueuedReports(): void {
    const queue = this.getQueuedReports();
    this.queueSubject.next(queue);
  }

  /**
   * Get queued reports observable
   */
  getQueuedReports$(): Observable<QueuedReport[]> {
    return this.queueSubject.asObservable();
  }

  /**
   * Get enhanced location information with simplified address
   */
  private async getEnhancedLocationInfo(lat: number, lng: number): Promise<{
    simplifiedAddress: string;
    fullAddress: string;
  }> {
    try {
      const fullAddress = await this.getReadableAddress(lat, lng);
      
      // Create simplified address (e.g., "Downtown Cebu" instead of full street address)
      const simplifiedAddress = this.simplifyAddress(fullAddress);
      
      return {
        simplifiedAddress,
        fullAddress
      };
    } catch (error) {
      console.error('Error getting enhanced location info:', error);
      return {
        simplifiedAddress: 'Location not available',
        fullAddress: 'Location not available'
      };
    }
  }

  /**
   * Simplify address to show only area/district name
   */
  private simplifyAddress(fullAddress: string): string {
    if (!fullAddress || fullAddress === 'Location not available') {
      return 'Unknown Location';
    }

    // Extract area/district from full address
    // This is a simple implementation - you can enhance based on your location patterns
    const addressParts = fullAddress.split(',');
    
    if (addressParts.length >= 2) {
      // Return the second part (usually area/district)
      return addressParts[1].trim();
    } else if (addressParts.length === 1) {
      // Return the first part if only one part
      return addressParts[0].trim();
    }
    
    return 'Unknown Location';
  }

  /**
   * Get time information including timezone and time of day
   */
  private getTimeInformation(): {
    timezone: string;
    timeOfDay: 'Morning' | 'Afternoon' | 'Evening' | 'Night';
    dayOfWeek: string;
    localTime: string;
  } {
    const now = new Date();
    return this.getTimeInformationFromDate(now);
  }

  /**
   * Get time information from a specific date
   */
  private getTimeInformationFromDate(date: Date): {
    timezone: string;
    timeOfDay: 'Morning' | 'Afternoon' | 'Evening' | 'Night';
    dayOfWeek: string;
    localTime: string;
  } {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    // Determine time of day
    const hour = date.getHours();
    let timeOfDay: 'Morning' | 'Afternoon' | 'Evening' | 'Night';
    
    if (hour >= 6 && hour < 12) {
      timeOfDay = 'Morning';
    } else if (hour >= 12 && hour < 17) {
      timeOfDay = 'Afternoon';
    } else if (hour >= 17 && hour < 21) {
      timeOfDay = 'Evening';
    } else {
      timeOfDay = 'Night';
    }
    
    // Get day of week
    const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
    
    // Get formatted local time
    const localTime = date.toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone
    });
    
    return {
      timezone,
      timeOfDay,
      dayOfWeek,
      localTime
    };
  }

  /**
   * Get zone danger information based on location
   */
  private async getZoneInformation(lat: number, lng: number): Promise<{
    dangerLevel: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
    zoneName: string;
  }> {
    try {
      // This would integrate with your ZoneDangerEngineService
      // For now, we'll provide a simple implementation
      // You can enhance this to actually check against your danger zones
      
      // Simple logic based on coordinates (this is just an example)
      // In a real implementation, you'd check against your zone database
      const zoneName = this.getZoneNameFromCoordinates(lat, lng);
      const dangerLevel = this.getDangerLevelFromZone(zoneName);
      
      return {
        dangerLevel,
        zoneName
      };
    } catch (error) {
      console.error('Error getting zone information:', error);
      return {
        dangerLevel: 'Neutral',
        zoneName: 'Unknown Zone'
      };
    }
  }

  /**
   * Get zone name based on coordinates (simplified implementation)
   */
  private getZoneNameFromCoordinates(lat: number, lng: number): string {
    // This is a simplified implementation
    // In a real app, you'd check against your zone database
    
    // Example zones for Cebu area (you can expand this)
    if (lat >= 10.3 && lat <= 10.35 && lng >= 123.9 && lng <= 123.95) {
      return 'Downtown Cebu';
    } else if (lat >= 10.31 && lat <= 10.33 && lng >= 123.89 && lng <= 123.91) {
      return 'Lahug Area';
    } else if (lat >= 10.32 && lat <= 10.34 && lng >= 123.92 && lng <= 123.94) {
      return 'Mabolo District';
    } else {
      return 'General Area';
    }
  }

  /**
   * Get danger level based on zone name (simplified implementation)
   */
  private getDangerLevelFromZone(zoneName: string): 'Safe' | 'Neutral' | 'Caution' | 'Danger' {
    // This is a simplified implementation
    // In a real app, you'd get this from your zone danger engine
    
    const dangerZones = ['Downtown Cebu', 'Lahug Area'];
    const cautionZones = ['Mabolo District'];
    
    if (dangerZones.includes(zoneName)) {
      return 'Danger';
    } else if (cautionZones.includes(zoneName)) {
      return 'Caution';
    } else {
      return 'Safe';
    }
  }

  /**
   * Get all reports for current user
   */
  getUserReports(): Observable<Report[]> {
    return from(this.authService.getCurrentUser()).pipe(
      switchMap(user => {
        if (!user) {
          return of([]);
        }
        
        return new Observable<Report[]>(observer => {
          const q = query(
            collection(getFirestore(), this.collectionName), 
            where('userId', '==', user.uid), 
            orderBy('createdAt', 'desc')
          );
          
          const unsubscribe = onSnapshot(q, 
            snapshot => {
              const reports = snapshot.docs.map(doc => ({ 
                id: doc.id, 
                ...doc.data() 
              } as Report));
              observer.next(reports);
            },
            error => {
              console.error('Error fetching user reports:', error);
              observer.next([]);
            }
          );
          
          return unsubscribe;
        });
      })
    );
  }

  /**
   * Get report by ID
   */
  getReportById(id: string): Observable<Report | null> {
    return new Observable<Report | null>(observer => {
      const docRef = doc(getFirestore(), this.collectionName, id);
      
      const unsubscribe = onSnapshot(docRef, 
        snapshot => {
          if (snapshot.exists()) {
            observer.next({ id: snapshot.id, ...snapshot.data() } as Report);
          } else {
            observer.next(null);
          }
        },
        error => {
          console.error('Error fetching report by ID:', error);
          observer.next(null);
        }
      );
      
      return unsubscribe;
    });
  }

  /**
   * Update report status
   */
  async updateReportStatus(id: string, status: Report['status']): Promise<void> {
    try {
      await updateDoc(doc(getFirestore(), this.collectionName, id), {
        status,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating report status:', error);
      throw error;
    }
  }

  /**
   * Delete report
   */
  async deleteReport(id: string): Promise<void> {
    try {
      await deleteDoc(doc(getFirestore(), this.collectionName, id));
    } catch (error) {
      console.error('Error deleting report:', error);
      throw error;
    }
  }

  /**
   * Get incident types with risk levels
   */
  getIncidentTypes(): Array<{ value: string; label: string; riskLevel: number; icon: string }> {
    return [
      { value: 'lost-item', label: 'Lost Item', riskLevel: 1, icon: 'search-outline' },
      { value: 'suspicious-activity', label: 'Suspicious Activity', riskLevel: 2, icon: 'eye-outline' },
      { value: 'crime-theft', label: 'Crime / Theft', riskLevel: 3, icon: 'shield-outline' },
      { value: 'emergency', label: 'Emergency', riskLevel: 4, icon: 'medical-outline' },
      { value: 'life-threatening', label: 'Life-threatening', riskLevel: 5, icon: 'warning-outline' }
    ];
  }



  /**
   * Get risk level description
   */
  getRiskLevelDescription(level: number): string {
    const descriptions = {
      1: 'Low Risk - Minor incident',
      2: 'Moderate Risk - Suspicious activity',
      3: 'High Risk - Criminal activity',
      4: 'Critical Risk - Emergency situation',
      5: 'Extreme Risk - Life-threatening emergency'
    };
    return descriptions[level as keyof typeof descriptions] || 'Unknown Risk Level';
  }



  /**
   * Get risk level color
   */
  getRiskLevelColor(level: number): string {
    const colors = {
      1: '#28a745', // Green
      2: '#ffc107', // Yellow
      3: '#fd7e14', // Orange
      4: '#dc3545', // Red
      5: '#6f42c1'  // Purple
    };
    return colors[level as keyof typeof colors] || '#6c757d';
  }

  /**
   * Get current rate limit status for the client
   */
  async getRateLimitStatus(): Promise<{ remainingReports: number; timeUntilReset: string; isBlocked: boolean }> {
    const clientIP = this.rateLimitingService.getClientIPAddress();
    const rateLimitInfo = await this.rateLimitingService.checkRateLimit(clientIP).pipe(
      map(info => info)
    ).toPromise();
    const timeUntilReset = this.rateLimitingService.getTimeUntilResetString(clientIP);
    
    return {
      remainingReports: rateLimitInfo?.remainingReports || 5,
      timeUntilReset,
      isBlocked: rateLimitInfo?.isBlocked || false
    };
  }
} 