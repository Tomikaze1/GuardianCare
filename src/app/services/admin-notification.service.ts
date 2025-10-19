import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { getFirestore, collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { ReportService, Report } from './report.service';
import { NotificationManagerService } from './notification-manager.service';
import { AuthService } from './auth.service';

interface AdminValidationEvent {
  reportId: string;
  reportType: string;
  locationAddress: string;
  riskLevel: number;
  validatedAt: Date;
  isForCurrentUser: boolean;
  userId: string;
}

@Injectable({
  providedIn: 'root'
})
export class AdminNotificationService {
  private validationEventsSubject = new BehaviorSubject<AdminValidationEvent[]>([]);
  public validationEvents$ = this.validationEventsSubject.asObservable();

  private subscriptions: Subscription[] = [];
  private lastProcessedValidationTime: Date | null = null;
  private processedReportIds = new Set<string>();

  constructor(
    private reportService: ReportService,
    private notificationManager: NotificationManagerService,
    private authService: AuthService
  ) {
    this.initializeAdminValidationListener();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private initializeAdminValidationListener() {
    console.log('🔔 Initializing AdminNotificationService listener...');
    const db = getFirestore();
    
    const allIncidentsQuery = query(
      collection(db, 'incidents')
    );

    this.subscriptions.push(
      new Observable<Report[]>(observer => {
        const unsubscribe = onSnapshot(allIncidentsQuery, snapshot => {
          console.log('📡 Admin validation listener: snapshot received', snapshot.size, 'docs');
          
          const reports = snapshot.docs.map(doc => {
            const data = doc.data();
            
            const locationData = data['location'];
            const locationObj = typeof locationData === 'object' ? locationData : {
              lat: data['lat'] || 0,
              lng: data['lng'] || 0
            };
            
            const report: Report = {
              id: doc.id,
              type: data['type'] || 'Incident Report',
              description: data['description'] || '',
              location: locationObj,
              locationAddress: data['locationAddress'] || 'Unknown Location',
              status: data['status'] || 'Pending',
              level: data['level'] || undefined,
              riskLevel: data['riskLevel'] || 1,
              validatedAt: data['validatedAt']?.toDate ? data['validatedAt'].toDate() : data['validatedAt'],
              media: data['media'] || [],
              userId: data['userId'] || '',
              anonymous: data['anonymous'] || false,
              isSilent: data['isSilent'] || false,
              createdAt: data['createdAt']?.toDate() || undefined,
              updatedAt: data['updatedAt']?.toDate() || undefined,
              reporterName: data['reporterName'] || undefined,
              reporterEmail: data['reporterEmail'] || undefined,
              emergencyContact: data['emergencyContact'] || undefined
            };
            
            return report;
          });
          
          observer.next(reports);
        }, error => {
          console.error('❌ Error listening to admin validated reports:', error);
          observer.error(error);
        });
        return unsubscribe;
      }).subscribe(async (reports) => {
        const currentUser = await this.authService.getCurrentUser();
        if (!currentUser) {
          console.log('👤 No current user, skipping admin validation processing');
          return;
        }

        const newEvents: AdminValidationEvent[] = [];
        
        const newlyValidatedReports = reports.filter(report => {
          return report.status === 'Validated' && 
                 report.validatedAt && 
                 !this.processedReportIds.has(report.id!);
        });
        
        console.log('✅ Found newly validated reports:', newlyValidatedReports.length);
        
        newlyValidatedReports.forEach(report => {
          this.processedReportIds.add(report.id!);
          
          const isForCurrentUser = report.userId === currentUser.uid;
          
          const event: AdminValidationEvent = {
            reportId: report.id!,
            reportType: report.type || 'Incident Report',
            locationAddress: report.locationAddress || 'Unknown Location',
            riskLevel: report.level || report.riskLevel || 1,
            validatedAt: report.validatedAt!,
            isForCurrentUser: isForCurrentUser,
            userId: report.userId!
          };
          newEvents.push(event);

          const timeStr = this.formatTimeAgo(report.validatedAt!);
          const riskText = this.getRiskLevelText(report.level || report.riskLevel || 1);
          
          console.log('🔔 Admin validation detected for report:', report.id, '- notifications loaded from Firestore');
        });

        if (newEvents.length > 0) {
          this.validationEventsSubject.next([...this.validationEventsSubject.value, ...newEvents]);
          console.log('📊 Admin validation events updated:', newEvents.length, 'new events');
        }
        
        if (this.processedReportIds.size > 100) {
          const idsArray = Array.from(this.processedReportIds);
          this.processedReportIds.clear();
          idsArray.slice(-50).forEach(id => this.processedReportIds.add(id));
        }
      })
    );
  }

  private formatTimeAgo(date: Date): string {
    return date.toLocaleString('en-US', {
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }

  private getRiskLevelText(riskLevel: number): string {
    switch (riskLevel) {
      case 1: return 'Low';
      case 2: return 'Moderate';
      case 3: return 'High';
      case 4: return 'Critical';
      case 5: return 'Extreme';
      default: return 'Unknown';
    }
  }

  public checkForNewValidations() {
    console.log('🔍 Manual validation check triggered');
  }


  getRecentValidations(limit: number = 10): Observable<AdminValidationEvent[]> {
    return this.validationEvents$.pipe(
      map(events => events.slice(0, limit))
    );
  }

  getUserValidations(userId: string): Observable<AdminValidationEvent[]> {
    return this.validationEvents$.pipe(
      map(events => events.filter(event => event.userId === userId))
    );
  }


  clearOldEvents() {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const currentEvents = this.validationEventsSubject.value;
    const recentEvents = currentEvents.filter(event => event.validatedAt > oneDayAgo);
    
    this.validationEventsSubject.next(recentEvents);
  }


  clearProcessedReports() {
    this.processedReportIds.clear();
    this.lastProcessedValidationTime = null;
    console.log('🧹 Cleared processed report IDs from AdminNotificationService');
  }
}