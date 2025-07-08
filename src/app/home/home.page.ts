import { Component, OnInit } from '@angular/core';
import { LocationService } from '../services/location.service';
import * as mapboxgl from 'mapbox-gl';
import { HttpClient } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit {
  map: mapboxgl.Map | undefined;
  currentLocation: { lat: number; lng: number } | undefined;
  inDangerZone = false;
  currentLanguage = 'en';
  languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'ja', name: '日本語' }
  ];
  zoneLayers: string[] = [];

  constructor(
    private locationService: LocationService,
    private http: HttpClient,
    private translate: TranslateService
  ) {
    this.translate.setDefaultLang('en');
  }

  ngOnInit() {
    this.getCurrentLocation();
    this.setupLocationMonitoring();
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

  setupLocationMonitoring() {
    this.locationService.currentLocation$.subscribe(location => {
      if (location) {
        this.currentLocation = location;
        this.checkZoneSafety();
      }
    });
  }

  checkZoneSafety() {
    if (!this.currentLocation || !this.map || this.zoneLayers.length === 0) return;
    
    const features = this.map.queryRenderedFeatures(
      this.map.project([this.currentLocation.lng, this.currentLocation.lat]),
      { layers: this.zoneLayers }
    );

    if (features.length > 0) {
      const zoneLevel = features[0].properties?.['level'] || 'Unknown';
      this.handleZoneEnter(zoneLevel);
    } else {
      this.inDangerZone = false;
    }
  }

  handleZoneEnter(zoneLevel: string) {
    if (zoneLevel === 'Danger' || zoneLevel === 'Caution') {
      this.inDangerZone = true;
      this.showWarningAlert(zoneLevel);
      this.autoRouteToSafeZone();
    } else {
      this.inDangerZone = false;
    }
  }

  showWarningAlert(zoneLevel: string) {
    const alertMessage = this.translate.instant(
      zoneLevel === 'Danger' ? 'DANGER_ZONE_WARNING' : 'CAUTION_ZONE_WARNING'
    );
    alert(alertMessage);
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
    this.map.addControl(new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true
    }));

    this.map.on('load', () => {
      this.addDangerZones();
      this.checkZoneSafety();
    });
    this.map.on('move', () => this.checkZoneSafety());
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
      
      const sourceId = `zone-${zone.level}`;
      const fillLayerId = `zone-${zone.level}-fill`;
      const outlineLayerId = `zone-${zone.level}-outline`;

      if (this.map?.getSource(sourceId)) {
        this.map?.removeLayer(fillLayerId);
        this.map?.removeLayer(outlineLayerId);
        this.map?.removeSource(sourceId);
      }

      this.map?.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [zone.coordinates]
          },
          properties: {
            level: zone.level
          }
        }
      });

      this.map?.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': this.getZoneColor(zone.level),
          'fill-opacity': 0.5
        }
      });

      this.map?.addLayer({
        id: outlineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': this.getZoneColor(zone.level),
          'line-width': 2
        }
      });

      this.zoneLayers.push(fillLayerId);
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

  autoRouteToSafeZone() {
    if (!this.map || !this.currentLocation) return;
    const safeZone = this.findNearestSafeZone();
    if (!safeZone) return;
    const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/walking/${
      this.currentLocation.lng},${this.currentLocation.lat};${
      safeZone.center[0]},${safeZone.center[1]}?geometries=geojson&access_token=${(mapboxgl as any).accessToken}`;
    this.http.get(directionsUrl).subscribe((data: any) => {
      this.drawRoute(data.routes[0].geometry);
    });
  }

  findNearestSafeZone(): { center: [number, number]; coordinates: number[][] } | undefined {
    return {
      center: [123.9671, 10.3085],
      coordinates: [
        [123.9671, 10.3085],
        [123.9705, 10.3100],
        [123.9730, 10.3080],
        [123.9700, 10.3065]
      ]
    };
  }

  drawRoute(route: any) {
    if (!this.map) return;
    if (this.map.getSource('route')) {
      this.map.removeLayer('route');
      this.map.removeSource('route');
    }
    this.map.addSource('route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: route
      }
    });
    this.map.addLayer({
      id: 'route',
      type: 'line',
      source: 'route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#3a7bd5',
        'line-width': 5
      }
    });
  }

  triggerPanicButton() {
    const alertMessage = this.translate.instant('PANIC_BUTTON_MESSAGE');
    alert(alertMessage);
    this.autoRouteToSafeZone();
  }

  changeLanguage(lang: string) {
    this.currentLanguage = lang;
    this.translate.use(lang);
  }

  ngOnDestroy() {
    if (this.map) this.map.remove();
  }
}