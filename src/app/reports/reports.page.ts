import { Component, OnInit } from '@angular/core';
import { AlertController, ToastController, LoadingController } from '@ionic/angular';
import { getFirestore, collection, getDocs, addDoc, deleteDoc, doc, updateDoc, query, orderBy, limit } from 'firebase/firestore';
import { getApp } from 'firebase/app';

@Component({
  selector: 'app-reports',
  templateUrl: './reports.page.html',
  styleUrls: ['./reports.page.scss'],
  standalone: false
})
export class ReportsPage implements OnInit {
  segment: string = 'submit';  // Changed default to 'submit'
  
  newReport: any = {
    title: '',
    type: '',
    priority: '',
    location: '',
    details: '',
    contactNumber: '',
    mediaUrl: '',
    anonymous: false, // Ensure this is explicitly boolean
    timestamp: '',
    status: 'Pending'
  };
  
  reportHistory: any[] = [];
  filteredReports: any[] = [];
  searchTerm: string = '';
  filterStatus: string = '';
  isSubmitting: boolean = false;
  hasMoreReports: boolean = true;

  constructor(
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private loadingCtrl: LoadingController
  ) {}

  private get app() {
    return getApp();
  }

  private get db() {
    return getFirestore(this.app);
  }

  ngOnInit() {
    this.loadReportHistory();
  }

