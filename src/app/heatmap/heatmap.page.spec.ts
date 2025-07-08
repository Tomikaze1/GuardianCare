import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HeatmapPage } from './heatmap.page';

describe('HeatmapPage', () => {
  let component: HeatmapPage;
  let fixture: ComponentFixture<HeatmapPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(HeatmapPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
