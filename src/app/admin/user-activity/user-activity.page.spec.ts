import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserActivityPage } from './user-activity.page';

describe('UserActivityPage', () => {
  let component: UserActivityPage;
  let fixture: ComponentFixture<UserActivityPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(UserActivityPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
