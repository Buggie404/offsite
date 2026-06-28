import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthRoutingModule } from './auth-routing.module';

import { LoginComponent } from './pages/login.component';
import { OAuthSuccessComponent } from './pages/oauth-success.component';
import { LoginFormComponent } from './components/login-form/login-form.component';

@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    AuthRoutingModule,

    // standalone components
    LoginComponent,
    OAuthSuccessComponent,
    LoginFormComponent
  ]
})
export class AuthModule {}