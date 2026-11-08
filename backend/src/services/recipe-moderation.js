const Recipe = require('../models/Recipe');
const User = require('../models/User');
const { createNotification } = require('./notification.service');

const MAX_REVIEW_ROUNDS = 3;

function isDeleted(recipe) {
  return Boolean(recipe?.deletedAt);
}

function isHidden(recipe) {
  if (isDeleted(recipe)) return false;
  return recipe?.hiddenByAdmin === true
    || recipe?.moderation_status === 'hidden'
    || recipe?.moderation_status === 'resubmitted'
    || recipe?.moderation_status === 'hidden_final'
    || recipe?.published === false;
}

function applyHideFields(recipe, { reason, note, by, status = 'hidden' }) {
  recipe.published = false;
  recipe.featured = false;
  recipe.hiddenByAdmin = true;
  recipe.moderation_status = status;
  recipe.hidden_reason = reason;
  recipe.hidden_note = note || '';
  recipe.adminNote = note || reason || '';
  recipe.hidden_by = by;
  recipe.hidden_at = new Date();
  recipe.restored_by = null;
  recipe.restored_at = null;
  recipe.updatedAt = new Date().toISOString();
}

function clearHideFields(recipe, { by } = {}) {
  recipe.published = true;
  recipe.hiddenByAdmin = false;
  recipe.moderation_status = 'visible';
  recipe.hidden_reason = null;
  recipe.hidden_note = '';
  recipe.adminNote = '';
  recipe.hidden_by = null;
  recipe.hidden_at = null;
  recipe.resubmitted_at = null;
  recipe.review_round = 0;
  recipe.restored_by = by || null;
  recipe.restored_at = by ? new Date() : null;
  recipe.updatedAt = new Date().toISOString();
}

function applySoftDeleteFields(recipe, { reason, note, by }) {
  recipe.published = false;
  recipe.featured = false;
  recipe.deletedAt = new Date();
  recipe.deleted_reason = reason || null;
  recipe.deleted_note = note || '';
  recipe.deleted_by = by || null;
  recipe.updatedAt = new Date().toISOString();
}

async function findSaverUserIds(recipeId) {
  const users = await User.find({ 'saved_recipes.recipe_id': recipeId })
    .select('user_id')
    .lean();
  return users.map((user) => user.user_id).filter(Boolean);
}

async function pullSavedRecipe(recipeId) {
  // Saved items and My Pantry both keep recipe refs on the user.
  // Clear every list so a deleted recipe does not linger in Your brews.
  await User.updateMany(
    {
      $or: [
        { 'saved_recipes.recipe_id': recipeId },
        { 'started_recipes.recipe_id': recipeId },
        { 'done_recipes.recipe_id': recipeId },
        { hidden_pantry_recipes: recipeId }
      ]
    },
    {
      $pull: {
        saved_recipes: { recipe_id: recipeId },
        started_recipes: { recipe_id: recipeId },
        done_recipes: { recipe_id: recipeId },
        hidden_pantry_recipes: recipeId
      }
    }
  );
}

async function notifySavers(recipeId, title) {
  const saverIds = await findSaverUserIds(recipeId);
  const message = title
    ? `A recipe you saved (“${title}”) was removed from Recipes.`
    : 'A recipe you saved was removed from Recipes.';
  await Promise.all(saverIds.map((recipient_id) => createNotification({
    recipient_id,
    type: 'RECIPE_MODERATION',
    post_id: null,
    recipe_slug: null,
    message
  }).catch((error) => {
    console.error('Error notifying recipe saver:', error);
  })));
  return saverIds;
}

async function softDeleteRecipe(recipe, { reason, note, by, notifySavers: shouldNotifySavers = true }) {
  applySoftDeleteFields(recipe, { reason, note, by });
  await recipe.save();
  let saverIds = [];
  if (shouldNotifySavers) {
    saverIds = await notifySavers(recipe.recipe_id, recipe.title);
  }
  await pullSavedRecipe(recipe.recipe_id);
  return { saverIds };
}

function isOwnerCatalogRecipe(recipe, userId) {
  if (!recipe || !userId || isDeleted(recipe)) return false;
  if (String(recipe.owner_user_id || '') !== String(userId)) return false;
  return recipe.lifecycle === 'catalog';
}

function ownerCanEdit(recipe, userId) {
  if (!isOwnerCatalogRecipe(recipe, userId)) return false;
  if (recipe.moderation_status === 'hidden_final') return false;
  if (recipe.moderation_status === 'resubmitted') return false;
  return true;
}

function ownerCanSubmitReview(recipe, userId) {
  if (!isOwnerCatalogRecipe(recipe, userId)) return false;
  if (recipe.moderation_status !== 'hidden') return false;
  if (recipe.hidden_reason !== 'low_quality') return false;
  if (recipe.moderation_status === 'hidden_final') return false;
  return Number(recipe.review_round || 0) < MAX_REVIEW_ROUNDS;
}

function ownerCanDelete(recipe, userId) {
  return isOwnerCatalogRecipe(recipe, userId);
}

module.exports = {
  MAX_REVIEW_ROUNDS,
  isDeleted,
  isHidden,
  applyHideFields,
  clearHideFields,
  applySoftDeleteFields,
  softDeleteRecipe,
  findSaverUserIds,
  pullSavedRecipe,
  notifySavers,
  isOwnerCatalogRecipe,
  ownerCanEdit,
  ownerCanSubmitReview,
  ownerCanDelete
};
