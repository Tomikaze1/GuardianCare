import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';
import { BehaviorSubject } from 'rxjs';

export interface DangerZone {
  id: string;
  name: string;
  level: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
  coordinates: [number, number][]; 
  timeSlots: TimeSlot[];
  incidents: ZoneIncident[];
  currentSeverity: number;
}

interface TimeSlot {
  startHour: number; 
  endHour: number; 
  baseSeverity: number; 
}

interface ZoneIncident {
  id: string;
  timestamp: Date;
  severity: number; 
}

@Injectable({
  providedIn: 'root'
})
export class ZoneDangerEngineService {
  private zones = new BehaviorSubject<DangerZone[]>([]);
  public zones$ = this.zones.asObservable();

  private readonly weights = {
    timeSlot: 0.4,
    frequency: 0.3,
    recentness: 0.3
  };

  constructor(private firebaseService: FirebaseService) {
    setTimeout(() => {
      this.loadZones();
    }, 100);
    
    setInterval(() => this.updateAllZones(), 60 * 60 * 1000);
  }

  private loadZones() {
    try {
      this.firebaseService.getDocuments('dangerZones').subscribe({
        next: (zones) => {
          console.log('ZoneDangerEngineService: Zones loaded from Firestore:', zones);
          this.zones.next(zones as DangerZone[]);
          this.updateAllZones();
        },
        error: (error) => {
          console.error('ZoneDangerEngineService: Error loading zones:', error);
          this.zones.next([]);
        }
      });
    } catch (error) {
      console.error('ZoneDangerEngineService: Error in loadZones:', error);
      this.zones.next([]);
    }
  }

  public processIncident(location: { lat: number; lng: number }, severity: 'low' | 'medium' | 'high') {
    const zones = this.zones.value;
    const affectedZones = this.findZonesContainingLocation(location, zones);
    
    affectedZones.forEach(zone => {
      zone.incidents.push({
        id: Date.now().toString(),
        timestamp: new Date(),
        severity: this.mapSeverityToValue(severity)
      });
      this.calculateZoneDanger(zone);
    });

    this.syncToFirestore(affectedZones);
  }

  private updateAllZones() {
    try {
      const currentZones = this.zones.value;
      if (!currentZones || currentZones.length === 0) {
        console.log('ZoneDangerEngineService: No zones to update');
        return;
      }
      
      const updatedZones = currentZones.map(zone => 
        this.calculateZoneDanger(zone)
      );
      this.zones.next(updatedZones);
      this.syncToFirestore(updatedZones);
    } catch (error) {
      console.error('ZoneDangerEngineService: Error updating zones:', error);
    }
  }

  private calculateZoneDanger(zone: DangerZone): DangerZone {
    const currentTime = new Date();
    const timeSlotSeverity = this.calculateTimeSlotSeverity(zone, currentTime);
    const incidentSeverity = this.calculateIncidentSeverity(zone, currentTime);
    
    const totalSeverity = (
      timeSlotSeverity * this.weights.timeSlot +
      incidentSeverity * this.weights.frequency +
      incidentSeverity * this.weights.recentness
    );
    
    zone.currentSeverity = Math.min(10, Math.max(0, totalSeverity));
    zone.level = this.classifyDangerLevel(zone.currentSeverity);
    
    return zone;
  }

  private calculateTimeSlotSeverity(zone: DangerZone, currentTime: Date): number {
    const currentHour = currentTime.getHours();
    const activeSlot = zone.timeSlots.find(slot => 
      this.isTimeInSlot(currentHour, slot)
    );
    return activeSlot ? activeSlot.baseSeverity : 0;
  }

  private calculateIncidentSeverity(zone: DangerZone, currentTime: Date): number {
    if (zone.incidents.length === 0) return 0;
    
    const recentIncidents = zone.incidents.filter(incident => {
      const timeDiff = currentTime.getTime() - incident.timestamp.getTime();
      return timeDiff <= 24 * 60 * 60 * 1000;
    });
    
    if (recentIncidents.length === 0) return 0;
    
    const totalSeverity = recentIncidents.reduce((sum, incident) => 
      sum + incident.severity, 0
    );
    
    return Math.min(10, totalSeverity / recentIncidents.length);
  }

  private findZonesContainingLocation(location: { lat: number; lng: number }, zones: DangerZone[]): DangerZone[] {
    return zones.filter(zone => 
      this.isPointInPolygon([location.lng, location.lat], zone.coordinates)
    );
  }

  private isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
    const [x, y] = point;
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  private isTimeInSlot(hour: number, slot: TimeSlot): boolean {
    if (slot.startHour <= slot.endHour) {
      return hour >= slot.startHour && hour <= slot.endHour;
    } else {
      return hour >= slot.startHour || hour <= slot.endHour;
    }
  }

  private classifyDangerLevel(severity: number): 'Safe' | 'Neutral' | 'Caution' | 'Danger' {
    if (severity <= 2) return 'Safe';
    if (severity <= 4) return 'Neutral';
    if (severity <= 7) return 'Caution';
    return 'Danger';
  }

  private mapSeverityToValue(severity: 'low' | 'medium' | 'high'): number {
    switch (severity) {
      case 'low': return 3;
      case 'medium': return 6;
      case 'high': return 9;
      default: return 5;
    }
  }

  private async syncToFirestore(zones: DangerZone[]) {
    const firestore = this.firebaseService.getFirestoreInstance();
    
    for (const zone of zones) {
      try {
        await firestore.collection('dangerZones').doc(zone.id).update({
          level: zone.level,
          currentSeverity: zone.currentSeverity,
          incidents: zone.incidents
        });
      } catch (error) {
        console.error(`Error updating zone ${zone.id}:`, error);
      }
    }
  }
}