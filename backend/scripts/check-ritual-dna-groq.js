require('dotenv').config();
const { askGroq, validatedRecommendations } = require('../src/services/ritual-dna.recommendations');

const dna = {
  archetype_id: 'zen_purist',
  taste_radar: { brightness: 75, boldness: 35, sweetness: 30, skill: 70, tempo: 40 },
  lean_confirmed: true, drink_lean: 75, servings: ['hot']
};
const products = [
  { id: 'sample-matcha', name: 'Ceremonial matcha', category: 'matcha', profile: { brightness: 72, boldness: 30 } },
  { id: 'sample-coffee', name: 'Dark roast coffee', category: 'coffee', profile: { brightness: 20, boldness: 85 } }
];
const recipes = [{ id: 'sample-recipe', name: 'Slow matcha whisk', difficulty: 'MEDIUM', minutes: 8, profile: { skill: 55, tempo: 65 } }];

askGroq(dna, [], products, recipes)
  .then(result => {
    const checked = validatedRecommendations(result, products, recipes);
    console.log(JSON.stringify({ ok: true, model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      product_ids: checked.products.map(item => item.id), recipe_ids: checked.recipes.map(item => item.id) }));
  })
  .catch(error => {
    console.error(JSON.stringify({ ok: false, message: error.message }));
    process.exitCode = 1;
  });
