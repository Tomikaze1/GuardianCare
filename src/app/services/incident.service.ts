import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface Incident {
  id: string;
  type: 'crime' | 'accident' | 'emergency' | 'suspicious';
  title: string;
  description: string;
  coordinates: { lat: number; lng: number };
  timestamp: Date;
  severity: 'low' | 'medium' | 'high';
  verified: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class IncidentService {
  private incidents = new BehaviorSubject<Incident[]>([]);
  incidents$ = this.incidents.asObservable();

  constructor() {
    this.loadIncidents();
  }

  private loadIncidents() {
    // Load from API or local storage
    const mockIncidents: Incident[] = [
      // Your incident data here
    ];
    this.incidents.next(mockIncidents);
  }

  addIncident(incident: Omit<Incident, 'id'>): void {
    const newIncident: Incident = {
      ...incident,
      id: Date.now().toString()
    };
    
    const currentIncidents = this.incidents.value;
    this.incidents.next([...currentIncidents, newIncident]);
  }

  getIncidentsInRadius(center: {lat: number, lng: number}, radius: number): Incident[] {
    return this.incidents.value.filter(incident => {
      const distance = this.calculateDistance(center, incident.coordinates);
      return distance <= radius;
    });
  }

  private calculateDistance(pos1: {lat: number, lng: number}, pos2: {lat: number, lng: number}): number {
    const R = 6371e3;
    const φ1 = pos1.lat * Math.PI / 180;
    const φ2 = pos2.lat * Math.PI / 180;
    const Δφ = (pos2.lat - pos1.lat) * Math.PI / 180;
    const Δλ = (pos2.lng - pos1.lng) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }
}