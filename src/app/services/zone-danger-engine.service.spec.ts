import { TestBed } from '@angular/core/testing';

import { ZoneDangerEngineService } from './zone-danger-engine.service';

describe('ZoneDangerEngineService', () => {
  let service: ZoneDangerEngineService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ZoneDangerEngineService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
