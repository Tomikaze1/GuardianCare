import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { ZoneManagementPageRoutingModule } from './zone-management-routing.module';

import { ZoneManagementPage } from './zone-management.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ZoneManagementPageRoutingModule
  ],
  declarations: [ZoneManagementPage]
})
export class ZoneManagementPageModule {}
