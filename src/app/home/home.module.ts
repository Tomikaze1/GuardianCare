import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
<<<<<<< HEAD
import { IonicModule } from '@ionic/angular';

import { HomePageRoutingModule } from './home-routing.module';
=======

import { IonicModule } from '@ionic/angular';

import { HomePageRoutingModule } from './home-routing.module';

>>>>>>> dad415551fb418a8df5d2e53060dd47cd1be0390
import { HomePage } from './home.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    HomePageRoutingModule
  ],
  declarations: [HomePage]
})
export class HomePageModule {}
