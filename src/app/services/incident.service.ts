import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

export interface Incident {
  id: string;
  type: string;
  description: string;
  location: {
    lat: number;
    lng: number;
    address?: string;
  };
  timestamp: Date;
  severity: 'low' | 'medium' | 'high';
  status: 'pending' | 'verified' | 'resolved';
  reporterId: string;
  reporterName: string;
  media?: string[];
  anonymous: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class IncidentService {
  private incidents: Incident[] = [];

  constructor() {
    this.loadIncidents();
  }

  private loadIncidents() {
    const storedIncidents = localStorage.getItem('incidents');
    if (storedIncidents) {
      this.incidents = JSON.parse(storedIncidents);
    }
  }

  private saveIncidents() {
    localStorage.setItem('incidents', JSON.stringify(this.incidents));
  }

  getIncidents(): Observable<Incident[]> {
    return of(this.incidents);
  }

  addIncident(incident: Omit<Incident, 'id' | 'timestamp' | 'status'>): Observable<Incident> {
    const newIncident: Incident = {
      ...incident,
      id: Date.now().toString(),
      timestamp: new Date(),
      status: 'pending'
    };

    this.incidents.push(newIncident);
    this.saveIncidents();
    return of(newIncident);
  }

  updateIncident(id: string, updates: Partial<Incident>): Observable<Incident | null> {
    const index = this.incidents.findIndex(incident => incident.id === id);
    if (index !== -1) {
      this.incidents[index] = { ...this.incidents[index], ...updates };
      this.saveIncidents();
      return of(this.incidents[index]);
    }
    return of(null);
  }

  deleteIncident(id: string): Observable<boolean> {
    const index = this.incidents.findIndex(incident => incident.id === id);
    if (index !== -1) {
      this.incidents.splice(index, 1);
      this.saveIncidents();
      return of(true);
    }
    return of(false);
  }

  getIncidentById(id: string): Observable<Incident | null> {
    const incident = this.incidents.find(inc => inc.id === id);
    return of(incident || null);
  }

  getIncidentsByType(type: string): Observable<Incident[]> {
    const filtered = this.incidents.filter(incident => incident.type === type);
    return of(filtered);
  }

  getIncidentsBySeverity(severity: 'low' | 'medium' | 'high'): Observable<Incident[]> {
    const filtered = this.incidents.filter(incident => incident.severity === severity);
    return of(filtered);
  }

  getIncidentsByStatus(status: 'pending' | 'verified' | 'resolved'): Observable<Incident[]> {
    const filtered = this.incidents.filter(incident => incident.status === status);
    return of(filtered);
  }
}