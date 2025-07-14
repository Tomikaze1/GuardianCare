import { Injectable } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';
import { BehaviorSubject } from 'rxjs';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class LocationService {
  private currentLocation = new BehaviorSubject<{lat: number, lng: number} | null>(null);
  currentLocation$ = this.currentLocation.asObservable();

  constructor(private http: HttpClient) {
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
      const coordinates = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000
      });
      return {
        lat: coordinates.coords.latitude,
        lng: coordinates.coords.longitude
      };
    } catch (error) {
      console.error('Error getting location:', error);
      return { lat: 10.3111, lng: 123.8931 }; // Cebu, Philippines fallback
    }
  }

  // Added method for reverse geocoding (required by incident reporting form)
  async reverseGeocode(latitude: number, longitude: number): Promise<string> {
    try {
      // Using OpenStreetMap Nominatim (free alternative)
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`;
      
      const response = await this.http.get<any>(url).toPromise();
      
      if (response && response.display_name) {
        return response.display_name;
      } else {
        throw new Error('No address found');
      }
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      // Fallback to coordinates if geocoding fails
      return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    }
  }

  // Get current location with address
  async getCurrentLocationWithAddress(): Promise<{ lat: number; lng: number; address: string }> {
    try {
      const coords = await this.getCurrentLocation();
      const address = await this.reverseGeocode(coords.lat, coords.lng);
      
      return {
        lat: coords.lat,
        lng: coords.lng,
        address: address
      };
    } catch (error) {
      console.error('Error getting location with address:', error);
      return {
        lat: 10.3111,
        lng: 123.8931,
        address: 'Cebu City, Philippines'
      };
    }
  }

  // Calculate distance between two points (useful for proximity features)
  calculateDistance(pos1: {lat: number, lng: number}, pos2: {lat: number, lng: number}): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = pos1.lat * Math.PI / 180;
    const φ2 = pos2.lat * Math.PI / 180;
    const Δφ = (pos2.lat - pos1.lat) * Math.PI / 180;
    const Δλ = (pos2.lng - pos1.lng) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
  }
}
