import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface Location {
  lat: number;
  lng: number;
  address?: string;
}

@Injectable({
  providedIn: 'root'
})
export class LocationService {
  private currentLocationSubject = new BehaviorSubject<Location | null>(null);
  public currentLocation$ = this.currentLocationSubject.asObservable();

  constructor() {
    this.initializeLocation();
  }

  private async initializeLocation() {
    try {
      const location = await this.getCurrentLocation();
      this.currentLocationSubject.next(location);
    } catch (error) {
      console.error('Error initializing location:', error);
    }
  }

  async getCurrentLocation(): Promise<Location> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }

      // First try with maximum accuracy and longer timeout
      const highAccuracyOptions = {
        enableHighAccuracy: true,
        timeout: 45000, // 45 seconds for maximum accuracy
        maximumAge: 0 // Don't use cached position
      };

      const standardOptions = {
        enableHighAccuracy: false,
        timeout: 15000, // 15 seconds for standard accuracy
        maximumAge: 300000 // 5 minutes cache
      };

      const tryGetLocation = (options: PositionOptions, isRetry = false) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            console.log('GPS Position obtained:', {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy + ' meters',
              timestamp: new Date(position.timestamp).toLocaleString()
            });

            const location: Location = {
              lat: position.coords.latitude,
              lng: position.coords.longitude
            };
            this.currentLocationSubject.next(location);
            resolve(location);
          },
          (error) => {
            console.error('GPS Error:', {
              code: error.code,
              message: error.message,
              isRetry: isRetry
            });

            // If high accuracy failed and this is not a retry, try standard accuracy
            if (!isRetry && options.enableHighAccuracy) {
              console.log('High accuracy failed, trying standard accuracy...');
              tryGetLocation(standardOptions, true);
              return;
            }

            // If both failed, reject with error
            reject(new Error(`Location error: ${error.message} (Code: ${error.code})`));
          },
          options
        );
      };

      // Start with high accuracy
      tryGetLocation(highAccuracyOptions);
    });
  }

  async getAddressFromCoordinates(latitude: number, longitude: number): Promise<string> {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.display_name) {
        return data.display_name;
      } else {
        return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      }
    } catch (error) {
      console.error('Error getting address:', error);
      return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    }
  }

  async getCurrentLocationWithAddress(): Promise<Location> {
    const location = await this.getCurrentLocation();
    const address = await this.getAddressFromCoordinates(location.lat, location.lng);
    
    return {
      ...location,
      address
    };
  }

  watchLocation(): Observable<Location> {
    return new Observable(observer => {
      if (!navigator.geolocation) {
        observer.error(new Error('Geolocation is not supported'));
        return;
      }

      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          console.log('GPS Position updated:', {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy + ' meters',
            timestamp: new Date(position.timestamp).toLocaleString()
          });

          const location: Location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          this.currentLocationSubject.next(location);
          observer.next(location);
        },
        (error) => {
          console.error('Error watching location:', error);
          observer.error(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 30000, // 30 seconds for high accuracy
          maximumAge: 0 // Don't use cached position for watching
        }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    });
  }

  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  // Method to check GPS accuracy and status
  async checkGPSAccuracy(): Promise<{ accuracy: number; status: string; coordinates?: { lat: number; lng: number } }> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ accuracy: 0, status: 'GPS not supported' });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const accuracy = position.coords.accuracy;
          let status = 'Excellent';
          
          if (accuracy <= 5) {
            status = 'Excellent (≤5m)';
          } else if (accuracy <= 10) {
            status = 'Good (≤10m)';
          } else if (accuracy <= 20) {
            status = 'Fair (≤20m)';
          } else if (accuracy <= 50) {
            status = 'Poor (≤50m)';
          } else {
            status = 'Very Poor (>50m)';
          }

          resolve({
            accuracy,
            status,
            coordinates: {
              lat: position.coords.latitude,
              lng: position.coords.longitude
            }
          });
        },
        (error) => {
          let status = 'Error';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              status = 'Permission Denied';
              break;
            case error.POSITION_UNAVAILABLE:
              status = 'Position Unavailable';
              break;
            case error.TIMEOUT:
              status = 'Timeout';
              break;
          }
          resolve({ accuracy: 0, status });
        },
        {
          enableHighAccuracy: true,
          timeout: 30000,
          maximumAge: 0
        }
      );
    });
  }

  // Method to force refresh location with high accuracy
  async refreshLocationWithHighAccuracy(): Promise<Location> {
    console.log('Forcing high accuracy location refresh...');
    return this.getCurrentLocation();
  }

  // Method to get maximum precision location
  async getMaximumPrecisionLocation(): Promise<Location> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }

      // Maximum precision options
      const maxPrecisionOptions = {
        enableHighAccuracy: true,
        timeout: 60000, // 60 seconds for maximum precision
        maximumAge: 0 // Always get fresh position
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log('Maximum Precision GPS Position obtained:', {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy + ' meters',
            altitude: position.coords.altitude,
            altitudeAccuracy: position.coords.altitudeAccuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            timestamp: new Date(position.timestamp).toLocaleString()
          });

          const location: Location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          this.currentLocationSubject.next(location);
          resolve(location);
        },
        (error) => {
          console.error('Maximum Precision GPS Error:', error);
          reject(new Error(`Maximum precision location error: ${error.message} (Code: ${error.code})`));
        },
        maxPrecisionOptions
      );
    });
  }

  // Method to get the most accurate location possible with multiple attempts
  async getDeviceExactLocation(): Promise<Location> {
    return new Promise(async (resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }

      let bestLocation: Location | null = null;
      let bestAccuracy = Infinity;
      let attempts = 0;
      const maxAttempts = 3;

      const tryGetLocation = (): Promise<void> => {
        return new Promise((resolveAttempt, rejectAttempt) => {
          attempts++;
          
          const options = {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 0
          };

          navigator.geolocation.getCurrentPosition(
            (position) => {
              const accuracy = position.coords.accuracy;
              console.log(`Location attempt ${attempts}:`, {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: accuracy + ' meters',
                timestamp: new Date(position.timestamp).toLocaleString()
              });

              // If this is the most accurate location so far, save it
              if (accuracy < bestAccuracy) {
                bestAccuracy = accuracy;
                bestLocation = {
                  lat: position.coords.latitude,
                  lng: position.coords.longitude
                } as Location;
              }

              // If we have excellent accuracy (≤5m) or we've tried enough times, resolve
              if (accuracy <= 5 || attempts >= maxAttempts) {
                resolveAttempt();
              } else {
                // Wait a bit and try again for better accuracy
                setTimeout(() => {
                  tryGetLocation().then(resolveAttempt).catch(rejectAttempt);
                }, 2000);
              }
            },
            (error) => {
              console.error(`Location attempt ${attempts} failed:`, error);
              if (attempts >= maxAttempts) {
                rejectAttempt(error);
              } else {
                // Try again after a short delay
                setTimeout(() => {
                  tryGetLocation().then(resolveAttempt).catch(rejectAttempt);
                }, 3000);
              }
            },
            options
          );
        });
      };

      try {
        await tryGetLocation();
        
        if (bestLocation) {
          const location = bestLocation as Location;
          console.log('Best location found:', {
            latitude: location.lat,
            longitude: location.lng,
            accuracy: bestAccuracy + ' meters'
          });
          
          this.currentLocationSubject.next(location);
          resolve(location);
        } else {
          reject(new Error('Unable to get device location after multiple attempts'));
        }
      } catch (error) {
        reject(error);
      }
    });
  }
}
