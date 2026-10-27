// Rule engine for the Starter Kit Quiz.
// Selection is table-driven (no model call). Option codes match starter.docx.

const DISCOUNT = 0.8;

const MATCHA_GRADE_ORDER = {
  light: ['ceremonial', 'premium', 'barista'],
  balanced: ['premium', 'ceremonial', 'barista'],
  bold: ['barista', 'premium', 'ceremonial'],
  sweet: ['premium', 'barista', 'ceremonial']
};

const COFFEE_ROAST_RANK = {
  light: { 'light roast': 1, 'medium light roast': 2, 'medium roast': 3 },
  balanced: { 'medium light roast': 1, 'medium roast': 1, 'light roast': 2, 'medium dark roast': 3 },
  bold: { 'dark roast': 1, 'medium dark roast': 1, 'medium roast': 2 },
  sweet: { 'medium roast': 1, 'medium dark roast': 1, 'medium light roast': 2 }
};

const SWEET_NOTES = [
  'chocolate', 'caramel', 'vanilla', 'brown sugar', 'honey', 'molasses', 'marzipan', 'cocoa'
];

const MATCHA_TOOL_ORDER = ['chasen', 'chawan', 'chashaku', 'whisk stand'];

const TITLES = {
  matcha_bundle: 'The Matcha Starter',
  coffee_bundle: 'The Coffee Starter',
  mixed_bundle: 'The Mixed Ritual',
  matcha_kit_2: 'The Matcha Pair',
  coffee_kit_2: 'The Coffee Pair',
  matcha_kit_3: 'The Matcha Kit',
  coffee_kit_3: 'The Coffee Kit'
};

