import { Component, OnInit } from '@angular/core';
import { AdminService } from '../../services/admin.service';
import { Chart, registerables } from 'chart.js';
import { Router } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: false,
})
export class DashboardPage implements OnInit {
  stats: any = {};
  recentActivity: any[] = [];
  pendingIncidentsCount = 0;
  loading = true;

  constructor(private adminService: AdminService, private router: Router) {
    Chart.register(...registerables);
  }

  async ngOnInit() {
    await this.loadDashboardData();
    this.loading = false;
  }

  async loadDashboardData() {
    this.adminService.getIncidentAnalytics().subscribe(data => {
      this.stats = data;
      this.createCharts();
    });

    this.adminService.getUserActivity(5).subscribe(activity => {
      this.recentActivity = activity;
    });

    this.adminService.getPendingIncidents().subscribe(incidents => {
      this.pendingIncidentsCount = incidents.length;
    });
  }

  createCharts() {
    // Incident Trends Chart
    new Chart('incidentTrends', {
      type: 'line',
      data: {
        labels: this.stats.last30Days?.labels || [],
        datasets: [{
          label: 'Incidents Reported',
          data: this.stats.last30Days?.counts || [],
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

    // Danger Level Chart
    new Chart('dangerLevels', {
      type: 'doughnut',
      data: {
        labels: ['Danger', 'Caution', 'Neutral', 'Safe'],
        datasets: [{
          data: [
            this.stats.zoneStats?.danger || 0,
            this.stats.zoneStats?.caution || 0,
            this.stats.zoneStats?.neutral || 0,
            this.stats.zoneStats?.safe || 0
          ],
          backgroundColor: [
            '#f44336',
            '#ff9800',
            '#ffeb3b',
            '#4caf50'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
  }

  refreshData(event: any) {
    this.loadDashboardData().then(() => {
      event.target.complete();
    });
  }

  goBack() {
    this.router.navigate(['/tabs/settings']);
  }
}