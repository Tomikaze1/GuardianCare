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
import { getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, serverTimestamp, getDoc } from 'firebase/firestore';
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
    simplifiedAddress?: string;
    fullAddress?: string;
  };
  locationAddress: string;
  anonymous: boolean;
  userId: string;
  media: string[];
  riskLevel: number;
  isSilent: boolean;
  status: 'Pending' | 'In Progress' | 'Resolved' | 'Closed' | 'Validated' | 'Rejected';
  createdAt?: any;
  updatedAt?: any;
  timezone?: string;
  zoneDangerLevel?: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
  zoneName?: string;
  timeOfDay?: 'Morning' | 'Afternoon' | 'Evening' | 'Night';
  dayOfWeek?: string;
  localTime?: string;
  reporterName?: string;
  reporterEmail?: string;
  emergencyContact?: string;
  
  // Admin validation fields
  level?: number; // Admin's 1-5 star validation level (CRITICAL: admin saves to this field!)
  validationLevel?: number; // 1-5 star rating from admin (legacy)
  isRejected?: boolean; // True when report is rejected by admin
  rejectionReason?: string; // Admin's reason for rejection
  validatedAt?: any; // Timestamp when admin validated/rejected
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
    
    try {
      initializeApp(environment.firebaseConfig);
      console.log('✅ Firebase initialized successfully');
    } catch (error) {
      console.log('ℹ️ Firebase already initialized');
    }
    
    this.initializeNetworkMonitoring();
    this.loadQueuedReports();
  }

  async testStorageConnection(): Promise<boolean> {
    try {
      console.log('Testing Cloudinary connection...');
      
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

  private async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  }

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
          const formData = new FormData();
          formData.append('file', file);
          formData.append('upload_preset', this.cloudinaryConfig.uploadPreset);
          
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

  getRiskLevel(type: string): number {
    const riskLevels: { [key: string]: number } = {
      'lost-item': 1,
      'suspicious-activity': 2,
      'crime-theft': 3,
      'emergency': 4,
      'life-threatening': 5,
      'vandalism': 1,
      'noise-complaint': 1,
      'parking-violation': 1,
      'littering': 1,
      'trespassing-minor': 1,
      'suspicious-person': 2,
      'suspicious-vehicle': 2,
      'harassment-verbal': 2,
      'loitering': 2,
      'drug-activity-suspected': 2,
      'gang-activity-suspected': 2,
      'assault-minor': 3,
      'theft-property': 3,
      'burglary': 3,
      'vehicle-theft': 3,
      'drug-dealing': 3,
      'weapon-possession': 3,
      'domestic-dispute': 3,
      'assault-severe': 4,
      'armed-robbery': 4,
      'fire-outbreak': 4,
      'medical-emergency': 4,
      'suicide-attempt': 4,
      'hostage-situation': 4,
      'bomb-threat': 4,
      'active-shooter': 4,
      'terrorism-suspected': 4,
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

  private async handleSilentSubmission(): Promise<void> {
    try {
      await Haptics.vibrate({ duration: 1000 });
      await Haptics.vibrate({ duration: 500 });
      await Haptics.vibrate({ duration: 1000 });
    } catch (error) {
      console.error('Error with haptic feedback:', error);
    }
  }

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

  private checkOnlineStatus(): boolean {
    return navigator.onLine;
  }

  async submitReport(data: ReportFormData): Promise<void> {
    try {
      console.log('🚀 Starting report submission process...');
      
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

      console.log('👤 Getting current user...');
      const user = await this.authService.getCurrentUser();
      console.log('👤 Current user:', user ? `UID: ${user.uid}` : 'No user found');
      
      if (!user) {
        console.error('❌ User not authenticated');
        throw new Error('User not authenticated. Please log in and try again.');
      }

      // Fetch user profile data for non-anonymous reports
      let reporterName: string | undefined;
      let reporterEmail: string | undefined;
      let emergencyContact: string | undefined;

      if (!data.anonymous) {
        try {
          const userProfileDoc = await getDoc(doc(getFirestore(), 'users', user.uid));
          
          if (userProfileDoc.exists()) {
            const userProfile = userProfileDoc.data();
            reporterName = userProfile['displayName'] || user.displayName || 'Unknown User';
            reporterEmail = userProfile['email'] || user.email || 'No email';
            emergencyContact = userProfile['emergencyContact'] || 'No emergency contact';
            
            console.log('👤 User profile loaded:', { reporterName, reporterEmail, emergencyContact });
          } else {
            reporterName = user.displayName || user.email || 'Unknown User';
            reporterEmail = user.email || 'No email';
            emergencyContact = 'No emergency contact';
          }
        } catch (error) {
          console.error('❌ Error fetching user profile:', error);
          reporterName = user.displayName || user.email || 'Unknown User';
          reporterEmail = user.email || 'No email';
          emergencyContact = 'No emergency contact';
        }
      }

      if (data.isSilent) {
        console.log('🔇 Silent mode enabled, triggering haptic feedback...');
        await this.handleSilentSubmission();
      }

      let mediaUrls: string[] = [];
      if (data.media && data.media.length > 0) {
        console.log(`📸 Uploading ${data.media.length} media files...`);
        mediaUrls = await this.uploadMedia(data.media);
        console.log(`✅ Media upload complete: ${mediaUrls.length} files`);
      } else {
        console.log('📸 No media files to upload');
      }

      console.log('📍 Getting readable address...');
      const locationAddress = await this.getReadableAddress(
        data.location.lat,
        data.location.lng
      );
      console.log('📍 Address:', locationAddress);

      const riskLevel = this.getRiskLevel(data.type);
      console.log(`⚠️ Risk level for ${data.type}: ${riskLevel}`);

      console.log('📝 Creating report object...');
      
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
        ...(data.anonymous ? {} : {
          reporterName,
          reporterEmail,
          emergencyContact
        }),
        media: mediaUrls,
        riskLevel,
        isSilent: data.isSilent || false,
        status: 'Pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
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
        anonymous: report.anonymous,
        reporterName: data.anonymous ? 'ANONYMOUS' : reporterName,
        mediaCount: report.media.length,
        riskLevel: report.riskLevel
      });

      console.log('🔥 Saving to Firestore...');
      try {
        const docRef = await addDoc(collection(getFirestore(), this.collectionName), report);
        console.log('✅ Report submitted successfully! Document ID:', docRef.id);
        
        await this.rateLimitingService.recordReportSubmission(clientIP).pipe(
          map(result => result)
        ).toPromise();
        console.log('📊 Rate limit updated for IP:', clientIP);
        
      } catch (firestoreError) {
        console.error('❌ Firestore save error:', firestoreError);
        throw new Error(`Failed to save report to database: ${firestoreError}`);
      }

      if (!data.isSilent) {
        this.notificationService.success(
          'Report Submitted',
          `Your ${data.type} report has been submitted successfully.`,
          'OK',
          3000
        );
      }

      console.log('🔄 Processing queued reports...');
      await this.processQueuedReports();

    } catch (error) {
      console.error('❌ Error submitting report:', error);
      
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
        
        const updatedQueue = queue.filter(r => r.id !== queuedReport.id);
        this.saveQueuedReports(updatedQueue);
        this.queueSubject.next(updatedQueue);
        
      } catch (error) {
        console.error(`Error processing queued report ${queuedReport.id}:`, error);
        
        queuedReport.retryCount++;
        this.saveQueuedReports(queue);
        this.queueSubject.next(queue);
      }
    }

    this.queueProcessing = false;
  }

  private async initializeNetworkMonitoring(): Promise<void> {
    try {
      this.isOnline = this.checkOnlineStatus();

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

  private loadQueuedReports(): void {
    const queue = this.getQueuedReports();
    this.queueSubject.next(queue);
  }

  getQueuedReports$(): Observable<QueuedReport[]> {
    return this.queueSubject.asObservable();
  }

  private async getEnhancedLocationInfo(lat: number, lng: number): Promise<{
    simplifiedAddress: string;
    fullAddress: string;
  }> {
    try {
      const fullAddress = await this.getReadableAddress(lat, lng);
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

  private simplifyAddress(fullAddress: string): string {
    if (!fullAddress || fullAddress === 'Location not available') {
      return 'Unknown Location';
    }

    const addressParts = fullAddress.split(',');
    
    if (addressParts.length >= 2) {
      return addressParts[1].trim();
    } else if (addressParts.length === 1) {
      return addressParts[0].trim();
    }
    
    return 'Unknown Location';
  }

  private getTimeInformation(): {
    timezone: string;
    timeOfDay: 'Morning' | 'Afternoon' | 'Evening' | 'Night';
    dayOfWeek: string;
    localTime: string;
  } {
    const now = new Date();
    return this.getTimeInformationFromDate(now);
  }

  private getTimeInformationFromDate(date: Date): {
    timezone: string;
    timeOfDay: 'Morning' | 'Afternoon' | 'Evening' | 'Night';
    dayOfWeek: string;
    localTime: string;
  } {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
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
    
    const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
    
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

  private async getZoneInformation(lat: number, lng: number): Promise<{
    dangerLevel: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
    zoneName: string;
  }> {
    try {
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

  private getZoneNameFromCoordinates(lat: number, lng: number): string {
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

  private getDangerLevelFromZone(zoneName: string): 'Safe' | 'Neutral' | 'Caution' | 'Danger' {
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

  getUserReports(): Observable<Report[]> {
    return from(this.authService.getCurrentUser()).pipe(
      switchMap(user => {
        if (!user) {
          return of([]);
        }
        
        return new Observable<Report[]>(observer => {
          const q = query(
            collection(getFirestore(), this.collectionName), 
            where('userId', '==', user.uid)
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

  async deleteReport(id: string): Promise<void> {
    try {
      await deleteDoc(doc(getFirestore(), this.collectionName, id));
    } catch (error) {
      console.error('Error deleting report:', error);
      throw error;
    }
  }

  getIncidentTypes(): Array<{ value: string; label: string; riskLevel: number; icon: string }> {
    return [
      { value: 'lost-item', label: 'Lost Item', riskLevel: 1, icon: 'search-outline' },
      { value: 'suspicious-activity', label: 'Suspicious Activity', riskLevel: 2, icon: 'eye-outline' },
      { value: 'crime-theft', label: 'Crime / Theft', riskLevel: 3, icon: 'shield-outline' },
      { value: 'emergency', label: 'Emergency', riskLevel: 4, icon: 'medical-outline' },
      { value: 'life-threatening', label: 'Life-threatening', riskLevel: 5, icon: 'warning-outline' }
    ];
  }

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

  getRiskLevelColor(level: number): string {
    const colors = {
      1: '#28a745',
      2: '#ffc107',
      3: '#fd7e14',
      4: '#dc3545',
      5: '#6f42c1'
    };
    return colors[level as keyof typeof colors] || '#6c757d';
  }

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

  getValidatedReports(): Observable<Report[]> {
    return new Observable<Report[]>(observer => {
      const q = query(
        collection(getFirestore(), this.collectionName), 
        where('status', '==', 'Validated')
      );
      
      const unsubscribe = onSnapshot(q, 
        snapshot => {
          const reports = snapshot.docs.map(doc => ({ 
            id: doc.id, 
            ...doc.data() 
          } as Report));
          console.log('📊 Validated reports loaded:', reports.length);
          observer.next(reports);
        },
        error => {
          console.error('Error fetching validated reports:', error);
          observer.next([]);
        }
      );
      
      return unsubscribe;
    });
  }
}