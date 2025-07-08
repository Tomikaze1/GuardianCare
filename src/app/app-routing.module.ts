import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
<<<<<<< HEAD
  // Redirect root to /tabs/home so tabs bar always loads first
  { path: '', redirectTo: 'tabs/home', pathMatch: 'full' },

  // Auth (login/register)
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

  // Tabs parent (handles all tabbed routes)
  {
    path: 'tabs',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule)
  },

  // (optional) Wildcard/fallback route - redirects any unknown paths to tabs/home
  { path: '**', redirectTo: 'tabs/home', pathMatch: 'full' }
=======
  {
    path: 'home',
    loadChildren: () => import('./home/home.module').then( m => m.HomePageModule)
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full'
  },
  {
    path: 'home',
    loadChildren: () => import('./home/home.module').then( m => m.HomePageModule)
  },
>>>>>>> dad415551fb418a8df5d2e53060dd47cd1be0390
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
<<<<<<< HEAD
export class AppRoutingModule {}
=======
export class AppRoutingModule { }
>>>>>>> dad415551fb418a8df5d2e53060dd47cd1be0390
