import {
  LucideApple,
  LucideBaby,
  LucideBadgeCheck,
  LucideBan,
  LucideBean,
  LucideBlend,
  LucideBox,
  LucideBriefcase,
  LucideCandy,
  LucideCherry,
  LucideCitrus,
  LucideClock,
  LucideCoffee,
  LucideCookingPot,
  LucideCrown,
  LucideCupSoda,
  LucideDroplet,
  LucideDroplets,
  LucideFeather,
  LucideFlame,
  LucideFlower2,
  LucideGauge,
  LucideGem,
  LucideGift,
  LucideGlassWater,
  LucideHand,
  LucideHandshake,
  LucideHeart,
  LucideHouse,
  LucideLeaf,
  LucideMilk,
  LucideMoon,
  LucideMountain,
  LucidePackage,
  LucideScale,
  LucideShoppingBag,
  LucideSnowflake,
  LucideSoup,
  LucideSparkles,
  LucideStar,
  LucideSun,
  LucideThermometer,
  LucideTimer,
  LucideTreePalm,
  LucideUser,
  LucideUsers,
  LucideUtensils,
  LucideWallet,
  LucideWheat,
  LucideWind,
  LucideWine,
  LucideWrench,
  LucideZap,
  type LucideIcon
} from '@lucide/angular';

export const QUIZ_LUCIDE_ICONS: LucideIcon[] = [
  LucideApple, LucideBaby, LucideBadgeCheck, LucideBan, LucideBean, LucideBlend, LucideBox,
  LucideBriefcase, LucideCandy, LucideCherry, LucideCitrus, LucideClock, LucideCoffee,
  LucideCookingPot, LucideCrown, LucideCupSoda, LucideDroplet, LucideDroplets, LucideFeather,
  LucideFlame, LucideFlower2, LucideGauge, LucideGem, LucideGift, LucideGlassWater, LucideHand,
  LucideHandshake, LucideHeart, LucideHouse, LucideLeaf, LucideMilk, LucideMoon, LucideMountain,
  LucidePackage, LucideScale, LucideShoppingBag, LucideSnowflake, LucideSoup, LucideSparkles,
  LucideStar, LucideSun, LucideThermometer, LucideTimer, LucideTreePalm, LucideUser, LucideUsers,
  LucideUtensils, LucideWallet, LucideWheat, LucideWind, LucideWine, LucideWrench, LucideZap
];

const ALIASES: Record<string, string> = {
  cup: 'cup-soda',
  tools: 'wrench',
  sweet: 'candy',
  ice: 'snowflake',
  home: 'house'
};

export function quizIconName(icon: string | null | undefined): string {
  const raw = String(icon || '').trim().toLowerCase();
  const name = ALIASES[raw] || raw;
  const known = QUIZ_LUCIDE_ICONS.some((entry) => {
    const data = entry.icon;
    return data.name === name || (data.aliases || []).includes(name);
  });
  return known ? name : 'sparkles';
}
