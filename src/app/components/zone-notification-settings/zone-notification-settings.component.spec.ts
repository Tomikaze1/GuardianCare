import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule, AlertController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ZoneNotificationSettingsComponent } from './zone-notification-settings.component';
import { AdminNotificationService } from '../../services/admin-notification.service';

describe('ZoneNotificationSettingsComponent', () => {
  let component: ZoneNotificationSettingsComponent;
  let fixture: ComponentFixture<ZoneNotificationSettingsComponent>;
  let adminNotificationService: jasmine.SpyObj<AdminNotificationService>;
  let alertController: jasmine.SpyObj<AlertController>;

  beforeEach(async () => {
    const adminNotificationServiceSpy = jasmine.createSpyObj('AdminNotificationService', [
      'getNotificationSettings',
      'updateNotificationSettings',
      'resetNotificationSettings'
    ]);
    
    const alertControllerSpy = jasmine.createSpyObj('AlertController', ['create']);

    await TestBed.configureTestingModule({
      declarations: [ZoneNotificationSettingsComponent],
      imports: [IonicModule.forRoot(), FormsModule],
      providers: [
        { provide: AdminNotificationService, useValue: adminNotificationServiceSpy },
        { provide: AlertController, useValue: alertControllerSpy }
      ]
    }).compileComponents();

    adminNotificationService = TestBed.inject(AdminNotificationService) as jasmine.SpyObj<AdminNotificationService>;
    alertController = TestBed.inject(AlertController) as jasmine.SpyObj<AlertController>;
    
    // Set up default return values
    adminNotificationService.getNotificationSettings.and.returnValue({
      notificationRadiusKm: 10,
      nearbyThresholdKm: 1,
      closeThresholdKm: 0.5,
      enableLocationNotifications: true,
      enableTimeInformation: true
    });

    fixture = TestBed.createComponent(ZoneNotificationSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load settings on init', () => {
    expect(adminNotificationService.getNotificationSettings).toHaveBeenCalled();
    expect(component.settings.notificationRadiusKm).toBe(10);
  });

  it('should save settings when radius changes', () => {
    const event = { detail: { value: 15 } };
    component.onRadiusChange(event);
    
    expect(component.settings.notificationRadiusKm).toBe(15);
    expect(adminNotificationService.updateNotificationSettings).toHaveBeenCalledWith(component.settings);
  });

  it('should save settings when location notifications toggle', () => {
    const event = { detail: { checked: false } };
    component.onLocationNotificationsToggle(event);
    
    expect(component.settings.enableLocationNotifications).toBe(false);
    expect(adminNotificationService.updateNotificationSettings).toHaveBeenCalledWith(component.settings);
  });

  it('should format distance correctly', () => {
    expect(component.getDistanceText(0.5)).toBe('500m');
    expect(component.getDistanceText(1.5)).toBe('1.5km');
  });

  it('should provide notification estimate based on radius', () => {
    component.settings.notificationRadiusKm = 1;
    expect(component.getNotificationEstimate()).toContain('Very few');
    
    component.settings.notificationRadiusKm = 10;
    expect(component.getNotificationEstimate()).toContain('Regular');
    
    component.settings.notificationRadiusKm = 30;
    expect(component.getNotificationEstimate()).toContain('Many');
  });

  it('should show alert when resetting to defaults', async () => {
    const alertSpy = jasmine.createSpyObj('Alert', ['present']);
    alertController.create.and.returnValue(Promise.resolve(alertSpy));
    
    await component.resetToDefaults();
    
    expect(alertController.create).toHaveBeenCalled();
    expect(alertSpy.present).toHaveBeenCalled();
  });
});


