import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { IncidentValidationPage } from './incident-validation.page';

const routes: Routes = [
  {
    path: '',
    component: IncidentValidationPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class IncidentValidationPageRoutingModule {}
