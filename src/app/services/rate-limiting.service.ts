import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';

export interface RateLimitInfo {
  ipAddress: string;
  reportCount: number;
  windowStart: number;
  windowEnd: number;
  isBlocked: boolean;
  remainingReports: number;
  resetTime: number;
}

@Injectable({
  providedIn: 'root'
})
export class RateLimitingService {
  private readonly MAX_REPORTS_PER_HOUR = 5;
  private readonly WINDOW_DURATION_MS = 60 * 60 * 1000;
  private readonly STORAGE_KEY = 'guardian_care_rate_limit';
  
  constructor() {}


  checkRateLimit(ipAddress: string): Observable<RateLimitInfo> {
    try {
      const currentTime = Date.now();
      const rateLimitData = this.getRateLimitData(ipAddress);
      
      this.cleanupExpiredEntries();
      
      if (!rateLimitData) {
        const newRateLimitData = {
          ipAddress,
          reportCount: 0,
          windowStart: currentTime,
          windowEnd: currentTime + this.WINDOW_DURATION_MS,
          isBlocked: false,
          remainingReports: this.MAX_REPORTS_PER_HOUR,
          resetTime: currentTime + this.WINDOW_DURATION_MS
        };
        
        this.saveRateLimitData(ipAddress, newRateLimitData);
        return of(newRateLimitData);
      }
      

      if (currentTime >= rateLimitData.windowEnd) {
        const resetData = {
          ipAddress,
          reportCount: 0,
          windowStart: currentTime,
          windowEnd: currentTime + this.WINDOW_DURATION_MS,
          isBlocked: false,
          remainingReports: this.MAX_REPORTS_PER_HOUR,
          resetTime: currentTime + this.WINDOW_DURATION_MS
        };
        
        this.saveRateLimitData(ipAddress, resetData);
        return of(resetData);
      }
      

      const isBlocked = rateLimitData.reportCount >= this.MAX_REPORTS_PER_HOUR;
      const remainingReports = Math.max(0, this.MAX_REPORTS_PER_HOUR - rateLimitData.reportCount);
      
      const updatedData = {
        ...rateLimitData,
        isBlocked,
        remainingReports,
        resetTime: rateLimitData.windowEnd
      };
      
      return of(updatedData);
      
    } catch (error) {
      console.error('Error checking rate limit:', error);
      return of({
        ipAddress,
        reportCount: 0,
        windowStart: Date.now(),
        windowEnd: Date.now() + this.WINDOW_DURATION_MS,
        isBlocked: false,
        remainingReports: this.MAX_REPORTS_PER_HOUR,
        resetTime: Date.now() + this.WINDOW_DURATION_MS
      });
    }
  }


  recordReportSubmission(ipAddress: string): Observable<boolean> {
    try {
      const currentTime = Date.now();
      const rateLimitData = this.getRateLimitData(ipAddress);
      
      if (!rateLimitData) {
        const newData = {
          ipAddress,
          reportCount: 1,
          windowStart: currentTime,
          windowEnd: currentTime + this.WINDOW_DURATION_MS,
          isBlocked: false,
          remainingReports: this.MAX_REPORTS_PER_HOUR - 1,
          resetTime: currentTime + this.WINDOW_DURATION_MS
        };
        
        this.saveRateLimitData(ipAddress, newData);
        return of(true);
      }
      
      if (currentTime >= rateLimitData.windowEnd) {
        const resetData = {
          ipAddress,
          reportCount: 1,
          windowStart: currentTime,
          windowEnd: currentTime + this.WINDOW_DURATION_MS,
          isBlocked: false,
          remainingReports: this.MAX_REPORTS_PER_HOUR - 1,
          resetTime: currentTime + this.WINDOW_DURATION_MS
        };
        
        this.saveRateLimitData(ipAddress, resetData);
        return of(true);
      }
      
      const newCount = rateLimitData.reportCount + 1;
      const isBlocked = newCount >= this.MAX_REPORTS_PER_HOUR;
      const remainingReports = Math.max(0, this.MAX_REPORTS_PER_HOUR - newCount);
      
      const updatedData = {
        ...rateLimitData,
        reportCount: newCount,
        isBlocked,
        remainingReports,
        resetTime: rateLimitData.windowEnd
      };
      
      this.saveRateLimitData(ipAddress, updatedData);
      return of(true);
      
    } catch (error) {
      console.error('Error recording report submission:', error);
      return of(false);
    }
  }

  getClientIPAddress(): string {
    const userAgent = navigator.userAgent;
    const language = navigator.language;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    const pseudoIP = btoa(`${userAgent}-${language}-${timezone}`).substring(0, 16);
    
    return pseudoIP;
  }

  private getRateLimitData(ipAddress: string): RateLimitInfo | null {
    try {
      const stored = localStorage.getItem(`${this.STORAGE_KEY}_${ipAddress}`);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.error('Error reading rate limit data:', error);
      return null;
    }
  }


  private saveRateLimitData(ipAddress: string, data: RateLimitInfo): void {
    try {
      localStorage.setItem(`${this.STORAGE_KEY}_${ipAddress}`, JSON.stringify(data));
    } catch (error) {
      console.error('Error saving rate limit data:', error);
    }
  }

  private cleanupExpiredEntries(): void {
    try {
      const currentTime = Date.now();
      const keys = Object.keys(localStorage);
      
      keys.forEach(key => {
        if (key.startsWith(this.STORAGE_KEY)) {
          try {
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            if (data.windowEnd && currentTime >= data.windowEnd) {
              localStorage.removeItem(key);
            }
          } catch (error) {
            // Remove corrupted entries
            localStorage.removeItem(key);
          }
        }
      });
    } catch (error) {
      console.error('Error cleaning up expired entries:', error);
    }
  }


  getTimeUntilReset(ipAddress: string): number {
    const rateLimitData = this.getRateLimitData(ipAddress);
    if (!rateLimitData) {
      return 0;
    }
    
    const currentTime = Date.now();
    return Math.max(0, rateLimitData.windowEnd - currentTime);
  }


  getTimeUntilResetString(ipAddress: string): string {
    const timeUntilReset = this.getTimeUntilReset(ipAddress);
    
    if (timeUntilReset <= 0) {
      return 'Rate limit has reset';
    }
    
    const minutes = Math.ceil(timeUntilReset / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`;
    } else {
      return `${minutes}m`;
    }
  }
}
