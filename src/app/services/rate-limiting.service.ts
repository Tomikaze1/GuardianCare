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
  private readonly WINDOW_DURATION_MS = 60 * 60 * 1000; // 1 hour in milliseconds
  private readonly STORAGE_KEY = 'guardian_care_rate_limit';
  
  constructor() {}

  /**
   * Check if IP address can submit a report
   * @param ipAddress - IP address to check
   * @returns Observable<RateLimitInfo> - Rate limit information
   */
  checkRateLimit(ipAddress: string): Observable<RateLimitInfo> {
    try {
      const currentTime = Date.now();
      const rateLimitData = this.getRateLimitData(ipAddress);
      
      // Clean up expired entries
      this.cleanupExpiredEntries();
      
      // Check if we have data for this IP
      if (!rateLimitData) {
        // First time submission from this IP
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
      
      // Check if current window has expired
      if (currentTime >= rateLimitData.windowEnd) {
        // Reset the window
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
      
      // Check if limit is exceeded
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
      // If there's an error, allow the request (fail open)
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

  /**
   * Record a report submission for an IP address
   * @param ipAddress - IP address that submitted the report
   * @returns Observable<boolean> - Success status
   */
  recordReportSubmission(ipAddress: string): Observable<boolean> {
    try {
      const currentTime = Date.now();
      const rateLimitData = this.getRateLimitData(ipAddress);
      
      if (!rateLimitData) {
        // Create new entry
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
      
      // Check if window has expired
      if (currentTime >= rateLimitData.windowEnd) {
        // Reset window
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
      
      // Increment report count
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

  /**
   * Get client's IP address (simplified for browser environment)
   * In a real implementation, this would be handled server-side
   */
  getClientIPAddress(): string {
    // For browser environment, we'll use a combination of factors
    // In production, this should be handled server-side
    const userAgent = navigator.userAgent;
    const language = navigator.language;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    // Create a pseudo-IP based on browser characteristics
    // This is not secure for production - use server-side IP detection
    const pseudoIP = btoa(`${userAgent}-${language}-${timezone}`).substring(0, 16);
    
    return pseudoIP;
  }

  /**
   * Get rate limit data for an IP address
   */
  private getRateLimitData(ipAddress: string): RateLimitInfo | null {
    try {
      const stored = localStorage.getItem(`${this.STORAGE_KEY}_${ipAddress}`);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.error('Error reading rate limit data:', error);
      return null;
    }
  }

  /**
   * Save rate limit data for an IP address
   */
  private saveRateLimitData(ipAddress: string, data: RateLimitInfo): void {
    try {
      localStorage.setItem(`${this.STORAGE_KEY}_${ipAddress}`, JSON.stringify(data));
    } catch (error) {
      console.error('Error saving rate limit data:', error);
    }
  }

  /**
   * Clean up expired rate limit entries
   */
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

  /**
   * Get remaining time until rate limit resets
   * @param ipAddress - IP address to check
   * @returns Time in milliseconds until reset
   */
  getTimeUntilReset(ipAddress: string): number {
    const rateLimitData = this.getRateLimitData(ipAddress);
    if (!rateLimitData) {
      return 0;
    }
    
    const currentTime = Date.now();
    return Math.max(0, rateLimitData.windowEnd - currentTime);
  }

  /**
   * Format time until reset as human-readable string
   * @param ipAddress - IP address to check
   * @returns Human-readable time string
   */
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
