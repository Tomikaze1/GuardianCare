import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
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
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
