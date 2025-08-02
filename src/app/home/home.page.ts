import { Component, OnInit, OnDestroy } from '@angular/core';
import { LocationService } from '../services/location.service';
import * as mapboxgl from 'mapbox-gl';
import { HttpClient } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { ZoneService } from '../services/zone.service';  
import { AlertService } from '../services/alert.service';
import { ZoneDangerEngineService, DangerZone } from '../services/zone-danger-engine.service';
import { IncidentService } from '../services/incident.service';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AlertController, ToastController } from '@ionic/angular';  

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit, OnDestroy {
  map: mapboxgl.Map | undefined;
  currentLocation: { lat: number; lng: number } | undefined;
  isHeatmapVisible = false;
  inDangerZone = false;
  currentLanguage = 'en';
  zoneLayers: string[] = [];
  zones: DangerZone[] = [];
  isPanicActive = false;

  languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'ja', name: '日本語' }
  ];

  constructor(
    private locationService: LocationService,
    private http: HttpClient,
    private translate: TranslateService,
    private zoneService: ZoneService,
    private alertService: AlertService,
    private zoneEngine: ZoneDangerEngineService,
    private incidentService: IncidentService,
    private afAuth: AngularFireAuth,
    private firestore: AngularFirestore,
    private alertController: AlertController,
    private toastController: ToastController
  ) {
    this.translate.setDefaultLang('en');
  }

  ngOnInit() {
    this.getCurrentLocation();
    this.setupLocationMonitoring();
    this.loadZones();
  }

  ngOnDestroy() {
    if (this.map) this.map.remove();
  }

  async getCurrentLocation() {
    try {
      this.currentLocation = await this.locationService.getCurrentLocation();
    } catch {
      this.currentLocation = { lat: 10.3173, lng: 123.9058 };
    }
    this.initializeMap();
  }

  setupLocationMonitoring() {
    this.locationService.currentLocation$.subscribe(loc => {
      if (loc) {
        this.currentLocation = loc;
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
      if (this.isHeatmapVisible) this.addDangerZones();
      this.checkZoneSafety();
    });

    this.map.on('move', () => this.checkZoneSafety());
  }



  addDangerZones() {
    if (!this.map) return;

    const zones = [
      {
        level: 'Safe',
        coordinates: [
          [123.9043, 10.3176],
          [123.9062, 10.3179],
          [123.9067, 10.3193],
          [123.9048, 10.3192],
          [123.9043, 10.3176]
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
      }
    ];

    zones.forEach(zone => {
      const sourceId = `zone-${zone.level}`;
      const fillLayerId = `zone-${zone.level}-fill`;
      const outlineLayerId = `zone-${zone.level}-outline`;

      if (this.map!.getSource(sourceId)) {
        this.map!.removeLayer(fillLayerId);
        this.map!.removeLayer(outlineLayerId);
        this.map!.removeSource(sourceId);
      }

      this.map!.addSource(sourceId, {
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

      this.map!.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': this.getZoneColor(zone.level),
          'fill-opacity': 0.5
        }
      });

      this.map!.addLayer({
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
  }

  removeDangerZones() {
    if (!this.map) return;
    this.zoneLayers.forEach(id => {
      if (this.map!.getLayer(id)) this.map!.removeLayer(id);
      if (this.map!.getSource(id)) this.map!.removeSource(id);
    });
    this.zoneLayers = [];
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
    const safeZone = { center: [123.9050, 10.3180] };
    const origin = `${this.currentLocation.lng.toFixed(6)},${this.currentLocation.lat.toFixed(6)}`;
    const destination = `${safeZone.center[0].toFixed(6)},${safeZone.center[1].toFixed(6)}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin};${destination}?geometries=geojson&overview=full&access_token=${(mapboxgl as any).accessToken}`;
    this.http.get(url).subscribe((data: any) => {
      this.drawRoute(data.routes[0].geometry);
    });
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
        geometry: route,
        properties: {}
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



  loadZones() {
    this.zoneEngine.zones$.subscribe(zones => {
      this.zones = zones;
      if (this.map && this.isHeatmapVisible) {
        this.updateHeatmap();
      }
    });
  }

  updateHeatmap() {
    if (!this.map || !this.map.isStyleLoaded()) {
      return;
    }

    this.removeDangerZones();

    this.zones.forEach((zone: DangerZone) => {
      const sourceId = `zone-${zone.id}`;
      const fillLayerId = `${sourceId}-fill`;
      const outlineLayerId = `${sourceId}-outline`;

      this.map!.addSource(sourceId, {
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

      this.map!.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['get', 'severity'],
            1, '#00ff00',
            4, '#ffff00',
            6, '#ffaa00',
            8, '#ff0000'
          ],
          'fill-opacity': 0.7
        }
      });

      this.map!.addLayer({
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

      this.zoneLayers.push(fillLayerId, outlineLayerId);
    });
  }

  async triggerPanicButton() {
    if (this.isPanicActive) return;

    this.isPanicActive = true;
    
    if (navigator.vibrate) {
      navigator.vibrate([300, 100, 300, 100, 300]);
    }

    const user = await this.afAuth.currentUser;
    if (!user || !this.currentLocation) {
      this.showPanicAlert('Error: Unable to get user location or authentication');
      this.isPanicActive = false;
      return;
    }

    try {
      const userDoc = await this.firestore.collection('users').doc(user.uid).get().toPromise();
      const userData = userDoc?.data() as any;

      const panicIncident = {
        id: Date.now().toString(),
        userId: user.uid,
        userName: (userData?.firstName + ' ' + userData?.lastName) || 'Unknown User',
        type: 'emergency',
        title: 'PANIC ALERT',
        description: 'User triggered panic button',
        coordinates: this.currentLocation,
        timestamp: new Date(),
        severity: 'high' as const,
        verified: false,
        status: 'pending'
      };

      await this.firestore.collection('incidents').add(panicIncident);

      const alert = await this.alertController.create({
        header: '🚨 PANIC ALERT SENT',
        message: `Emergency services and your emergency contacts have been notified of your location at ${this.currentLocation.lat.toFixed(4)}, ${this.currentLocation.lng.toFixed(4)}. Stay safe and follow emergency instructions.`,
        buttons: [
          {
            text: 'OK',
            handler: () => {
              this.isPanicActive = false;
            }
          }
        ],
        cssClass: 'panic-alert'
      });

      await alert.present();

      const toast = await this.toastController.create({
        message: '🚨 Panic alert sent! Emergency contacts notified.',
        duration: 5000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();

      this.autoRouteToSafeZone();
    } catch (error) {
      console.error('Panic button error:', error);
      this.showPanicAlert('Failed to send panic alert. Please try again.');
      this.isPanicActive = false;
    }
  }

  private async showPanicAlert(message: string) {
    const alert = await this.alertController.create({
      header: 'Panic Alert Error',
      message: message,
      buttons: ['OK']
    });
    await alert.present();
  }

  toggleHeatmap() {
    this.isHeatmapVisible = !this.isHeatmapVisible;
    if (this.isHeatmapVisible) {
      this.updateHeatmap();
    } else {
      this.removeDangerZones();
    }
  }

  changeLanguage(lang: string) {
    this.currentLanguage = lang;
    this.translate.use(lang);
  }
}
