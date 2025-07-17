import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { IncidentValidationPageRoutingModule } from './incident-validation-routing.module';

import { IncidentValidationPage } from './incident-validation.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    IncidentValidationPageRoutingModule
  ],
  declarations: [IncidentValidationPage]
})
export class IncidentValidationPageModule {}