  async loadReportHistory() {
    const loading = await this.loadingCtrl.create({
      message: 'Loading reports...'
    });
    await loading.present();

    try {
      const q = query(
        collection(this.db, 'reports'),
        orderBy('timestamp', 'desc'),
        limit(20)
      );
      const querySnapshot = await getDocs(q);
      this.reportHistory = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        // Ensure boolean values are properly converted
        this.reportHistory.push({ 
          id: doc.id, 
          ...data,
          anonymous: this.toBooleanSafe(data['anonymous']) // Convert to boolean safely
        });
      });
      this.filteredReports = [...this.reportHistory];
    } catch (error) {
      console.error('Error fetching report history: ', error);
      this.showToast('Error loading reports', 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async submitReport() {
    if (!this.newReport.title || !this.newReport.type || !this.newReport.details) {
      this.showToast('Please fill in all required fields', 'warning');
      return;
    }

    this.isSubmitting = true;
    this.newReport.timestamp = new Date().toISOString();
    
    // Ensure anonymous is boolean before submitting
    this.newReport.anonymous = this.toBooleanSafe(this.newReport.anonymous);

    try {
      await addDoc(collection(this.db, 'reports'), this.newReport);
      this.showToast('Report submitted successfully!', 'success');
      this.loadReportHistory();
      this.resetForm();
      this.segment = 'history'; // Switch to history tab after submission
    } catch (error) {
      console.error('Error submitting report: ', error);
      this.showToast('Error submitting report. Please try again.', 'danger');
    } finally {
      this.isSubmitting = false;
    }
  }

  resetForm() {
    this.newReport = {
      title: '',
      type: '',
      priority: '',
      location: '',
      details: '',
      contactNumber: '',
      mediaUrl: '',
      anonymous: false, // Explicitly set as boolean
      timestamp: '',
      status: 'Pending'
    };
  }

  async viewReportDetails(report: any) {
    const alert = await this.alertCtrl.create({
      header: report.title,
      message: `
        <div class="report-details">
          <p><strong>Type:</strong> ${report.type}</p>
          <p><strong>Priority:</strong> ${report.priority || 'Not specified'}</p>
          <p><strong>Location:</strong> ${report.location || 'Not specified'}</p>
          <p><strong>Contact:</strong> ${report.contactNumber || 'Not provided'}</p>
          <p><strong>Details:</strong> ${report.details}</p>
          <p><strong>Status:</strong> ${report.status}</p>
          <p><strong>Submitted:</strong> ${new Date(report.timestamp).toLocaleString()}</p>
          <p><strong>Anonymous:</strong> ${this.toBooleanSafe(report.anonymous) ? 'Yes' : 'No'}</p>
        </div>
      `,
      buttons: [
        {
          text: 'Close',
          role: 'cancel'
        },
        {
          text: 'Share',
          handler: () => {
            this.shareReport(report);
          }
        }
      ]
    });
    await alert.present();
  }

  async deleteReport(report: any) {
    const alert = await this.alertCtrl.create({
      header: 'Confirm Delete',
      message: 'Are you sure you want to delete this report?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          handler: async () => {
            try {
              await deleteDoc(doc(this.db, 'reports', report.id));
              this.showToast('Report deleted successfully', 'success');
              this.loadReportHistory();
            } catch (error) {
              console.error('Error deleting report: ', error);
              this.showToast('Error deleting report', 'danger');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async editReport(report: any) {
    // Populate form with existing data and ensure boolean conversion
    this.newReport = { 
      ...report,
      anonymous: this.toBooleanSafe(report.anonymous) // Convert to boolean safely
    };
    this.segment = 'submit';
    this.showToast('Report loaded for editing', 'primary');
  }

  filterReports(event?: any) {
    let filtered = [...this.reportHistory];

    // Filter by search term
    if (this.searchTerm) {
      filtered = filtered.filter(report =>
        report.title.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        report.details.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        report.type.toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }

    // Filter by status
    if (this.filterStatus) {
      filtered = filtered.filter(report => report.status === this.filterStatus);
    }

    this.filteredReports = filtered;
  }

  async shareReport(report: any) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: report.title,
          text: `Report: ${report.title}\nType: ${report.type}\nStatus: ${report.status}`,
          url: window.location.href
        });
      } catch (error) {
        console.log('Error sharing:', error);
      }
    } else {
      // Fallback for browsers that don't support Web Share API
      this.showToast('Sharing not supported on this device', 'warning');
    }
  }

  async getCurrentLocation() {
    if (navigator.geolocation) {
      const loading = await this.loadingCtrl.create({
        message: 'Getting your location...'
      });
      await loading.present();

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          this.newReport.location = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
          await loading.dismiss();
          this.showToast('Location added successfully', 'success');
        },
        async (error) => {
          await loading.dismiss();
          this.showToast('Unable to get location', 'danger');
        }
      );
    } else {
      this.showToast('Geolocation not supported', 'warning');
    }
  }

  async takePhoto() {
    // Implement camera functionality
    this.showToast('Camera functionality to be implemented', 'primary');
    // For now, just simulate adding a photo URL
    // this.newReport.mediaUrl = 'path/to/photo.jpg';
  }

  async recordVoice() {
    // Implement voice recording functionality
    this.showToast('Voice recording functionality to be implemented', 'primary');
    // For now, just simulate adding a voice URL
    // this.newReport.mediaUrl = 'path/to/voice.mp3';
  }

  async uploadFile() {
    // Implement file upload functionality
    this.showToast('File upload functionality to be implemented', 'primary');
    // For now, just simulate adding a file URL
    // this.newReport.mediaUrl = 'path/to/file.pdf';
  }

  removeMedia() {
    this.newReport.mediaUrl = '';
    this.showToast('Media removed', 'success');
  }

  isImage(url: string): boolean {
  return typeof url === 'string' && (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png') || url.includes('.gif'));
}

isAudio(url: string): boolean {
  return typeof url === 'string' && (url.includes('.mp3') || url.includes('.wav') || url.includes('.ogg'));
}


  getReportIcon(type: string): string {
    const icons: { [key: string]: string } = {
      'Crime': 'warning-outline',
      'Disaster': 'alert-circle-outline',
      'Emergency': 'medical-outline',
      'Infrastructure': 'construct-outline',
      'Other': 'help-circle-outline'
    };
    return icons[type] || 'document-outline';
  }

  getReportColor(type: string): string {
    const colors: { [key: string]: string } = {
      'Crime': 'danger',
      'Disaster': 'warning',
      'Emergency': 'danger',
      'Infrastructure': 'primary',
      'Other': 'medium'
    };
    return colors[type] || 'medium';
  }

  getStatusColor(status: string): string {
    const colors: { [key: string]: string } = {
      'Pending': 'warning',
      'In Progress': 'primary',
      'Completed': 'success',
      'Rejected': 'danger'
    };
    return colors[status] || 'medium';
  }

  trackByReportId(index: number, report: any): string {
    return report.id;
  }

  async loadMoreReports() {
    // Implement pagination
    this.showToast('Load more functionality to be implemented', 'primary');
    // For now, just set hasMoreReports to false
    this.hasMoreReports = false;
  }

  // Helper method to safely convert values to boolean
  private toBooleanSafe(value: any): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return !!value; // Convert any other value to boolean
  }

  private async showToast(message: string, color: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }
}
