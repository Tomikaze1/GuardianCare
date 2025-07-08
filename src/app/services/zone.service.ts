import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ZoneService {

  constructor() { }

  classifyZone(severity: number): string {
    if (severity > 8) {
      return 'Danger';
    } else if (severity > 5) {
      return 'Caution';
    } else if (severity > 2) {
      return 'Neutral';
    } else {
      return 'Safe';
    }
  }

  getZoneLevelAtLocation(lat: number, lng: number): string {
    const mockSeverity = Math.random() * 10;
    return this.classifyZone(mockSeverity);
  }
}