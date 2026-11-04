require('dotenv').config();
const mongoose = require('mongoose');
const QuizConfig = require('../src/models/QuizConfig');
const RitualArchetype = require('../src/models/RitualArchetype');
const { QUESTIONS, ARCHETYPES } = require('../src/services/ritual-dna.config');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    const existingQuestions = await QuizConfig.find({ quiz_type: 'ritual_dna' }).select('question_id quiz_version').lean();
    const existingArchetypes = await RitualArchetype.find().select('archetype_id').lean();
    const expectedQuestionIds = new Set(QUESTIONS.map(row => row.question_id));
    const expectedArchetypeIds = new Set(ARCHETYPES.map(row => row.archetype_id));
    if (existingQuestions.some(row => !expectedQuestionIds.has(row.question_id))) throw new Error('Unexpected Ritual DNA question exists; seed will not overwrite it.');
    if (existingArchetypes.some(row => !expectedArchetypeIds.has(row.archetype_id))) throw new Error('Unexpected archetype exists; seed will not overwrite it.');
    if (existingQuestions.some(row => row.quiz_version !== QUESTIONS[0].quiz_version)) throw new Error('Quiz version differs; seed will not overwrite it.');
    for (const row of QUESTIONS) await QuizConfig.updateOne(
      { question_id: row.question_id, quiz_type: 'ritual_dna' },
      { $setOnInsert: row }, { upsert: true }
    );
    for (const row of ARCHETYPES) await RitualArchetype.updateOne(
      { archetype_id: row.archetype_id }, { $setOnInsert: row }, { upsert: true }
    );
    console.log(`Ritual DNA ready: ${await QuizConfig.countDocuments({ quiz_type: 'ritual_dna', is_active: true })} questions, ${await RitualArchetype.countDocuments({ is_active: true })} archetypes.`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => { console.error('Ritual DNA seed failed:', error.message); process.exitCode = 1; });
