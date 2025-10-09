import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReportsService, Report } from '../services/reports.service';
import { Subscription } from 'rxjs';
import * as mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN } from '../mapbox.config';

@Component({
  selector: 'app-heatmap',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './heatmap.html',
  styleUrls: ['./heatmap.css']
})
export class HeatmapComponent implements OnInit, OnDestroy, AfterViewInit {
  map: mapboxgl.Map | null = null;
  markers: mapboxgl.Marker[] = [];
  reports: Report[] = [];
  filteredReports: Report[] = [];
  private subscription: Subscription = new Subscription();
  private webglContextLost: boolean = false;
  private webglContextLostHandler: (() => void) | null = null;
  private webglContextRestoredHandler: (() => void) | null = null;
  private mapErrorHandler: ((e: any) => void) | null = null;
  
  private handleWindowResize = () => {
    if (!this.map || this.webglContextLost) return;
    try {
      this.map.resize();
    } catch (error) {
      console.warn('Map resize failed:', error);
      this.handleWebGLError();
    }
  };

  private handleWebGLError = () => {
    console.warn('WebGL context lost, attempting to recover...');
    this.webglContextLost = true;
    // Attempt to reinitialize the map after a short delay
    setTimeout(() => {
      if (this.map) {
        this.reinitializeMap();
      }
    }, 1000);
  };

  private reinitializeMap() {
    try {
      if (this.map) {
        this.map.remove();
        this.map = null;
      }
      this.webglContextLost = false;
      this.initializeMap();
    } catch (error) {
      console.error('Failed to reinitialize map:', error);
    }
  }

