import { Component, OnInit } from '@angular/core';
import { AdminService } from '../../services/admin.service';
import { Chart, registerables } from 'chart.js';

@Component({
  selector: 'app-analytics',
  templateUrl: './analytics.page.html',
  styleUrls: ['./analytics.page.scss'],
  standalone: false,
})
export class AnalyticsPage implements OnInit {
  analyticsData: any = {};
  loading = true;
  charts: Chart[] = [];

  constructor(private adminService: AdminService) {
    Chart.register(...registerables);
  }

  ngOnInit() {
    this.loadAnalytics();
  }

  loadAnalytics() {
    this.loading = true;
    this.adminService.getIncidentAnalytics().subscribe(data => {
      this.analyticsData = data;
      this.createCharts();
      this.loading = false;
    });
  }

  createCharts() {
    this.destroyCharts();
    
    const trendsCtx = document.getElementById('incidentTrends') as HTMLCanvasElement;
    if (trendsCtx) {
      const trendsChart = new Chart(trendsCtx, {
        type: 'line',
        data: {
          labels: this.analyticsData.last30Days?.labels || [],
          datasets: [{
            label: 'Incidents Reported',
            data: this.analyticsData.last30Days?.counts || [],
            borderColor: '#ff5722',
            backgroundColor: 'rgba(255, 87, 34, 0.1)',
            fill: true,
            tension: 0.3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true }
          }
        }
      });
      this.charts.push(trendsChart);
    }

    const dangerCtx = document.getElementById('zoneDanger') as HTMLCanvasElement;
    if (dangerCtx) {
      const dangerChart = new Chart(dangerCtx, {
        type: 'bar',
        data: {
          labels: this.analyticsData.zoneStats?.map((z: any) => z.name) || [],
          datasets: [{
            label: 'Danger Level',
            data: this.analyticsData.zoneStats?.map((z: any) => z.currentSeverity) || [],
            backgroundColor: this.analyticsData.zoneStats?.map((z: any) => 
              z.level === 'Danger' ? '#f44336' :
              z.level === 'Caution' ? '#ff9800' :
              z.level === 'Neutral' ? '#ffeb3b' : '#4caf50'
            )
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, max: 10 }
          }
        }
      });
      this.charts.push(dangerChart);
    }

    const typeCtx = document.getElementById('incidentTypes') as HTMLCanvasElement;
    if (typeCtx) {
      const typeChart = new Chart(typeCtx, {
        type: 'pie',
        data: {
          labels: this.analyticsData.incidentTypes?.map((t: any) => t.type) || [],
          datasets: [{
            data: this.analyticsData.incidentTypes?.map((t: any) => t.count) || [],
            backgroundColor: [
              '#f44336', '#ff9800', '#ffeb3b', '#4caf50', 
              '#2196f3', '#9c27b0', '#607d8b', '#795548'
            ]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false
        }
      });
      this.charts.push(typeChart);
    }
  }

  destroyCharts() {
    this.charts.forEach(chart => chart.destroy());
    this.charts = [];
  }

  ngOnDestroy() {
    this.destroyCharts();
  }
}