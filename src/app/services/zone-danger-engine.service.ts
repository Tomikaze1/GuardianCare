
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
    this.loadZones();
    setInterval(() => this.updateAllZones(), 60 * 60 * 1000);
  }

  private loadZones() {
    this.firebaseService.getDocuments('dangerZones').subscribe(zones => {
      this.zones.next(zones as DangerZone[]);
      this.updateAllZones();
    });
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
    const updatedZones = this.zones.value.map(zone => 
      this.calculateZoneDanger(zone)
    );
    this.zones.next(updatedZones);
    this.syncToFirestore(updatedZones);
  }

  private calculateZoneDanger(zone: DangerZone): DangerZone {
    const now = new Date();
    const currentHour = now.getHours();

    const activeSlot = zone.timeSlots.find(slot => 
      this.isTimeInSlot(currentHour, slot)
    );
    const timeSeverity = activeSlot?.baseSeverity || 1;

    const incidentSeverity = this.calculateIncidentSeverity(zone, now);

    const totalSeverity = 
      (timeSeverity * this.weights.timeSlot) + 
      (incidentSeverity * this.weights.frequency);

    const level = this.classifyDangerLevel(totalSeverity);

    return {
      ...zone,
      currentSeverity: totalSeverity,
      level,
      incidents: zone.incidents.filter(i => 
        (now.getTime() - i.timestamp.getTime()) < (30 * 24 * 60 * 60 * 1000)
      )
    };
  }

  private calculateIncidentSeverity(zone: DangerZone, currentTime: Date): number {
    if (zone.incidents.length === 0) return 1;

    const recentIncidents = zone.incidents.filter(i => 
      (currentTime.getTime() - i.timestamp.getTime()) < (7 * 24 * 60 * 60 * 1000)
    );

    if (recentIncidents.length === 0) return 1;

    const avgSeverity = recentIncidents.reduce((sum, i) => sum + i.severity, 0) / recentIncidents.length;
    const frequencyFactor = Math.min(recentIncidents.length / 5, 2);

    return avgSeverity * frequencyFactor;
  }

  private findZonesContainingLocation(location: { lat: number; lng: number }, zones: DangerZone[]): DangerZone[] {
    return zones.filter(zone => 
      this.isPointInPolygon([location.lng, location.lat], zone.coordinates)
    );
  }

  private isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      
      const intersect = ((yi > point[1]) !== (yj > point[1]))
        && (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private isTimeInSlot(hour: number, slot: TimeSlot): boolean {
    if (slot.startHour <= slot.endHour) {
      return hour >= slot.startHour && hour < slot.endHour;
    } else {
      return hour >= slot.startHour || hour < slot.endHour; 
    }
  }

  private classifyDangerLevel(severity: number): 'Safe' | 'Neutral' | 'Caution' | 'Danger' {
    if (severity > 7.5) return 'Danger';
    if (severity > 5) return 'Caution';
    if (severity > 2.5) return 'Neutral';
    return 'Safe';
  }

  private mapSeverityToValue(severity: 'low' | 'medium' | 'high'): number {
    switch(severity) {
      case 'low': return 2;
      case 'medium': return 5;
      case 'high': return 8;
      default: return 1;
    }
  }

  private syncToFirestore(zones: DangerZone[]) {
    const batch = this.firebaseService.getFirestoreInstance().firestore.batch();
    zones.forEach(zone => {
      const ref = this.firebaseService.getFirestoreInstance()
        .collection('dangerZones').doc(zone.id).ref;
      batch.update(ref, {
        level: zone.level,
        currentSeverity: zone.currentSeverity,
        incidents: zone.incidents
      });
    });
    batch.commit();
  }
}