function norm(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function tagKey(value) {
  return String(value || '').trim().toLowerCase();
}

function hasTag(product, tag) {
  const wanted = tagKey(tag);
  return (product.product_tag || []).some((entry) => tagKey(entry) === wanted);
}

function inStockVariant(product) {
  const variants = (product.variants || []).filter((variant) => (variant.stock ?? 0) > 0);
  return variants.find((variant) => variant.is_default) || variants[0] || null;
}

function priceOf(product) {
  return inStockVariant(product)?.price ?? 0;
}

function isEligible(product) {
  if (!product || product.is_active === false) return false;
  if (product.quiz_eligible === false) return false;
  return !!inStockVariant(product);
}

function isRelatedTea(product) {
  const name = norm(product.name);
  const tags = (product.product_tag || []).map(tagKey);
  return name.includes('related tea')
    || tags.some((tag) => tag === 'related tea' || tag === 'related-tea' || tag.includes('related tea'));
}

function matchaGradeKey(product) {
  const grade = norm(product.matcha?.product_grade);
  if (!grade) return '';
  if (grade.includes('ceremonial')) return 'ceremonial';
  if (grade.includes('premium')) return 'premium';
  if (grade.includes('barista')) return 'barista';
  return grade;
}

function roastKey(product) {
  const level = norm(product.coffee?.roast_level);
  if (!level) return '';
  if (level.includes('medium light')) return 'medium light roast';
  if (level.includes('medium dark')) return 'medium dark roast';
  if (level.includes('dark')) return 'dark roast';
  if (level.includes('medium')) return 'medium roast';
  if (level.includes('light')) return 'light roast';
  return level;
}

function toolType(product) {
  return norm(product.tools?.tool_type);
}

function wareType(product) {
  return norm(product.drinkware?.ware_type);
}

function ounces(product) {
  const source = `${product.drinkware?.product_size || ''} ${product.name || ''}`;
  const match = source.match(/(\d+(?:\.\d+)?)\s*oz/i);
  return match ? Number(match[1]) : null;
}

function sweetNoteCount(product) {
  const notes = (product.coffee?.tasting_notes || []).map(norm);
  return SWEET_NOTES.reduce(
    (count, note) => count + (notes.some((entry) => entry.includes(note)) ? 1 : 0),
    0
  );
}

function isChemexLid(product) {
  const name = norm(product.name);
  const skus = (product.variants || []).map((variant) => String(variant.sku));
  if (skus.includes('12012')) return true;
  return name.includes('chemex') && (name.includes('lid') || name.includes('cover') || name.includes('cap'));
}

function compareLaw4(a, b, budget) {
  if (budget === 'high') {
    const byPrice = priceOf(b) - priceOf(a);
    if (byPrice) return byPrice;
  } else if (budget === 'low') {
    const byPrice = priceOf(a) - priceOf(b);
    if (byPrice) return byPrice;
  } else {
    const bySold = (b.total_sold_quantity || 0) - (a.total_sold_quantity || 0);
    if (bySold) return bySold;
    const byRating = (b.rating_avg || 0) - (a.rating_avg || 0);
    if (byRating) return byRating;
    const byPrice = priceOf(a) - priceOf(b);
    if (byPrice) return byPrice;
  }
  return (a.product_id || 0) - (b.product_id || 0);
}

function sortCandidates(list, rankOf, budget, extraCompare) {
  return [...list].sort((a, b) => {
    const rankDelta = rankOf(a) - rankOf(b);
    if (rankDelta) return rankDelta;
    if (extraCompare) {
      const extra = extraCompare(a, b);
      if (extra) return extra;
    }
    return compareLaw4(a, b, budget);
  });
}

function annotate(list, rankOf, budget, extraCompare) {
  return sortCandidates(list, rankOf, budget, extraCompare).map((product, position) => ({
    product,
    rank: rankOf(product),
    position
  }));
}

function matchaRank(product, taste) {
  const order = MATCHA_GRADE_ORDER[taste] || MATCHA_GRADE_ORDER.balanced;
  const index = order.indexOf(matchaGradeKey(product));
  return index === -1 ? 99 : index + 1;
}

function coffeeRank(product, taste) {
  const table = COFFEE_ROAST_RANK[taste] || COFFEE_ROAST_RANK.balanced;
  return table[roastKey(product)] || 99;
}

function coffeeExtraCompare(taste) {
  if (taste !== 'sweet') return null;
  return (a, b) => {
    const rankA = coffeeRank(a, taste);
    const rankB = coffeeRank(b, taste);
    if (rankA !== 1 || rankB !== 1) return 0;
    return sweetNoteCount(b) - sweetNoteCount(a);
  };
}

function matchaToolRank(product) {
  const type = toolType(product);
  const index = MATCHA_TOOL_ORDER.findIndex((entry) => type.includes(entry));
  return index === -1 ? 99 : index + 1;
}

function coffeeToolRank(product, taste) {
  const type = toolType(product);
  const name = norm(product.name);
  const preferDripper = taste === 'light' || taste === 'balanced';
  const isDripper = type.includes('dripper');
  const isBrewer = type.includes('brewer');
  const isPourOver = name.includes('chemex') || name.includes('pour over') || name.includes('pour-over') || name.includes('v60');
  const isImmersion = name.includes('french') || name.includes('immersion') || name.includes('press');

  if (preferDripper) {
    if (isDripper) return 1;
    if (isBrewer && isPourOver) return 2;
    if (isBrewer) return 3;
  } else {
    if (isBrewer && isImmersion) return 1;
    if (isBrewer) return 2;
    if (isDripper) return 3;
  }
  return 99;
}

function drinkwareRank(product, drink) {
  const ware = wareType(product);
  const isMug = ware.includes('mug');
  const isBottle = ware.includes('bottle');
  const isTeapot = ware.includes('teapot');
  const size = ounces(product);

  if (drink === 'iced') {
    if (isBottle) return 1;
    if (isMug) return 2;
  } else if (drink === 'milk') {
    if (isMug && size != null && size >= 10) return 1;
    if (isMug || isBottle) return 2;
  } else if (isMug) {
    return 1;
  } else if (isBottle) {
    return 2;
  }
  if (isTeapot) return 3;
  return 99;
}

function matchaPowder(products, relaxGrades) {
  return products.filter((product) => {
    if (!isEligible(product) || product.category !== 'matcha' || isRelatedTea(product)) return false;
    const grade = matchaGradeKey(product);
    if (!grade) return false;
    if (!relaxGrades && !['ceremonial', 'premium', 'barista'].includes(grade)) return false;
    return true;
  });
}

function coffeePowder(products) {
  return products.filter((product) => {
    if (!isEligible(product) || product.category !== 'coffee') return false;
    const process = norm(product.coffee?.process_type);
    return process !== 'decaf' && !process.includes('decaf');
  });
}

function matchaTools(products) {
  return products.filter((product) => {
    if (!isEligible(product) || product.category !== 'tools') return false;
    if (!hasTag(product, 'tea-tools')) return false;
    const type = toolType(product);
    if (type.includes('kettle') || type.includes('dripper')) return false;
    return MATCHA_TOOL_ORDER.some((entry) => type.includes(entry));
  });
}

function coffeeTools(products) {
  return products.filter((product) => {
    if (!isEligible(product)) return false;
    if (!hasTag(product, 'coffee-tools')) return false;
    if (isChemexLid(product)) return false;
    const type = toolType(product);
    if (['filter', 'kettle', 'grinder'].some((blocked) => type === blocked || type.includes(blocked))) {
      return false;
    }
    return type.includes('dripper') || type.includes('brewer');
  });
}

function drinkware(products, allowTeapots) {
  return products.filter((product) => {
    if (!isEligible(product) || product.category !== 'drinkware') return false;
    const ware = wareType(product);
    if (ware.includes('mug') || ware.includes('bottle')) return true;
    return allowTeapots && ware.includes('teapot');
  });
}

function chooseN(annotated, count) {
  const combos = [];
  const walk = (start, acc) => {
    if (acc.length === count) {
      combos.push(acc.slice());
      return;
    }
    for (let index = start; index < annotated.length; index += 1) {
      acc.push(annotated[index]);
      walk(index + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return combos;
}

function diverseEnough(combo, kind) {
  if (combo.length < 3) return true;
  if (kind === 'matcha') {
    return new Set(combo.map((item) => matchaGradeKey(item.product))).size >= 2;
  }
  if (kind === 'coffee') {
    return new Set(combo.map((item) => roastKey(item.product))).size >= 2;
  }
  return true;
}

function applyDiversity(combos, kind) {
  if (!combos.length || combos[0].length < 3) return combos;
  if (kind !== 'matcha' && kind !== 'coffee') return combos;
  const diverse = combos.filter((combo) => diverseEnough(combo, kind));
  return diverse.length ? diverse : combos;
}

function payOf(combo) {
  const original = combo.reduce((sum, item) => sum + priceOf(item.product), 0);
  return {
    original: roundMoney(original),
    sale: roundMoney(original * DISCOUNT)
  };
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function rankSum(combo) {
  return combo.reduce((sum, item) => sum + item.rank, 0);
}

function positionSum(combo) {
  return combo.reduce((sum, item) => sum + item.position, 0);
}

function minProductId(combo) {
  return Math.min(...combo.map((item) => item.product.product_id || 0));
}

function byQuality(a, b) {
  const rankDelta = rankSum(a) - rankSum(b);
  if (rankDelta) return rankDelta;
  const positionDelta = positionSum(a) - positionSum(b);
  if (positionDelta) return positionDelta;
  const priceDelta = payOf(a).original - payOf(b).original;
  if (priceDelta) return priceDelta;
  return minProductId(a) - minProductId(b);
}

function bestCombo(combos) {
  return [...combos].sort(byQuality)[0] || null;
}

function cheapestCombo(combos) {
  return [...combos].sort((a, b) => {
    const priceDelta = payOf(a).original - payOf(b).original;
    if (priceDelta) return priceDelta;
    return byQuality(a, b);
  })[0] || null;
}

function capFor(budget) {
  if (budget === 'low') return 50;
  if (budget === 'mid') return 100;
  return null;
}

function withinCap(combos, cap) {
  if (cap == null) return combos;
  return combos.filter((combo) => payOf(combo).sale <= cap + 0.001);
}

function resolveLane(answers) {
  if (answers.q2 === 'M' || answers.q2b === 'LM') return 'matcha';
  if (answers.q2 === 'C' || answers.q2b === 'LC') return 'coffee';
  return null;
}

function resolveOption(answers) {
  const lane = resolveLane(answers);
  if (!lane) return { error: 'Choose a side to lean toward before we build the kit.' };

  if (answers.q1 === 'E3' && answers.q2 === 'M') {
    return { mode: 'bundle', lane: 'matcha', mix: 'matcha', kitType: 'bundle', categoryFilter: 'matcha', archetype: 'matcha_bundle' };
  }
  if (answers.q1 === 'E3' && answers.q2 === 'C') {
    return { mode: 'bundle', lane: 'coffee', mix: 'coffee', kitType: 'bundle', categoryFilter: 'coffee', archetype: 'coffee_bundle' };
  }
  if (answers.q1 === 'E3' && answers.q2 === 'B') {
    return { mode: 'bundle', lane, mix: 'mixed', kitType: 'bundle', categoryFilter: 'all', archetype: 'mixed_bundle' };
  }
  if (answers.q1 === 'E2') {
    return {
      mode: 'kit',
      packSize: 2,
      lane,
      kitType: lane === 'matcha' ? 'matcha_kit' : 'coffee_kit',
      categoryFilter: 'all',
      archetype: lane === 'matcha' ? 'matcha_kit_2' : 'coffee_kit_2'
    };
  }
  if (answers.q1 === 'E1') {
    return {
      mode: 'kit',
      packSize: 3,
      lane,
      kitType: lane === 'matcha' ? 'matcha_kit' : 'coffee_kit',
      categoryFilter: 'all',
      archetype: lane === 'matcha' ? 'matcha_kit_3' : 'coffee_kit_3'
    };
  }
  return { error: 'Answer every question to see a starter kit.' };
}

function powderAnnotated(products, lane, taste, budget, relaxGrades) {
  if (lane === 'matcha') {
    return annotate(
      matchaPowder(products, relaxGrades),
      (product) => matchaRank(product, taste),
      budget
    );
  }
  return annotate(
    coffeePowder(products),
    (product) => coffeeRank(product, taste),
    budget,
    coffeeExtraCompare(taste)
  );
}

function buildBundleCombos(products, option, taste, budget, flags) {
  const matcha = powderAnnotated(products, 'matcha', taste, budget, flags.relaxGrades);
  const coffee = powderAnnotated(products, 'coffee', taste, budget, flags.relaxGrades);

  if (option.mix === 'mixed') {
    const primary = option.lane === 'matcha' ? matcha : coffee;
    const secondary = option.lane === 'matcha' ? coffee : matcha;
    const combos = [];
    for (const pair of chooseN(primary, 1)) {
      for (const other of chooseN(secondary, 1)) {
        combos.push([...pair, ...other]);
      }
    }
    for (const pair of chooseN(primary, 2)) {
      for (const other of chooseN(secondary, 1)) {
        combos.push([...pair, ...other]);
      }
    }
    return { combos, orders: { powder: primary, secondary }, empty: !primary.length || !secondary.length };
  }

  const pool = option.mix === 'matcha' ? matcha : coffee;
  const combos = [...chooseN(pool, 3), ...chooseN(pool, 2)];
  return { combos, orders: { powder: pool }, empty: pool.length < 2, diversity: option.mix };
}

function buildKitCombos(products, option, taste, drink, budget, flags) {
  const powder = powderAnnotated(products, option.lane, taste, budget, flags.relaxGrades);
  const tools = option.lane === 'matcha'
    ? annotate(matchaTools(products), matchaToolRank, budget)
    : annotate(coffeeTools(products), (product) => coffeeToolRank(product, taste), budget);
  const cups = option.packSize === 3
    ? annotate(drinkware(products, flags.allowTeapots), (product) => drinkwareRank(product, drink), budget)
    : [];

  if (!powder.length) return { emptySlot: 'package', combos: [] };
  if (!tools.length) return { emptySlot: 'tool', combos: [], powder };
  if (option.packSize === 3 && !cups.length) return { emptySlot: 'drinkware', combos: [], powder, tools };

  const combos = [];
  for (const leaf of powder) {
    for (const tool of tools) {
      if (option.packSize === 2) {
        combos.push([leaf, tool]);
        continue;
      }
      for (const cup of cups) {
        combos.push([leaf, tool, cup]);
      }
    }
  }

  return { combos, powder, tools, cups };
}

function selectCombo(combos, cap, dropCap, diversity) {
  if (!combos.length) return null;
  if (dropCap) return cheapestCombo(combos);

  const sized = {
    3: applyDiversity(combos.filter((combo) => combo.length === 3), diversity),
    2: combos.filter((combo) => combo.length === 2)
  };

  const fittedThree = withinCap(sized[3], cap);
  if (fittedThree.length) return bestCombo(fittedThree);
  const fittedTwo = withinCap(sized[2], cap);
  return fittedTwo.length ? bestCombo(fittedTwo) : null;
}

function slotPlan(option, combo) {
  if (option.mode === 'bundle') {
    return combo.map((item, index) => ({
      slotKey: `package-${index}`,
      slotLabel: `Package ${index + 1}`,
      item
    }));
  }

  const slots = [
    { slotKey: 'package', slotLabel: 'Package' },
    { slotKey: 'tool', slotLabel: 'Tool' }
  ];
  if (option.packSize === 3) slots.push({ slotKey: 'drinkware', slotLabel: 'Drinkware' });
  return slots.map((slot, index) => ({ ...slot, item: combo[index] }));
}

function orderIds(annotated) {
  return (annotated || []).map((item) => item.product.product_id);
}

function whyText(answers, archetype) {
  const taste = {
    light: 'bright and light',
    balanced: 'balanced',
    bold: 'bold and strong',
    sweet: 'sweet and easy to drink'
  }[answers.q3] || 'your';
  const drink = {
    hot: 'mostly hot',
    iced: 'mostly iced',
    milk: 'with milk',
    any: 'hot or iced, depending on the day'
  }[answers.q4] || 'your usual way';
  const setup = {
    E1: 'You are starting without gear, so this kit includes something to brew with and something to drink from.',
    E2: 'You already have a cup, so this kit adds the leaves or beans and the tool to brew them.',
    E3: 'You already have the tools, so this kit is the powder or coffee to start brewing.'
  }[answers.q1] || '';

  const lead = {
    matcha_bundle: 'A matcha bundle',
    coffee_bundle: 'A coffee bundle',
    mixed_bundle: 'A mixed matcha and coffee bundle',
    matcha_kit_2: 'A two-piece matcha kit',
    coffee_kit_2: 'A two-piece coffee kit',
    matcha_kit_3: 'A three-piece matcha kit',
    coffee_kit_3: 'A three-piece coffee kit'
  }[archetype] || 'This kit';

  return `${lead} for a ${taste} cup, drunk ${drink}. ${setup}`.trim();
}

function toPublicItem(slot, note) {
  const variant = inStockVariant(slot.item.product);
  return {
    slotKey: slot.slotKey,
    slotLabel: slot.slotLabel,
    productId: slot.item.product.product_id,
    variantSku: variant?.sku || '',
    name: slot.item.product.name,
    price: variant?.price ?? 0,
    image: variant?.images?.[0]?.url || slot.item.product.images?.[0]?.url || '',
    product: slot.item.product,
    note: note || null
  };
}

function substituteNotes(slots, previousItems) {
  if (!Array.isArray(previousItems) || !previousItems.length) return [];
  const notes = [];
  slots.forEach((slot, index) => {
    const previous = previousItems.find((item) => item.slotKey === slot.slotKey) || previousItems[index];
    if (!previous || previous.productId === slot.item.product.product_id) return;
    const name = previous.name || 'the previous pick';
    notes.push({
      slotKey: slot.slotKey,
      text: `Replaces ${name}.`
    });
  });
  return notes;
}

function assemble(option, combo, answers, budget, notes, previousItems, orders) {
  const pricing = payOf(combo);
  const cap = capFor(budget);
  const slots = slotPlan(option, combo);
  const extraNotes = [...notes];
  if (cap != null && pricing.sale > cap) {
    extraNotes.push({
      slotKey: null,
      text: `Over budget by $${roundMoney(pricing.sale - cap).toFixed(2)}.`
    });
  }
  for (const note of substituteNotes(slots, previousItems)) extraNotes.push(note);

  const noteBySlot = new Map(extraNotes.filter((note) => note.slotKey).map((note) => [note.slotKey, note.text]));
  const items = slots.map((slot) => toPublicItem(slot, noteBySlot.get(slot.slotKey)));
  const packSize = items.length === 3 ? 3 : 2;
  const slotProductOrder = {};

  if (option.mode === 'bundle') {
    const ids = option.mix === 'mixed'
      ? [...orderIds(orders.powder), ...orderIds(orders.secondary)]
      : orderIds(orders.powder);
    items.forEach((item) => {
      slotProductOrder[item.slotKey] = ids;
    });
  } else {
    slotProductOrder.package = orderIds(orders.powder);
    slotProductOrder.tool = orderIds(orders.tools);
    if (orders.cups) slotProductOrder.drinkware = orderIds(orders.cups);
  }

  const archetype = option.archetype;
  return {
    title: TITLES[archetype] || 'Your starter kit',
    why: whyText(answers, archetype),
    archetypeId: archetype,
    kitType: option.kitType,
    packSize,
    categoryFilter: option.categoryFilter,
    discountPercent: 20,
    pricing,
    notes: extraNotes.map((note) => note.text),
    items,
    slotProductOrder,
    bundleId: `SK-${archetype}-${items.map((item) => item.productId).sort((a, b) => a - b).join('-')}`
  };
}

function matchStarterKit(answers, products, previousItems) {
  const required = ['q1', 'q2', 'q3', 'q4', 'q5'];
  if (required.some((key) => !answers?.[key])) {
    return { error: 'Answer every question to see a starter kit.' };
  }
  if (answers.q2 === 'B' && !answers.q2b) {
    return { error: 'Choose a side to lean toward before we build the kit.' };
  }

  const option = resolveOption(answers);
  if (option.error) return { error: option.error };

  const taste = answers.q3;
  const drink = answers.q4;
  const budget = answers.q5;
  const cap = capFor(budget);
  const catalog = Array.isArray(products) ? products : [];

  const attempts = [
    { relaxGrades: false, allowTeapots: false, dropCap: false, notes: [] },
    { relaxGrades: true, allowTeapots: true, dropCap: false, notes: [] },
    { relaxGrades: true, allowTeapots: true, dropCap: true, notes: [] }
  ];

  let toolFallback = false;

  for (const attempt of attempts) {
    if (option.mode === 'bundle') {
      const built = buildBundleCombos(catalog, option, taste, budget, attempt);
      if (built.empty) continue;
      const combo = selectCombo(built.combos, attempt.dropCap ? null : cap, attempt.dropCap, built.diversity);
      if (!combo) continue;
      return {
        kit: assemble(option, combo, answers, budget, attempt.notes, previousItems, {
          powder: built.orders.powder,
          secondary: built.orders.secondary
        })
      };
    }

    const built = buildKitCombos(catalog, option, taste, drink, budget, attempt);
    if (built.emptySlot === 'tool') {
      toolFallback = true;
      break;
    }
    if (built.emptySlot === 'drinkware' && built.powder?.length && built.tools?.length) {
      const reduced = {
        ...option,
        packSize: 2,
        archetype: option.lane === 'matcha' ? 'matcha_kit_2' : 'coffee_kit_2'
      };
      const combo = selectCombo(
        built.powder.flatMap((leaf) => built.tools.map((tool) => [leaf, tool])),
        attempt.dropCap ? null : cap,
        attempt.dropCap
      );
      if (!combo) continue;
      return {
        kit: assemble(reduced, combo, answers, budget, [{
          slotKey: null,
          text: 'Drinkware is temporarily out of stock.'
        }], previousItems, { powder: built.powder, tools: built.tools })
      };
    }
    if (built.emptySlot) continue;
    const combo = selectCombo(built.combos, attempt.dropCap ? null : cap, attempt.dropCap);
    if (!combo) continue;
    return {
      kit: assemble(option, combo, answers, budget, attempt.notes, previousItems, {
        powder: built.powder,
        tools: built.tools,
        cups: built.cups
      })
    };
  }

  if (option.mode === 'kit' && toolFallback) {
    const bundleOption = {
      mode: 'bundle',
      lane: option.lane,
      mix: option.lane,
      kitType: 'bundle',
      categoryFilter: option.lane,
      archetype: option.lane === 'matcha' ? 'matcha_bundle' : 'coffee_bundle'
    };
    const built = buildBundleCombos(catalog, bundleOption, taste, budget, {
      relaxGrades: true,
      allowTeapots: true
    });
    const combo = selectCombo(
      (built.combos || []).filter((entry) => entry.length === 2),
      null,
      true,
      bundleOption.mix
    );
    if (combo) {
      return {
        kit: assemble(bundleOption, combo, answers, budget, [{
          slotKey: null,
          text: 'Tools are temporarily out of stock.'
        }], previousItems, { powder: built.orders.powder })
      };
    }
  }

  return { error: 'We could not find a starter kit from the products in stock. Please try Build Your Bundle.' };
}

module.exports = {
  matchStarterKit,
  capFor,
  DISCOUNT
};
