import { Injectable } from '@angular/core';
<<<<<<< HEAD
import { BehaviorSubject } from 'rxjs';
=======
import { Geolocation } from '@capacitor/geolocation';
>>>>>>> dad415551fb418a8df5d2e53060dd47cd1be0390

@Injectable({
  providedIn: 'root'
})
export class LocationService {
<<<<<<< HEAD
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
=======

  constructor() {}

  async getCurrentLocation(): Promise<{ lat: number; lng: number }> {
    try {
      const coordinates = await Geolocation.getCurrentPosition();
      return {
        lat: coordinates.coords.latitude,
        lng: coordinates.coords.longitude
      };
    } catch (error) {
      console.error('Error getting location:', error);
      return { lat: 10.3111, lng: 123.8931 };
    }
  }
}
>>>>>>> dad415551fb418a8df5d2e53060dd47cd1be0390
