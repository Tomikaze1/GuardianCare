import { Component, OnInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import * as mapboxgl from 'mapbox-gl';
import { ZoneDangerEngineService } from '../services/zone-danger-engine.service';
import { DangerZone } from '../services/zone-danger-engine.service';

@Component({
  selector: 'app-heatmap',
  templateUrl: './heatmap.page.html',
  styleUrls: ['./heatmap.page.scss'],
  standalone: false,
})
export class HeatmapPage implements OnInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef;
  map?: mapboxgl.Map;
  zones: DangerZone[] = [];

  constructor(private zoneEngine: ZoneDangerEngineService) {}

  ngOnInit(): void {
    this.zoneEngine.zones$.subscribe(zones => {
      this.zones = zones;
      if (this.map) {
        this.updateMap();
      }
    });
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
    }
  }

  @HostListener('window:resize', ['$event'])
  onResize() {
    if (this.map) {
      setTimeout(() => this.map?.resize(), 100);
    }
  }

  private initMap(): void {
    (mapboxgl as any).accessToken = 'pk.eyJ1IjoidG9taWthemUxIiwiYSI6ImNtY25rM3NxazB2ZG8ybHFxeHVoZWthd28ifQ.Vnf9pMEQAryEI2rMJeMQGQ';
    this.map = new mapboxgl.Map({
      container: this.mapContainer.nativeElement,
      style: 'mapbox://styles/mapbox/dark-v10',
      center: [123.8931, 10.3111],
      zoom: 12,
      interactive: true,
      trackResize: true,
      attributionControl: false
    });

    this.map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

    this.map.on('load', () => {
      this.updateMap();
      setTimeout(() => this.map?.resize(), 100);
    });
  }

  public updateMap(): void {
    if (!this.map || !this.map.isStyleLoaded()) {
      return;
    }

    // Clear existing layers
    this.zones.forEach((zone: DangerZone) => {
      const sourceId = `zone-${zone.id}`;
      if (this.map?.getSource(sourceId)) {
        this.map.removeLayer(`${sourceId}-fill`);
        this.map.removeLayer(`${sourceId}-outline`);
        this.map.removeSource(sourceId);
      }
    });

    // Add new zones
    this.zones.forEach((zone: DangerZone) => {
      const sourceId = `zone-${zone.id}`;
      const fillLayerId = `${sourceId}-fill`;
      const outlineLayerId = `${sourceId}-outline`;

      this.map?.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [zone.coordinates]
          },
          properties: {
            level: zone.level,
            severity: zone.currentSeverity
          }
        }
      });

      // Add heatmap-like fill layer
      this.map?.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['get', 'severity'],
            1, '#00ff00',  // Green (Safe)
            4, '#ffff00',  // Yellow (Neutral)
            6, '#ffaa00',  // Orange (Caution)
            8, '#ff0000'   // Red (Danger)
          ],
          'fill-opacity': 0.7
        }
      });

      // Add outline
      this.map?.addLayer({
        id: outlineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'level'], 'Danger'], '#ff0000',
            ['==', ['get', 'level'], 'Caution'], '#ffaa00',
            ['==', ['get', 'level'], 'Neutral'], '#ffff00',
            '#00ff00'
          ],
          'line-width': 2
        }
      });
    });
  }
}