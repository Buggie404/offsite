// Suggested starter-kit questions. Option codes are the stable contract
// the matcher reads. Copy can change; codes cannot.

const STARTER_QUESTIONS = [
  {
    question_id: 'SQ001',
    quiz_type: 'starter_kit',
    code: 'q1',
    question: 'What do you already have for brewing?',
    order: 1,
    is_active: true,
    visible_when: { question_id: null, option_id: null },
    options: [
      {
        option_id: 'E1',
        code: 'E1',
        text: 'Nothing yet',
        hint: 'I need a full starter kit',
        icon: 'package',
        score_weights: { kit_of_3: 1 }
      },
      {
        option_id: 'E2',
        code: 'E2',
        text: 'A cup or bottle',
        hint: 'No brewing tool yet',
        icon: 'cup',
        score_weights: { kit_of_2: 1 }
      },
      {
        option_id: 'E3',
        code: 'E3',
        text: 'Brewing tools',
        hint: 'I only need the tea or coffee',
        icon: 'tools',
        score_weights: { powder_bundle: 1 }
      }
    ]
  },
  {
    question_id: 'SQ002',
    quiz_type: 'starter_kit',
    code: 'q2',
    question: 'What do you want to start with?',
    order: 2,
    is_active: true,
    visible_when: { question_id: null, option_id: null },
    options: [
      {
        option_id: 'M',
        code: 'M',
        text: 'Matcha',
        hint: 'A green-tea ritual',
        icon: 'leaf',
        score_weights: { matcha: 1 }
      },
      {
        option_id: 'C',
        code: 'C',
        text: 'Coffee',
        hint: 'A specialty coffee ritual',
        icon: 'coffee',
        score_weights: { coffee: 1 }
      },
      {
        option_id: 'B',
        code: 'B',
        text: 'Both, or not sure',
        hint: 'We will lean one way next',
        icon: 'blend',
        score_weights: { mixed: 1 }
      }
    ]
  },
  {
    question_id: 'SQ003',
    quiz_type: 'starter_kit',
    code: 'q2b',
    question: 'If you had to lean one way?',
    order: 3,
    is_active: true,
    visible_when: { question_id: 'SQ002', option_id: 'B' },
    options: [
      {
        option_id: 'LM',
        code: 'LM',
        text: 'Lean matcha',
        hint: 'More matcha in the mix',
        icon: 'leaf',
        score_weights: { matcha: 1 }
      },
      {
        option_id: 'LC',
        code: 'LC',
        text: 'Lean coffee',
        hint: 'More coffee in the mix',
        icon: 'coffee',
        score_weights: { coffee: 1 }
      }
    ]
  },
  {
    question_id: 'SQ004',
    quiz_type: 'starter_kit',
    code: 'q3',
    question: 'Which taste do you prefer?',
    order: 4,
    is_active: true,
    visible_when: { question_id: null, option_id: null },
    options: [
      {
        option_id: 'light',
        code: 'light',
        text: 'Bright and light',
        hint: 'Fresh, clean, easy',
        icon: 'sun',
        score_weights: { light: 1 }
      },
      {
        option_id: 'balanced',
        code: 'balanced',
        text: 'Balanced',
        hint: 'Right in the middle',
        icon: 'scale',
        score_weights: { balanced: 1 }
      },
      {
        option_id: 'bold',
        code: 'bold',
        text: 'Bold and strong',
        hint: 'Bitter, deep, intense',
        icon: 'flame',
        score_weights: { bold: 1 }
      },
      {
        option_id: 'sweet',
        code: 'sweet',
        text: 'Sweet and easy',
        hint: 'Creamy, soft, dessert-like',
        icon: 'sweet',
        score_weights: { sweet: 1 }
      }
    ]
  },
  {
    question_id: 'SQ005',
    quiz_type: 'starter_kit',
    code: 'q4',
    question: 'How do you usually drink?',
    order: 5,
    is_active: true,
    visible_when: { question_id: null, option_id: null },
    options: [
      {
        option_id: 'hot',
        code: 'hot',
        text: 'Hot',
        hint: 'Warm and cozy',
        icon: 'flame',
        score_weights: { hot: 1 }
      },
      {
        option_id: 'iced',
        code: 'iced',
        text: 'Iced',
        hint: 'Cold and refreshing',
        icon: 'ice',
        score_weights: { iced: 1 }
      },
      {
        option_id: 'milk',
        code: 'milk',
        text: 'With milk',
        hint: 'Lattes and creamy cups',
        icon: 'milk',
        score_weights: { milk: 1 }
      },
      {
        option_id: 'any',
        code: 'any',
        text: 'Whenever',
        hint: 'It depends on the day',
        icon: 'clock',
        score_weights: { flexible: 1 }
      }
    ]
  },
  {
    question_id: 'SQ006',
    quiz_type: 'starter_kit',
    code: 'q5',
    question: 'What is your maximum budget? This is the checkout total after 20% off.',
    order: 6,
    is_active: true,
    visible_when: { question_id: null, option_id: null },
    options: [
      {
        option_id: 'low',
        code: 'low',
        text: 'Under $50',
        hint: 'Checkout total, after 20% off',
        icon: 'wallet',
        score_weights: { budget_low: 1 }
      },
      {
        option_id: 'mid',
        code: 'mid',
        text: 'Up to $100',
        hint: 'Checkout total, after 20% off',
        icon: 'wallet',
        score_weights: { budget_mid: 1 }
      },
      {
        option_id: 'high',
        code: 'high',
        text: 'No limit',
        hint: 'Prefer the premium end',
        icon: 'gem',
        score_weights: { budget_high: 1 }
      },
      {
        option_id: 'any',
        code: 'any',
        text: 'I have not decided',
        hint: 'Show the best-loved set',
        icon: 'clock',
        score_weights: { budget_open: 1 }
      }
    ]
  }
];

module.exports = { STARTER_QUESTIONS };
