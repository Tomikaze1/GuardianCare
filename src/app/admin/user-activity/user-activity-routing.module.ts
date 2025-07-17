import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { UserActivityPage } from './user-activity.page';

const routes: Routes = [
  {
    path: '',
    component: UserActivityPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UserActivityPageRoutingModule {}
