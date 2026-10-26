import { Recipe, RecipeIngredient, RecipeStep, RecipeTool } from '../../../../shared/models/recipe.model';

export interface CoachNeed {
  name: string;
  amount: string;
}

export interface CoachAdjustment {
  label: string;
  message: string;
  from: string;
  to: string;
}

export interface CoachStepView {
  title: string;
  description: string;
  needs: CoachNeed[];
  timerSeconds: number | null;
  whileItRuns: string;
  adjustment: CoachAdjustment | null;
}

const COMPACT_UNITS = ['g', 'kg', 'ml', 'l', 'oz', 'lb'];

export function buildCoachSteps(recipe: Recipe): CoachStepView[] {
  const source = recipe.steps.length
    ? [...recipe.steps].sort((a, b) => a.order - b.order)
    : [{
        order: 1,
        title: recipe.title,
        description: recipe.description || 'Follow the recipe at your pace.',
      }];

  return source.map((step, index) => toCoachStep(step, index, recipe));
}

function toCoachStep(step: RecipeStep, index: number, recipe: Recipe): CoachStepView {
  const text = `${step.title}. ${step.description}`;
  const description = step.description.trim() || step.title;
  const needs = matchNeeds(text, recipe.ingredients, recipe.tools, index);
  const timerSeconds = resolveTimer(text);
  const adjustment = buildAdjustment(step);

  return {
    title: step.title,
    description,
    needs,
    timerSeconds,
    whileItRuns: description,
    adjustment,
  };
}

function resolveTimer(text: string): number | null {
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minutes)\b/i);
  if (minutes) return Math.max(1, Math.round(parseFloat(minutes[1]) * 60));

  const seconds = text.match(/(\d+)\s*(?:sec|secs|seconds)\b/i);
  if (seconds) return Math.max(1, parseInt(seconds[1], 10));

  const clock = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (clock) return parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10);

  if (/whisk|froth|foam/i.test(text)) return 45;
  if (/bloom|steep|rest|wait/i.test(text)) return 30;
  if (/\bpour\b/i.test(text)) return 20;
  return null;
}

function matchNeeds(
  text: string,
  ingredients: RecipeIngredient[],
  tools: RecipeTool[],
  index: number,
): CoachNeed[] {
  const hay = text.toLowerCase();
  const ingredientNeeds = ingredients
    .filter(ingredient => ingredientMentioned(hay, ingredient))
    .sort((a, b) => Number(a.optional) - Number(b.optional))
    .slice(0, 3)
    .map(ingredient => ({
      name: chipName(ingredient.name),
      amount: formatAmount(ingredient),
    }));

  const toolNeeds = tools
    .filter(tool => wordsOf(tool.name).some(word => hay.includes(word)))
    .slice(0, 2)
    .map(tool => ({ name: chipName(tool.name), amount: 'tool' }));

  const needs = [...ingredientNeeds, ...toolNeeds].slice(0, 4);
  if (needs.length) return needs;

  const ingredient = ingredients[index % Math.max(ingredients.length, 1)];
  if (ingredient) {
    needs.push({ name: chipName(ingredient.name), amount: formatAmount(ingredient) });
  }
  const tool = tools[index % Math.max(tools.length, 1)];
  if (tool) needs.push({ name: chipName(tool.name), amount: 'tool' });
  return needs;
}

function ingredientMentioned(hay: string, ingredient: RecipeIngredient): boolean {
  const words = wordsOf(ingredient.name);
  const mentioned = words.some(word => hay.includes(word));
  if (!mentioned) return false;
  if (!ingredient.optional) return true;
  return /\bgarnish\b|\boptional\b/i.test(hay);
}

function wordsOf(name: string): string[] {
  return chipName(name)
    .toLowerCase()
    .split(/[^a-z0-9°]+/i)
    .filter(word => word.length > 3 && !['grade', 'with', 'from', 'your'].includes(word));
}

function chipName(name: string): string {
  const wrapped = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!wrapped) return name.trim();
  if (/°/.test(wrapped[2])) return `${wrapped[1].trim()} ${wrapped[2].trim()}`;
  return wrapped[1].trim();
}

function formatAmount(ingredient: RecipeIngredient): string {
  const unit = (ingredient.unit || '').trim();
  if (ingredient.quantity == null) return unit;
  if (!unit) return `${ingredient.quantity}`;
  if (COMPACT_UNITS.includes(unit.toLowerCase())) return `${ingredient.quantity}${unit}`;
  return `${ingredient.quantity} ${unit}`;
}

function buildAdjustment(step: RecipeStep): CoachAdjustment | null {
  const raw = (step as RecipeStep & { adjustment?: Partial<CoachAdjustment> | null }).adjustment;
  const message = raw?.message?.trim() ?? '';
  const from = raw?.from?.trim() ?? '';
  const to = raw?.to?.trim() ?? '';
  if (!message || !from || !to) return null;

  return {
    label: raw?.label?.trim() || 'Adjusted from your last brew',
    message,
    from,
    to,
  };
}
