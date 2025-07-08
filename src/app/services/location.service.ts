import { Injectable } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';
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

  private async startTracking() {
    try {
      Geolocation.watchPosition({ enableHighAccuracy: true }, (position) => {
        if (position) {
          this.currentLocation.next({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        }
      });
    } catch (error) {
      console.error('Location tracking error:', error);
    }
  }

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