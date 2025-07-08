export interface DangerZone {
  id: string;
  name: string;
  level: 'Safe' | 'Neutral' | 'Caution' | 'Danger';
  coordinates: [number, number][]; 
  timeSlots: {
    range: string; 
    severity: 'Low' | 'Medium' | 'High';
  }[];
  incidentsCount: number;
  lastIncidentDate: string;
}
