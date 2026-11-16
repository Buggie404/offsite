const { scoreQuiz } = require('./ritual-dna.scoring');

function previewResult(quizRelease, archetypeRelease, answers) {
  const archetypes = archetypeRelease.archetypes
    .filter(row => row.is_active)
    .map(row => ({ ...row, profile_version: archetypeRelease.version }));
  const result = scoreQuiz(quizRelease.questions, answers, archetypes);
  return {
    radar: result.radar,
    archetype: {
      id: result.archetype.archetype_id,
      name: result.archetype.name,
      tagline: result.archetype.tagline,
      description: result.archetype.description,
      profile_version: archetypeRelease.version
    },
    ...result.attributes,
    updated_at: new Date()
  };
}

module.exports = { previewResult };
