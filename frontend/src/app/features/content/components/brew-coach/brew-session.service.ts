import { Injectable, inject } from '@angular/core';
import { HttpService } from '../../../../core/http.service';
import { PantryCoverage } from '../../../account/components/my-pantry/pantry.model';

export interface BrewSessionPayload {
  recipe_id: string;
  feedback: {
    flavor_intensity: number;
    note: string;
    rating: number;
  };
  brewed_at: string;
  started_at: string;
  duration_seconds: number;
  ingredient_adjustments: {
    ingredient_name: string;
    delta_quantity: number;
    unit: string;
    deduct_quantity?: number | null;
    deduct_unit?: string;
  }[];
  pantry_selections: {
    ingredient_name: string;
    pantry_item_id: string;
  }[];
  ingredients_used: {
    name: string;
    quantity: number;
    unit: string;
    product_id: string | null;
  }[];
  result_image: { url: string; public_id: string } | null;
  shared_post_id: string | null;
}

@Injectable({ providedIn: 'root' })
export class BrewSessionService {
  private http = inject(HttpService);

  create(payload: BrewSessionPayload): Promise<{ brewSession: { brewsession_id: string }; coverage: PantryCoverage | null }> {
    return this.http.post('/brew-sessions', payload);
  }
}
