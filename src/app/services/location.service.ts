import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LocationService {
  private currentLocation = new BehaviorSubject<{lat: number, lng: number} | null>(null);
  currentLocation$ = this.currentLocation.asObservable();

  constructor() {
    this.startTracking();
  }

  private startTracking() {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (position) => {
          this.currentLocation.next({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => console.error('Location error:', error),
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }
      );
    }
  }

  getCurrentLocation(): Promise<{lat: number, lng: number}> {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        }),
        reject,
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }
}