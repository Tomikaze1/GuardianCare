import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ZoneManagementPage } from './zone-management.page';

describe('ZoneManagementPage', () => {
  let component: ZoneManagementPage;
  let fixture: ComponentFixture<ZoneManagementPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ZoneManagementPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
