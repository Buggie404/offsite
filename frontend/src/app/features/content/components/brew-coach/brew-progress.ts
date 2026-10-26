import { Recipe } from '../../../../shared/models/recipe.model';
import { buildCoachSteps } from './brew-coach.mapper';

export interface StoredBrewProgress {
  stepIndex: number;
  timerLeft: number | null;
}

const PROGRESS_PREFIX = 'offsite.brewProgress.';
const REVIEW_PREFIX = 'offsite.brewReview.';

export function currentBrewOwnerId(): string {
  if (typeof localStorage === 'undefined' || !localStorage.getItem('token')) return 'guest';
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return 'guest';
    const user = JSON.parse(raw) as { user_id?: unknown; _id?: unknown };
    const id = user?.user_id || user?._id;
    return id ? String(id) : 'guest';
  } catch {
    return 'guest';
  }
}

export function brewProgressKey(recipeId: string, ownerId = currentBrewOwnerId()): string {
  return `${PROGRESS_PREFIX}${ownerId}.${recipeId}`;
}

export function legacyBrewProgressKey(recipeId: string): string {
  return `${PROGRESS_PREFIX}${recipeId}`;
}

export function brewReviewKey(recipeId: string, ownerId = currentBrewOwnerId()): string {
  return `${REVIEW_PREFIX}${ownerId}.${recipeId}`;
}

export function legacyBrewReviewKey(recipeId: string): string {
  return `${REVIEW_PREFIX}${recipeId}`;
}

export function readScopedItem(scopedKey: string, legacyKey: string | null): string | null {
  if (typeof localStorage === 'undefined') return null;
  const scoped = localStorage.getItem(scopedKey);
  if (scoped != null) return scoped;
  if (!legacyKey) return null;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy == null) return null;
  localStorage.setItem(scopedKey, legacy);
  localStorage.removeItem(legacyKey);
  return legacy;
}

export function writeScopedItem(scopedKey: string, legacyKey: string | null, value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(scopedKey, value);
  if (legacyKey) localStorage.removeItem(legacyKey);
}

export function removeScopedItem(scopedKey: string, legacyKey: string | null): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(scopedKey);
  if (legacyKey) localStorage.removeItem(legacyKey);
}

export function recipeIdFromProgressKey(key: string, ownerId: string): string | null {
  if (!key.startsWith(PROGRESS_PREFIX) || !ownerId || ownerId === 'guest') return null;
  const rest = key.slice(PROGRESS_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot === -1) return rest.trim() || null;
  if (rest.slice(0, dot) !== ownerId) return null;
  return rest.slice(dot + 1).trim() || null;
}

export function readBrewProgress(recipeId: string | null | undefined): StoredBrewProgress | null {
  if (!recipeId || typeof localStorage === 'undefined') return null;
  try {
    const ownerId = currentBrewOwnerId();
    if (ownerId === 'guest') {
      localStorage.removeItem(brewProgressKey(recipeId, 'guest'));
      return null;
    }
    const raw = readScopedItem(
      brewProgressKey(recipeId, ownerId),
      ownerId === 'guest' ? null : legacyBrewProgressKey(recipeId)
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { stepIndex?: unknown; timerLeft?: unknown };
    const stepIndex = Number(parsed.stepIndex);
    const timerLeft = Number(parsed.timerLeft);
    return {
      stepIndex: Number.isInteger(stepIndex) && stepIndex >= 0 ? stepIndex : 0,
      timerLeft: Number.isFinite(timerLeft) && timerLeft >= 0 ? Math.round(timerLeft) : null,
    };
  } catch {
    return null;
  }
}

export function clearBrewProgress(recipeId: string | null | undefined): void {
  if (!recipeId || typeof localStorage === 'undefined') return;
  const ownerId = currentBrewOwnerId();
  removeScopedItem(
    brewProgressKey(recipeId, ownerId),
    ownerId === 'guest' ? null : legacyBrewProgressKey(recipeId)
  );
}

export function resumeSecondsLeft(recipe: Recipe | null | undefined, progress: StoredBrewProgress): number | null {
  if (progress.timerLeft != null) return progress.timerLeft > 0 ? progress.timerLeft : null;
  if (!recipe?.steps?.length) return null;
  const seconds = buildCoachSteps(recipe)[progress.stepIndex]?.timerSeconds ?? null;
  return seconds && seconds > 0 ? seconds : null;
}

export function brewResumeMessage(title: string, stepNumber: number, secondsLeft: number | null): string {
  const step = `You stopped at Step ${stepNumber} of ${title}`;
  if (secondsLeft == null || secondsLeft <= 0) return `${step}.`;
  const unit = secondsLeft === 1 ? 'second' : 'seconds';
  return `${step} · ${secondsLeft} ${unit} left on the timer.`;
}
