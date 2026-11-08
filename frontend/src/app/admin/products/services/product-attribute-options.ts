// Values follow the stored catalog vocabulary; labels are presentation only.
export interface ProductAttributeOption { value: string; label: string; }
const options = (values: string[]): ProductAttributeOption[] => values.map(value => ({
  value, label: (value.replace(/_/g, ' ')).replace(/^./, letter => letter.toUpperCase())
}));
export const PRODUCT_ATTRIBUTE_OPTIONS = {
  grade: options(['ceremonial grade', 'premium grade', 'barista grade', 'latte grade', 'related tea']),
  pricingTier: options(['ritual_series']),
  process: options(['washed', 'decaf', 'wet-hulled', 'natural sundried']),
  wareType: options(['mugs', 'bottles', 'teapots']),
  material: options(['ceramic', 'clay', 'glass', 'porcelain', 'steel']),
  setType: options(['coffee kit', 'coffee bundle', 'matcha kit', 'matcha bundle', 'drinkware set']),
  toolCategory: options(['coffee tools', 'tea tools']),
  toolType: options(['brewer', 'chawan', 'chashaku', 'chasen', 'dripper', 'filter', 'grinder', 'whisk stand', 'kettle'])
};
export type ProductAttributeKey = keyof typeof PRODUCT_ATTRIBUTE_OPTIONS;
