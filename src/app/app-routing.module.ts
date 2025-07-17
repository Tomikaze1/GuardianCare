import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './auth/auth.guard';
import { AdminGuard } from './auth/admin.guard'; 

const routes: Routes = [
  { path: '', redirectTo: 'auth/login', pathMatch: 'full' },
  {
    path: 'auth',
    children: [
      {
        path: 'login',
        loadChildren: () => import('./auth/login/login.module').then(m => m.LoginPageModule)
      },
      {
        path: 'register',
        loadChildren: () => import('./auth/register/register.module').then(m => m.RegisterPageModule)
      }
    ]
  },
  {
    path: 'tabs',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule),
    canActivate: [AuthGuard] 
  },
  {
    path: 'reports',
    loadChildren: () => import('./reports/reports.module').then(m => m.ReportsPageModule),
    canActivate: [AuthGuard]  
  },

  {
    path: 'admin',
    canActivate: [AdminGuard],
    children: [
      {
        path: 'dashboard',
        loadChildren: () => import('./admin/dashboard/dashboard.module').then(m => m.DashboardPageModule)
      },
      {
        path: 'zone-management',
        loadChildren: () => import('./admin/zone-management/zone-management.module').then(m => m.ZoneManagementPageModule)
      },
      {
        path: 'incident-validation',
        loadChildren: () => import('./admin/incident-validation/incident-validation.module').then(m => m.IncidentValidationPageModule)
      },
      {
        path: 'analytics',
        loadChildren: () => import('./admin/analytics/analytics.module').then(m => m.AnalyticsPageModule)
      },
      {
        path: 'user-activity',
        loadChildren: () => import('./admin/user-activity/user-activity.module').then(m => m.UserActivityPageModule)
      }
    ]
  },

  { path: '**', redirectTo: 'auth/login', pathMatch: 'full' }
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
