import { Component, OnInit } from '@angular/core';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: false
})
export class DashboardPage implements OnInit {
  incidentTrendsChart: Chart | null = null;
  dangerLevelChart: Chart | null = null;

  constructor() {}

  ngOnInit() {
    this.createIncidentTrendsChart();
    this.createDangerLevelChart();
  }

  private createIncidentTrendsChart() {
    const ctx = document.getElementById('incidentTrendsChart') as HTMLCanvasElement;
    if (ctx) {
      this.incidentTrendsChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [{
            label: 'Incidents',
            data: [12, 19, 3, 5, 2, 3],
            borderColor: 'rgb(75, 192, 192)',
            tension: 0.1
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: 'top',
            },
            title: {
              display: true,
              text: 'Incident Trends'
            }
          }
        }
      });
    }
  }

  private createDangerLevelChart() {
    const ctx = document.getElementById('dangerLevelChart') as HTMLCanvasElement;
    if (ctx) {
      this.dangerLevelChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Safe', 'Neutral', 'Caution', 'Danger'],
          datasets: [{
            data: [12, 19, 3, 5],
            backgroundColor: [
              'rgb(75, 192, 192)',
              'rgb(255, 205, 86)',
              'rgb(255, 159, 64)',
              'rgb(255, 99, 132)'
            ]
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: 'top',
            },
            title: {
              display: true,
              text: 'Danger Level Distribution'
            }
          }
        }
      });
    }
  }
}