  private waitForContainerSize(containerId: string, min = 50, timeoutMs = 4000): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const step = () => {
        const el = document.getElementById(containerId);
        const w = el?.clientWidth ?? 0;
        const h = el?.clientHeight ?? 0;
        if (w >= min && h >= min) {
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          resolve();
          return;
        }
        requestAnimationFrame(step);
      };
      step();
    });
  }

  // Filters
  filterRiskLevel: string = 'ALL';
  filterIncidentType: string = 'ALL';
  filterDateRange: string = 'ALL'; // default to ALL so counts/heatmap include every validated report
  showHeatLayer: boolean = true;

  // Stats - 5 validation levels
  totalIncidents: number = 0;
  level1Count: number = 0; // Low
  level2Count: number = 0; // Moderate
  level3Count: number = 0; // High
  level4Count: number = 0; // Critical
  level5Count: number = 0; // Extreme

  incidentTypes: string[] = [];

  constructor(private reportsService: ReportsService) {}

  ngOnInit() {
    console.log('🗺️ Heatmap component initialized');
    
    // Subscribe to validated reports only
    this.subscription.add(
      this.reportsService.getReports().subscribe(allReports => {
        // Filter only validated reports (exact match). Coordinates are handled downstream
        // to support both nested location and root lat/lng formats.
        this.reports = allReports.filter(r => r.status === 'Validated');
        console.log('📊 Validated reports loaded:', this.reports.length);
        
        // Extract unique incident types
        const types = new Set<string>();
        this.reports.forEach(r => {
          if (r.type) types.add(r.type);
        });
        this.incidentTypes = Array.from(types);
        
        this.applyFilters();
        this.updateStats();
        this.updateMapMarkers();
        this.updateHeatLayer();
      })
    );
  }

  ngAfterViewInit() {
    // Initialize map after view is ready and container has a non-zero size
    setTimeout(async () => {
      await this.waitForContainerSize('heatmap-container');
      this.initializeMap();
    }, 100);
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    
    // Clean up WebGL resources properly
    if (this.map) {
      try {
        // Remove all event listeners first
        if (this.webglContextLostHandler) {
          this.map.off('webglcontextlost', this.webglContextLostHandler);
        }
        if (this.webglContextRestoredHandler) {
          this.map.off('webglcontextrestored', this.webglContextRestoredHandler);
        }
        if (this.mapErrorHandler) {
          this.map.off('error', this.mapErrorHandler);
        }
        
        // Clear markers
        this.markers.forEach(marker => marker.remove());
        this.markers = [];
        
        // Remove map
        this.map.remove();
        this.map = null;
      } catch (error) {
        console.warn('Error during map cleanup:', error);
      }
    }
    
    window.removeEventListener('resize', this.handleWindowResize);
  }

  private initializeMap() {
    // Set Mapbox access token only via Map constructor (avoid assigning to import)
    const token = MAPBOX_TOKEN;

    // Default center (Cebu City, Philippines)
    const defaultCenter: [number, number] = [123.8931, 10.3157];

    // Ensure container exists, is empty, and has a usable size
    const containerEl = document.getElementById('heatmap-container');
    if (containerEl) {
      // Clear any previous children/canvas if Angular reuses DOM
      while (containerEl.firstChild) {
        containerEl.removeChild(containerEl.firstChild);
      }
      // Guard against zero-sized canvas; enforce a minimum height
      const w = containerEl.clientWidth;
      const h = containerEl.clientHeight;
      if (w < 50 || h < 50) {
        containerEl.style.minHeight = '400px';
        containerEl.style.height = containerEl.style.height || '600px';
      }
    }

    this.map = new mapboxgl.Map({
      accessToken: token,
      container: 'heatmap-container',
      style: 'mapbox://styles/mapbox/light-v11',
      center: defaultCenter,
      zoom: 13,
      // Simple white map
      pitch: 0,
      bearing: 0,
      // Optimized for simple navigation
      preserveDrawingBuffer: false,
      antialias: true,
      failIfMajorPerformanceCaveat: false
    });

    // Add WebGL context error handling
    this.webglContextLostHandler = () => {
      console.warn('WebGL context lost');
      this.handleWebGLError();
    };
    this.map.on('webglcontextlost', this.webglContextLostHandler);

    this.webglContextRestoredHandler = () => {
      console.log('WebGL context restored');
      this.webglContextLost = false;
    };
    this.map.on('webglcontextrestored', this.webglContextRestoredHandler);

    // Add error handling for map events
    this.mapErrorHandler = (e: any) => {
      console.error('Map error:', e);
      if (e.error && e.error.message && e.error.message.includes('WebGL')) {
        this.handleWebGLError();
      }
    };
    this.map.on('error', this.mapErrorHandler);

    // Add simple navigation controls
    this.map.addControl(new mapboxgl.NavigationControl({
      showCompass: true,
      showZoom: true,
      visualizePitch: false
    }), 'top-right');

    // Ensure map gets correct size once style and tiles are ready
    this.map.once('idle', () => {
      if (!this.webglContextLost) {
        try { 
          this.map!.resize(); 
        } catch (error) {
          console.warn('Map resize failed on idle:', error);
          this.handleWebGLError();
        }
      }
    });
    window.addEventListener('resize', this.handleWindowResize);

    this.map.on('load', () => {
      console.log('🗺️ Map loaded successfully');
      try { this.map!.resize(); } catch {}
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try { this.map!.resize(); } catch {}
      }));
      
      // Add heat source/layer once
      try {
        if (!this.map!.getSource('validated-incidents')) {
          this.map!.addSource('validated-incidents', {
            type: 'geojson',
            data: this.toGeoJSON(this.filteredReports)
          } as any);
        }
        // Clustered source for low-zoom visualization - FIXED CLUSTERING
        if (!this.map!.getSource('validated-incidents-cluster')) {
          this.map!.addSource('validated-incidents-cluster', {
            type: 'geojson',
            data: this.toGeoJSON(this.filteredReports),
            cluster: true,
            clusterRadius: 25, // ✅ FIXED: Reduced from 40 - only cluster very close incidents
            clusterMaxZoom: 14, // ✅ FIXED: Increased from 11 - show individual points when zoomed in more
            clusterProperties: {
              level1: ['+', ['case', ['==', ['get', 'weight'], 1], 1, 0]],
              level2: ['+', ['case', ['==', ['get', 'weight'], 2], 1, 0]],
              level3: ['+', ['case', ['==', ['get', 'weight'], 3], 1, 0]],
              level4: ['+', ['case', ['==', ['get', 'weight'], 4], 1, 0]],
              level5: ['+', ['case', ['==', ['get', 'weight'], 5], 1, 0]],
              maxLevel: ['max', ['get', 'weight']]
            }
          } as any);
        }

        // Log cluster statistics
        console.log(`🗺️ Admin Heatmap Update: ${this.filteredReports.length} total validated incidents`);
        console.log(`🎯 Cluster Settings: radius=25px, maxZoom=14 (tighter clustering for accuracy)`);
        console.log(`📊 Zoom behavior:
          - Zoom 5-11: Clusters only (overview)
          - Zoom 12-14: Clusters + individual points transition
          - Zoom 15+: Individual points only (detail view)
        `);

        // Heatmap by level (no shared halo). Make higher levels dominate blends
        // by increasing weight/intensity and using slightly tighter radii.
        const heatLayers = [
          {
            id: 'heat-l1', level: 1, rgba: [16,185,129],
            weight: 0.6,
            radiusStops: [5, 28, 10, 40, 15, 56],
            intensityStops: [5, 1.0, 10, 1.3, 15, 1.6]
          },
          {
            id: 'heat-l2', level: 2, rgba: [251,191,36],
            weight: 0.8,
            radiusStops: [5, 26, 10, 38, 15, 52],
            intensityStops: [5, 1.1, 10, 1.5, 15, 1.8]
          },
          {
            id: 'heat-l3', level: 3, rgba: [249,115,22],
            weight: 1.0,
            radiusStops: [5, 24, 10, 36, 15, 48],
            intensityStops: [5, 1.3, 10, 1.7, 15, 2.0]
          },
          {
            id: 'heat-l4', level: 4, rgba: [239,68,68],
            weight: 1.2,
            radiusStops: [5, 22, 10, 34, 15, 44],
            intensityStops: [5, 1.5, 10, 1.9, 15, 2.2]
          },
          {
            id: 'heat-l5', level: 5, rgba: [220,38,38],
            weight: 1.4,
            radiusStops: [5, 20, 10, 32, 15, 40],
            intensityStops: [5, 1.7, 10, 2.1, 15, 2.4]
          }
        ];

        heatLayers.forEach(layer => {
          if (!this.map!.getLayer(layer.id)) {
            this.map!.addLayer({
              id: layer.id,
              type: 'heatmap',
              source: 'validated-incidents',
              minzoom: 5,
              maxzoom: 16,
              filter: ['==', ['get', 'weight'], layer.level],
              paint: {
                'heatmap-weight': layer.weight,
                'heatmap-radius': ['interpolate', ['linear'], ['zoom'],
                  layer.radiusStops[0], layer.radiusStops[1],
                  layer.radiusStops[2], layer.radiusStops[3],
                  layer.radiusStops[4], layer.radiusStops[5]
                ],
                'heatmap-intensity': ['interpolate', ['linear'], ['zoom'],
                  layer.intensityStops[0], layer.intensityStops[1],
                  layer.intensityStops[2], layer.intensityStops[3],
                  layer.intensityStops[4], layer.intensityStops[5]
                ],
                'heatmap-opacity': this.showHeatLayer ? 0.6 : 0, // Reduced from 0.7 to prevent color bleeding
                'heatmap-color': [
                  'interpolate', ['linear'], ['heatmap-density'],
                  0.00, 'rgba(0,0,0,0)',
                  0.15, ['rgba', layer.rgba[0], layer.rgba[1], layer.rgba[2], 0.25],
                  0.40, ['rgba', layer.rgba[0], layer.rgba[1], layer.rgba[2], 0.6],
                  0.70, ['rgba', layer.rgba[0], layer.rgba[1], layer.rgba[2], 0.85],
                  1.00, ['rgba', layer.rgba[0], layer.rgba[1], layer.rgba[2], 1.0]
                ]
              }
            } as any);
          }
        });

        // Low-zoom cluster circles (solid color by dominant level) - ✅ FIXED: Extended maxzoom
        if (!this.map!.getLayer('cluster-circles')) {
          this.map!.addLayer({
            id: 'cluster-circles',
            type: 'circle',
            source: 'validated-incidents-cluster',
            filter: ['has', 'point_count'],
            maxzoom: 15, // ✅ FIXED: Increased from 12 - show clusters longer
            paint: {
              'circle-radius': [
                'step', ['get', 'point_count'],
                14, 10, 18, 25, 24, 50, 30
              ],
              'circle-color': [
                'match', ['get', 'maxLevel'],
                1, '#10b981',
                2, '#fbbf24',
                3, '#f97316',
                4, '#ef4444',
                5, '#dc2626',
                '#10b981'
              ],
              'circle-opacity': this.showHeatLayer ? 0.6 : 0.0,
              'circle-stroke-width': 2,
              'circle-stroke-color': 'white'
            }
          } as any);
        }
        // Cluster count labels - ✅ FIXED: Extended maxzoom
        if (!this.map!.getLayer('cluster-count')) {
          this.map!.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: 'validated-incidents-cluster',
            filter: ['has', 'point_count'],
            maxzoom: 15, // ✅ FIXED: Increased from 12 - show cluster counts longer
            layout: {
              'text-field': ['get', 'point_count_abbreviated'],
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
              'text-size': 12
            },
            paint: {
              'text-color': '#111827'
            }
          } as any);
        }

        // ✅ NEW: Add individual unclustered points (visible when zoomed in past cluster threshold)
        if (!this.map!.getLayer('unclustered-points')) {
          this.map!.addLayer({
            id: 'unclustered-points',
            type: 'circle',
            source: 'validated-incidents-cluster',
            filter: ['!', ['has', 'point_count']], // Only show points that are NOT clustered
            minzoom: 12, // Start showing individual points from zoom 12
            paint: {
              'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                12, 6,   // At zoom 12, radius 6px
                15, 10,  // At zoom 15, radius 10px
                18, 14   // At zoom 18, radius 14px
              ],
              'circle-color': [
                'match', ['get', 'weight'],
                1, '#10b981', // Green - Level 1
                2, '#fbbf24', // Yellow - Level 2
                3, '#f97316', // Orange - Level 3
                4, '#ef4444', // Red - Level 4
                5, '#dc2626', // Dark Red - Level 5
                '#10b981'     // Default green
              ],
              'circle-opacity': this.showHeatLayer ? 0.8 : 0.0,
              'circle-stroke-width': 2,
              'circle-stroke-color': 'white',
              'circle-stroke-opacity': 0.9
            }
          } as any);
        }
      } catch (e) {
        console.error('Failed adding heat layer:', e);
      }

      this.updateMapMarkers();
      this.updateHeatLayer();
    });

    // Refresh markers visibility when zoom changes so low-zoom shows heat only
    this.map.on('zoomend', () => {
      this.updateMapMarkers();
    });

    // Log and safely handle map errors
    this.map.on('error', (e) => {
      console.error('Mapbox GL error:', e && (e as any).error);
    });
  }

  private updateMapMarkers() {
    if (!this.map) return;

    // Only show individual markers at high zoom to avoid color stacking
    const zoom = this.map.getZoom();
    const shouldShowMarkers = !this.showHeatLayer || zoom >= 14;

    // Remove existing markers
    this.markers.forEach(marker => marker.remove());
    this.markers = [];

    if (!shouldShowMarkers) {
      return; // keep map clean at lower zooms; heat layers convey density
    }

    // Add markers for filtered reports
    this.filteredReports.forEach(report => {
      // Accept either nested location object or root lat/lng fields
      let lat: number | undefined;
      let lng: number | undefined;

      if (report.location && typeof report.location !== 'string') {
        const loc = report.location as { lat?: number; lng?: number };
        lat = loc.lat;
        lng = loc.lng;
      }

      if ((lat === undefined || lng === undefined) && (report as any).lat && (report as any).lng) {
        lat = (report as any).lat;
        lng = (report as any).lng;
      }

      if (lat === undefined || lng === undefined) return;

      // Create custom marker element
      const el = document.createElement('div');
      el.className = 'custom-marker';
      el.style.width = '30px';
      el.style.height = '30px';
      el.style.borderRadius = '50%';
      el.style.cursor = 'pointer';
      el.style.border = '3px solid white';
      el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
      
      // Color based on risk level
      const color = this.getRiskColor(report.riskLevel || report.level || 1);
      el.style.backgroundColor = color;

      // Create popup
      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
        <div style="padding: 10px; min-width: 200px;">
          <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">
            ${report.type || 'Incident'}
          </h3>
          <p style="margin: 5px 0; font-size: 13px; color: #666;">
            <strong>Risk Level:</strong> ${report.riskLevel || report.level || 'N/A'}
          </p>
          <p style="margin: 5px 0; font-size: 13px; color: #666;">
            <strong>Location:</strong> ${report.locationAddress || 'Unknown'}
          </p>
          <p style="margin: 5px 0; font-size: 13px; color: #666;">
            <strong>Date:</strong> ${this.formatDate(report.timestamp)}
          </p>
          <p style="margin: 5px 0; font-size: 13px; color: #666;">
            <strong>Description:</strong> ${report.description.substring(0, 100)}...
          </p>
          <div style="margin-top: 10px; padding: 5px; background: ${color}; color: white; border-radius: 4px; text-align: center; font-size: 12px; font-weight: bold;">
            ${this.getRiskLabel(report.riskLevel || report.level || 1)}
          </div>
        </div>
      `);

      // Add marker to map
      const marker = new mapboxgl.Marker(el)
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(this.map!);

      this.markers.push(marker);
    });

    // Fit map to markers if we have any
    if (this.filteredReports.length > 0) {
      const container = this.map.getContainer() as HTMLElement;
      const containerWidth = container?.clientWidth ?? 0;
      const containerHeight = container?.clientHeight ?? 0;
      if (containerWidth < 50 || containerHeight < 50) {
        // Canvas is effectively zero-sized; skip fitting for now
        try { this.map.resize(); } catch {}
        return;
      }

      const bounds = new mapboxgl.LngLatBounds();
      
      this.filteredReports.forEach(report => {
        let lat: number | undefined;
        let lng: number | undefined;
        if (report.location && typeof report.location !== 'string') {
          const loc = report.location as { lat?: number; lng?: number };
          lat = loc.lat;
          lng = loc.lng;
        }
        if ((lat === undefined || lng === undefined) && (report as any).lat && (report as any).lng) {
          lat = (report as any).lat;
          lng = (report as any).lng;
        }
        if (lat !== undefined && lng !== undefined) {
          bounds.extend([lng, lat]);
        }
      });

      try {
        this.map.fitBounds(bounds, {
          padding: 50,
          maxZoom: 15
        });
      } catch (e) {
        // If map cannot fit bounds yet (e.g., container just mounted), retry shortly
        setTimeout(() => {
          try {
            this.map!.resize();
            this.map!.fitBounds(bounds, { padding: 50, maxZoom: 15 });
          } catch {}
        }, 100);
      }
    }

    console.log('📍 Added', this.markers.length, 'markers to map');
  }

  private toGeoJSON(reports: Report[]) {
    return {
      type: 'FeatureCollection',
      features: reports
        .map(r => {
          // Accept nested location or root lat/lng
          let lat: number | undefined;
          let lng: number | undefined;
          if (r.location && typeof r.location !== 'string') {
            const loc = r.location as { lat?: number; lng?: number };
            lat = loc.lat;
            lng = loc.lng;
          }
          if ((lat === undefined || lng === undefined) && (r as any).lat && (r as any).lng) {
            lat = (r as any).lat;
            lng = (r as any).lng;
          }
          if (lat === undefined || lng === undefined) return null as any;
          const weight = (r.riskLevel ?? r.level ?? 1);
          return {
            type: 'Feature',
            properties: { weight },
            geometry: {
              type: 'Point',
              coordinates: [lng, lat]
            }
          } as any;
        })
        .filter(Boolean)
    } as any;
  }

  private updateHeatLayer() {
    if (!this.map) return;
    const src = this.map.getSource('validated-incidents') as mapboxgl.GeoJSONSource | undefined;
    if (src) {
      src.setData(this.toGeoJSON(this.filteredReports));
    }
    const clusterSrc = this.map.getSource('validated-incidents-cluster') as mapboxgl.GeoJSONSource | undefined;
    if (clusterSrc) {
      clusterSrc.setData(this.toGeoJSON(this.filteredReports));
    }

    // Update per-level heatmap opacity
    ['heat-l1','heat-l2','heat-l3','heat-l4','heat-l5'].forEach(id => {
      if (this.map!.getLayer(id)) {
        this.map!.setPaintProperty(id, 'heatmap-opacity', this.showHeatLayer ? 0.6 : 0);
      }
    });

    // Update cluster layers visibility for low zooms
    if (this.map.getLayer('cluster-circles')) {
      this.map.setPaintProperty('cluster-circles', 'circle-opacity', this.showHeatLayer ? 0.6 : 0);
    }
    if (this.map.getLayer('cluster-count')) {
      const vis = this.showHeatLayer ? 'visible' : 'none';
      this.map.setLayoutProperty('cluster-count', 'visibility', vis as any);
    }
    // ✅ NEW: Update unclustered points visibility
    if (this.map.getLayer('unclustered-points')) {
      this.map.setPaintProperty('unclustered-points', 'circle-opacity', this.showHeatLayer ? 0.8 : 0);
    }
  }

  applyFilters() {
    this.filteredReports = this.reports.filter(report => {
      // Risk level filter
      if (this.filterRiskLevel !== 'ALL') {
        const riskLevel = report.riskLevel || report.level || 0;
        if (riskLevel.toString() !== this.filterRiskLevel) return false;
      }

      // Incident type filter
      if (this.filterIncidentType !== 'ALL') {
        if (report.type !== this.filterIncidentType) return false;
      }

      // Date range filter
      if (this.filterDateRange !== 'ALL') {
        const days = parseInt(this.filterDateRange);
        const reportDate = new Date(report.timestamp);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        if (reportDate < cutoffDate) return false;
      }

      return true;
    });

    console.log('🔍 Filtered reports:', this.filteredReports.length, 'of', this.reports.length);
    this.updateMapMarkers();
  }

  updateStats() {
    // Stats should reflect what admin currently sees on the map (filtered set)
    const validated = this.filteredReports.length > 0 || this.filterRiskLevel !== 'ALL' || this.filterIncidentType !== 'ALL' || this.filterDateRange !== 'ALL'
      ? this.filteredReports
      : this.reports; // fallback to all validated if no filters applied

    this.totalIncidents = validated.length;
    
    // Count incidents for each validation level
    this.level1Count = validated.filter(r => {
      const level = r.riskLevel ?? r.level ?? 0;
      return level === 1;
    }).length;
    
    this.level2Count = validated.filter(r => {
      const level = r.riskLevel ?? r.level ?? 0;
      return level === 2;
    }).length;
    
    this.level3Count = validated.filter(r => {
      const level = r.riskLevel ?? r.level ?? 0;
      return level === 3;
    }).length;
    
    this.level4Count = validated.filter(r => {
      const level = r.riskLevel ?? r.level ?? 0;
      return level === 4;
    }).length;
    
    this.level5Count = validated.filter(r => {
      const level = r.riskLevel ?? r.level ?? 0;
      return level === 5;
    }).length;
  }

  onFilterChange() {
    this.applyFilters();
    this.updateStats();
  }

  clearFilters() {
    this.filterRiskLevel = 'ALL';
    this.filterIncidentType = 'ALL';
    this.filterDateRange = '30';
    this.applyFilters();
    this.updateStats();
  }

  toggleHeatLayer() {
    if (!this.map) return;
    const layerId = 'validated-heat';
    const exists = this.map.getLayer(layerId);
    if (!exists) return;
    const visibility = this.showHeatLayer ? 'visible' : 'none';
    this.map.setLayoutProperty(layerId, 'visibility', visibility as any);
  }

  private getRiskColor(level: number): string {
    // 5-level color system based on validation levels
    if (level <= 1) return '#10b981'; // Green (low)
    if (level === 2) return '#fbbf24'; // Yellow (moderate)
    if (level === 3) return '#f97316'; // Orange (high)
    if (level === 4) return '#ef4444'; // Red (critical)
    return '#dc2626'; // Dark Red (extreme)
  }

  private getRiskLabel(level: number): string {
    switch (level) {
      case 1: return 'LEVEL 1 - LOW';
      case 2: return 'LEVEL 2 - MODERATE';
      case 3: return 'LEVEL 3 - HIGH';
      case 4: return 'LEVEL 4 - CRITICAL';
      case 5: return 'LEVEL 5 - EXTREME';
      default: return 'UNKNOWN';
    }
  }

  private formatDate(date: Date): string {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

