import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IncidentValidationPage } from './incident-validation.page';

describe('IncidentValidationPage', () => {
  let component: IncidentValidationPage;
  let fixture: ComponentFixture<IncidentValidationPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(IncidentValidationPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
