// Versioned Ritual DNA configuration. Starter Quiz records are never touched.
const VERSION = '1';
const AXES = ['brightness', 'boldness', 'sweetness', 'skill', 'tempo'];

function option(id, text, hint, weights = {}, profile = {}) {
  return { option_id: id, code: id, text, hint, icon: '', score_weights: weights, ...profile };
}

function question(code, title, limit, options) {
  return {
    question_id: `DNA_${code}`, quiz_type: 'ritual_dna', code,
    question: title, order: Number(code.slice(1)), selection_limit: limit,
    quiz_version: VERSION, is_active: true, options
  };
}

const QUESTIONS = [
  question('D1', 'If you could choose one for the whole week, what would it be?', 1, [
    option('matcha_daily', 'Matcha almost every day', 'Coffee rarely enters the picture.', {}, { drink_lean: 90 }),
    option('matcha_lean', 'Mostly matcha', 'Coffee sometimes, but matcha leads.', {}, { drink_lean: 70 }),
    option('balanced_lean', 'Both equally', 'It depends on the day and the mood.', {}, { drink_lean: 50 }),
    option('coffee_lean', 'Mostly coffee', 'Matcha sometimes, but coffee leads.', {}, { drink_lean: 30 }),
    option('coffee_daily', 'Coffee almost every day', 'Matcha rarely enters the picture.', {}, { drink_lean: 10 }),
    option('undecided', 'I am still exploring', 'I do not have a clear routine yet.', {}, { drink_lean: 50, lean_confirmed: false })
  ]),
  question('D2', 'How much time do you have for your first cup?', 1, [
    option('under_3', 'Under 3 minutes', 'Made fast, often enjoyed on the move.', { skill: 0, tempo: 5 }),
    option('five_to_ten', 'Around 5–10 minutes', 'A short, focused pause at the table.', { skill: 2, tempo: 3 }),
    option('fifteen_plus', '15 minutes or more', 'Making it slowly is part of the break.', { skill: 4, tempo: 1 })
  ]),
  question('D3', 'Which best describes your relationship with brewing tools?', 1, [
    option('none', 'Keep it simple', 'A cup and hot water are enough.', { skill: 0 }, { equipment_level: 'none' }),
    option('basic', 'I use a few basics', 'A shaker, French press, or matcha whisk.', { skill: 2 }, { equipment_level: 'basic' }),
    option('learning', 'I want to learn', 'Tools interest me, even if I am still new.', { skill: 3 }, { equipment_level: 'basic' }),
    option('full', 'I have my own setup', 'Chawan, dripper, kettle, grinder, or more.', { skill: 5 }, { equipment_level: 'full' })
  ]),
  question('D4', 'Which flavours draw you in? Choose up to two.', 2, [
    option('fresh', 'Fresh & green', 'Leafy, floral, citrus, or fruit.', { brightness: 5, boldness: 0, sweetness: 1 }),
    option('warm_sweet', 'Warm & sweet', 'Caramel, milk chocolate, or vanilla.', { brightness: 1, boldness: 1, sweetness: 5 }),
    option('deep_roasted', 'Deep & roasted', 'Dark cacao, smoke, or toasted nuts.', { brightness: 0, boldness: 5, sweetness: 1 }),
    option('creamy', 'Smooth & creamy', 'Soft, milky, and comforting.', { brightness: 0, boldness: 1, sweetness: 5 }),
    option('gentle_nutty', 'Gentle & nutty', 'Subtle, rounded, and lightly roasted.', { brightness: 1, boldness: 2, sweetness: 2 })
  ]),
  question('D5', 'How strong should the flavour feel?', 1, [
    option('light', 'Light & clean', 'Easy to drink without becoming tiring.', { brightness: 3, boldness: 0 }),
    option('balanced', 'Balanced', 'Clear flavour with a rounded finish.', { brightness: 2, boldness: 2 }),
    option('bold', 'Bold & distinct', 'I want the flavour to stand out.', { brightness: 0, boldness: 4 }),
    option('very_bold', 'Strong through milk or ice', 'Powerful enough to hold its character.', { brightness: 0, boldness: 5 })
  ]),
  question('D6', 'How do you most often enjoy your drink?', 1, [
    option('hot', 'Hot & original', 'Warm, simple, and close to the ingredient.', { brightness: 2, skill: 1 }, { serving: 'hot' }),
    option('iced', 'Over ice', 'Cold, crisp, and refreshing.', { brightness: 1, sweetness: 2 }, { serving: 'iced' }),
    option('milk', 'With milk', 'A soft and creamy latte-style cup.', { sweetness: 5 }, { serving: 'milk' }),
    option('mixed', 'With a twist', 'Tonic, fruit, syrup, or another ingredient.', { brightness: 2, sweetness: 3, skill: 4 }, { serving: 'mixed' })
  ]),
  question('D7', 'When does a good cup matter most? Choose up to two.', 2, [
    option('morning', 'In the morning', 'To wake up and begin the day.', { tempo: 5 }, { occasion: 'morning' }),
    option('work', 'During focused work', 'A reliable lift between tasks.', { boldness: 1, tempo: 4 }, { occasion: 'work' }),
    option('afternoon', 'For an afternoon break', 'A pause when the day softens.', { tempo: 2 }, { occasion: 'afternoon' }),
    option('evening', 'To wind down at night', 'Something gentle after the day is done.', { sweetness: 1, tempo: 0 }, { occasion: 'evening' }),
    option('social', 'With friends or guests', 'A drink made to share and linger over.', { skill: 2, tempo: 1 }, { occasion: 'social' })
  ])
];

const ARCHETYPES = [
  { archetype_id: 'ARC0001', name: 'Zen Purist', tagline: 'Calm, precise, and quietly intentional.', description: 'You value clarity and craft. A considered cup, careful tools, and an unhurried moment make the ritual yours.', taste_profile: { brightness: 69, boldness: 18, sweetness: 22, skill: 60, tempo: 28 } },
  { archetype_id: 'ARC0002', name: 'Modern Alchemist', tagline: 'Curious, expressive, and always experimenting.', description: 'You see each cup as a starting point. New ingredients, techniques, and unexpected combinations keep the ritual alive.', taste_profile: { brightness: 62, boldness: 39, sweetness: 54, skill: 75, tempo: 51 } },
  { archetype_id: 'ARC0003', name: 'Daily Fuel', tagline: 'Bold, direct, and ready to move.', description: 'Your ritual supports the day ahead: dependable flavour, satisfying strength, and a rhythm that never slows you down.', taste_profile: { brightness: 25, boldness: 80, sweetness: 25, skill: 32, tempo: 88 } },
  { archetype_id: 'ARC0004', name: 'Cozy Ritualist', tagline: 'Soft, comforting, and made to linger over.', description: 'You look for warmth in your cup: creamy textures, gentle sweetness, and an easy moment that feels like your own.', taste_profile: { brightness: 27, boldness: 20, sweetness: 82, skill: 28, tempo: 35 } }
];

module.exports = { VERSION, AXES, QUESTIONS, ARCHETYPES };
