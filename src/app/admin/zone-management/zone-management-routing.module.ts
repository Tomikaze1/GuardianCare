import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { ZoneManagementPage } from './zone-management.page';

const routes: Routes = [
  {
    path: '',
    component: ZoneManagementPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ZoneManagementPageRoutingModule {}
