/**
 * cards.js — Seed vocabulary data
 *
 * Each card object has:
 *   zh      {string}  Chinese characters
 *   pinyin  {string}  Romanised pronunciation
 *   en      {string}  English definition shown on the front of the card
 *   cat     {string}  Category label (used for filtering)
 *
 * To add a new built-in category, append entries here using the same shape,
 * or use the "+ Add Vocabulary" panel in the app to import at runtime.
 */

const SEED_CARDS = [
  // ── Cooking ────────────────────────────────────────────────
  { en: "Cooking / Culinary",    zh: "烹饪", pinyin: "pēng rèn",  cat: "Cooking" },
  { en: "Method / Way",          zh: "方法", pinyin: "fāng fǎ",   cat: "Cooking" },
  { en: "To stir-fry",           zh: "炒",   pinyin: "chǎo",      cat: "Cooking" },
  { en: "To steam",              zh: "蒸",   pinyin: "zhēng",     cat: "Cooking" },
  { en: "To boil",               zh: "煮",   pinyin: "zhǔ",       cat: "Cooking" },
  { en: "To stew / To braise",   zh: "炖",   pinyin: "dùn",       cat: "Cooking" },
  { en: "To pan-fry",            zh: "煎",   pinyin: "jiān",      cat: "Cooking" },
  { en: "To deep-fry",           zh: "炸",   pinyin: "zhá",       cat: "Cooking" },
  { en: "To roast / To bake",    zh: "烤",   pinyin: "kǎo",       cat: "Cooking" },
  { en: "Red-braised",           zh: "红烧", pinyin: "hóng shāo", cat: "Cooking" },
  { en: "Light (taste) / Mild",  zh: "清淡", pinyin: "qīng dàn",  cat: "Cooking" },
  { en: "Healthy",               zh: "健康", pinyin: "jiàn kāng", cat: "Cooking" },
  { en: "Heat control / Timing", zh: "火候", pinyin: "huǒ hòu",   cat: "Cooking" },
  { en: "Ingredients",           zh: "食材", pinyin: "shí cái",   cat: "Cooking" },
  { en: "Flavor / Taste",        zh: "味道", pinyin: "wèi dào",   cat: "Cooking" },
  { en: "Recipe / Cookbook",     zh: "菜谱", pinyin: "cài pǔ",    cat: "Cooking" },
  { en: "Chef / Cook",           zh: "厨师", pinyin: "chú shī",   cat: "Cooking" },
  { en: "Experience",            zh: "经验", pinyin: "jīng yàn",  cat: "Cooking" },
  { en: "Art",                   zh: "艺术", pinyin: "yì shù",    cat: "Cooking" },
  { en: "Science",               zh: "科学", pinyin: "kē xué",    cat: "Cooking" },
  { en: "Western food",          zh: "西餐", pinyin: "xī cān",    cat: "Cooking" },
  { en: "Chinese food",          zh: "中餐", pinyin: "zhōng cān", cat: "Cooking" },
  { en: "Staple food",           zh: "主食", pinyin: "zhǔ shí",   cat: "Cooking" },
  { en: "Carbohydrates",         zh: "碳水", pinyin: "tàn shuǐ",  cat: "Cooking" },
];
