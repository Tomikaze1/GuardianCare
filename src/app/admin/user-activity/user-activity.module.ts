import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { UserActivityPageRoutingModule } from './user-activity-routing.module';

import { UserActivityPage } from './user-activity.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    UserActivityPageRoutingModule
  ],
  declarations: [UserActivityPage]
})
export class UserActivityPageModule {}
