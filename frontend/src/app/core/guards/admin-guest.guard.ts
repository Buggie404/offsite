import { CanActivateFn } from '@angular/router';

export const adminGuestGuard: CanActivateFn = () => {
  return true;
};
