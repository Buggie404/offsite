const assert = require('assert');
const { matchConfiguredKit } = require('../src/services/starter-quiz.configured-match');

function product(fields) {
  const price = fields.price;
  delete fields.price;
  return {
    is_active: true,
    quiz_eligible: true,
    images: [],
    variants: [{ sku: `SKU-${fields.product_id}`, price, stock: 6, is_default: true, images: [] }],
    total_sold_quantity: fields.sold || 0,
    ...fields
  };
}

const products = [
  product({ product_id: 1, name: 'Ceremonial', category: 'matcha', price: 20, sold: 4, matcha: { product_grade: 'ceremonial' } }),
  product({ product_id: 2, name: 'Chasen', category: 'tools', price: 12, tools: { tool_type: 'chasen' } }),
  product({ product_id: 3, name: 'Bowl', category: 'drinkware', price: 15, drinkware: { ware_type: 'bowl' } }),
  product({ product_id: 4, name: 'Coffee', category: 'coffee', price: 18, coffee: { roast_level: 'light roast' } })
];

const questions = [
  {
    question_id: 'SQ1',
    code: 'q2',
    matching_role: 'primary',
    options: [{ option_id: 'A', code: 'M', text: 'Matcha' }]
  },
  {
    question_id: 'SQ2',
    code: 'q3',
    matching_role: 'secondary',
    options: [{ option_id: 'B', code: 'light', text: 'Light' }]
  }
];

const kits = [
  {
    kit_id: 'SK-MATCHA',
    name: 'The Matcha Kit',
    description: 'A quiet morning bowl.',
    drink: 'matcha',
    level: 'beginner',
    budget: 'any',
    discount_percent: 20,
    status: 'active',
    slots: [
      { slot_id: 'S1', name: 'Powder', category: 'matcha', attribute: 'Any grade', constraint: 'Any price', hero: true },
      { slot_id: 'S2', name: 'Whisk', category: 'tools', attribute: 'Type: Chasen', constraint: 'Any price', hero: false }
    ]
  },
  {
    kit_id: 'SK-COFFEE',
    name: 'The Coffee Kit',
    drink: 'coffee',
    level: 'beginner',
    budget: 'any',
    discount_percent: 0,
    status: 'active',
    slots: [
      { slot_id: 'S1', name: 'Beans', category: 'coffee', attribute: 'Any roast', constraint: 'Any price', hero: true },
      { slot_id: 'S2', name: 'Cup', category: 'drinkware', attribute: 'Any type', constraint: 'Any price', hero: false }
    ]
  }
];

const answers = [
  { question_id: 'SQ1', option_id: 'A' },
  { question_id: 'SQ2', option_id: 'B' }
];

const matched = matchConfiguredKit({ questions, answers, kits, products });
assert.strictEqual(matched.error, undefined);
assert.strictEqual(matched.kit.title, 'The Matcha Kit');
assert.deepStrictEqual(matched.kit.items.map((item) => item.productId), [1, 2]);

const deletedQuestion = matchConfiguredKit({
  questions: questions.filter((question) => question.question_id !== 'SQ2'),
  answers: answers.filter((answer) => answer.question_id !== 'SQ2'),
  kits,
  products
});
assert.strictEqual(deletedQuestion.error, undefined);
assert.strictEqual(deletedQuestion.kit.archetypeId, 'SK-MATCHA');

const none = matchConfiguredKit({
  questions,
  answers: [{ question_id: 'SQ1', option_id: 'MISSING' }],
  kits: [],
  products
});
assert.strictEqual(none.error, 'NO_ACTIVE_KITS');

console.log('configured matcher ok');
