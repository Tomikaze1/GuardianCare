import { Component, OnInit } from '@angular/core';
import { LocationService } from '../services/location.service';
import * as mapboxgl from 'mapbox-gl';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit {
  map: mapboxgl.Map | undefined;
  currentLocation: { lat: number; lng: number } | undefined;

  constructor(private locationService: LocationService) { }

  ngOnInit() {
    this.getCurrentLocation();
  }

  async getCurrentLocation() {
    try {
      this.currentLocation = await this.locationService.getCurrentLocation();
      this.initializeMap();
    } catch (error) {
      console.error('Error getting location:', error);
      this.currentLocation = { lng: 123.8931, lat: 10.3111 }; 
      this.initializeMap();
    }
  }

  initializeMap() {
    if (!this.currentLocation) return;

    (mapboxgl as any).accessToken = 'pk.eyJ1IjoidG9taWthemUxIiwiYSI6ImNtY25rM3NxazB2ZG8ybHFxeHVoZWthd28ifQ.Vnf9pMEQAryEI2rMJeMQGQ';

    this.map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v11',
      center: [this.currentLocation.lng, this.currentLocation.lat],
      zoom: 12 
    });

    new mapboxgl.Marker()
      .setLngLat([this.currentLocation.lng, this.currentLocation.lat])
      .addTo(this.map);

    this.map.addControl(new mapboxgl.NavigationControl());

    this.map.on('load', () => {
      this.addDangerZones();
    });
  }

  addDangerZones() {
    if (!this.map) return;

    const zones = [
      {
        level: 'Danger',
        coordinates: [
          [123.8965, 10.2950],
          [123.8970, 10.2955],
          [123.8975, 10.2950],
          [123.8970, 10.2945]
        ]
      },
      {
        level: 'Caution',
        coordinates: [
          [123.8790, 10.3195],
          [123.8795, 10.3200],
          [123.8800, 10.3195],
          [123.8795, 10.3190]
        ]
      },
      {
        level: 'Danger',
        coordinates: [
          [123.9541, 10.3158],
          [123.9553, 10.3165],
          [123.9562, 10.3153],
          [123.9550, 10.3145]
        ]
      },
      {
        level: 'Caution',
        coordinates: [
          [123.8952, 10.2965],
          [123.8970, 10.2985],
          [123.8990, 10.2970],
          [123.8978, 10.2955]
        ]
      },
      {
        level: 'Neutral',
        coordinates: [
          [123.8937, 10.3151],
          [123.8950, 10.3164],
          [123.8965, 10.3159],
          [123.8945, 10.3149]
        ]
      },
      {
        level: 'Safe',
        coordinates: [
          [123.9671, 10.3085],
          [123.9705, 10.3100],
          [123.9730, 10.3080],
          [123.9700, 10.3065]
        ]
      }
    ];

    const bounds = new mapboxgl.LngLatBounds();

    zones.forEach(zone => {
      zone.coordinates.forEach(coord => bounds.extend([coord[0], coord[1]]));

      if (this.map?.getSource(`zone-${zone.level}`)) {
        this.map?.removeLayer(`zone-${zone.level}-fill`);
        this.map?.removeLayer(`zone-${zone.level}-outline`);
        this.map?.removeSource(`zone-${zone.level}`);
      }

      this.map?.addSource(`zone-${zone.level}`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [zone.coordinates]
          },
          properties: {}
        }
      });

      this.map?.addLayer({
        id: `zone-${zone.level}-fill`,
        type: 'fill',
        source: `zone-${zone.level}`,
        paint: {
          'fill-color': this.getZoneColor(zone.level),
          'fill-opacity': 0.5
        }
      });

      this.map?.addLayer({
        id: `zone-${zone.level}-outline`,
        type: 'line',
        source: `zone-${zone.level}`,
        paint: {
          'line-color': this.getZoneColor(zone.level),
          'line-width': 2
        }
      });
    });

    this.map?.fitBounds(bounds, { padding: 40 });
  }

  getZoneColor(level: string): string {
    switch (level) {
      case 'Danger': return '#ff0000';
      case 'Caution': return '#ffaa00';
      case 'Neutral': return '#ffff00';
      case 'Safe': return '#00ff00';
      default: return '#aaaaaa';
    }
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
    }
  }
}
