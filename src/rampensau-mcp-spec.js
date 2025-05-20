/* rampensau.mcp.js – safe, alias-friendly wrapper
   -------------------------------------------------------------- */
import { nanoid } from 'nanoid';
import { z }      from 'zod';
import {
  generateColorRamp,
  generateColorRampWithCurve,
  colorUtils,
  utils,
} from 'rampensau';

const { colorToCSS, harveyHue, colorHarmonies, uniqueRandomHues } = colorUtils;
const { shuffleArray, lerp, scaleSpreadArray, pointOnCurve, makeCurveEasings } = utils;

/* ───────── helpers ───────────────────────────────────────────── */
const asResult = (x) => ({
  content: [{ type: 'text', text: typeof x === 'string' ? x : JSON.stringify(x, null, 2) }],
});

/* 0-1 **or** 0-100  →  0-1 ------------------------------------- */
const norm01 = z.number()
  .refine((v) => v >= 0 && v <= 100, 'must be 0…100')
  .transform((v) => (v > 1 ? v / 100 : v));

const Range = z.tuple([norm01, norm01]).describe('min/max (0-1 or 0-100)');

/* ───────── option shapes ────────────────────────────────────── */
const RampBase = {
  total       : z.number().int().min(3).describe('Swatch count').default(10),
  hStart      : z.number().min(0).max(360).describe('Start hue (°)').optional(),
  hStartCenter: norm01.describe('±start hue jitter').optional(),
  hCycles     : z.number().min(1).describe('Hue wraps').default(1).optional(),
  hueList     : z.array(z.number().min(0).max(360))
                 .describe('Explicit hues – overrides hStart/cycles').optional(),
  sRange      : Range.optional().describe('Saturation range'),
  lRange      : Range.optional().describe('Lightness range'),
};

/* real RampenSau accents + user-friendly aliases --------------- */
const ACCENT_ALIASES = {
  'lamé' : 'lamé', lame  : 'lamé',
  arc    : 'arc',  linear: 'arc', sine : 'arc', easeInOut: 'arc',
  pow    : 'pow',  power : 'pow',
  powx   : 'powX', powX  : 'powX',
  powy   : 'powY', powY  : 'powY',
};

const CurveOpts = {
  curveAccent: z.enum(Object.keys(ACCENT_ALIASES))
                .describe('Curve accent (aliases allowed)').optional(),
};

/* output format ------------------------------------------------ */
const Format = z.enum(['array', 'css-hsl', 'css-oklch', 'css'])
  .default('array')
  .transform((f) => (f === 'css' ? 'css-hsl' : f))
  .describe('array | css-hsl | css-oklch | css(alias)');

const FormatOpt = { format: Format.optional() };

/* colour schema (single or list) ------------------------------- */
const Color3  = z.array(z.number()).length(3);
const Palette = z.union([Color3, z.array(Color3)]);

/* ───────── spec object ───────────────────────────────────────── */
export const rampensauSpec = {
  id         : 'rampensau',
  instanceId : nanoid(),
  description: 'Colour-ramp generation & helpers (RampenSau).',

  tools: [
    /* 1 · generate --------------------------------------------- */
    {
      name       : 'generate',
      description: 'Create a colour ramp / palette.',
      parameters : { ...RampBase, ...CurveOpts, ...FormatOpt },
      examples   : [
        { total: 5, hStart: 210, sRange: [60,100], lRange: [40,80], curveAccent: 'easeInOut', format: 'css' },
        { hueList: [120,160,200], format: 'array' },
      ],
      async execute(raw) {
        const { format = 'array', curveAccent, ...opts } =
              z.object(this.parameters).parse(raw);

        const accent = curveAccent ? ACCENT_ALIASES[curveAccent] : undefined;
        const ramp   = accent
          ? generateColorRampWithCurve({ ...opts, curveAccent: accent })
          : generateColorRamp(opts);

        const out = format === 'array'
          ? ramp
          : ramp.map((c) => colorToCSS(c, format === 'css-hsl' ? 'hsl' : 'oklch'));

        return asResult(out);
      },
    },

    /* 2 · toCSS ------------------------------------------------- */
    {
      name       : 'toCSS',
      description: 'Convert colour(s) to CSS.',
      parameters : {
        color: Palette.describe('[h,s,l] or palette'),
        mode : z.enum([
          'hsl','hsv','lch','oklch',
          'css','css-hsl','css-hsv','css-lch','css-oklch',
        ]).default('oklch')
          .transform((m) => ({
            css:'hsl','css-hsl':'hsl','css-hsv':'hsv',
            'css-lch':'lch','css-oklch':'oklch',
          }[m] ?? m))
          .describe('Output space (aliases ok)'),
      },
      async execute({ color, mode }) {
        const toCss = (c) => colorToCSS(c, mode);
        const res   = Array.isArray(color[0]) ? color.map(toCss) : toCss(color);
        return asResult(res);
      },
    },

    /* 3 · colorHarmony ---------------------------------------- */
    {
      name       : 'colorHarmony',
      description: 'Return harmonic hues.',
      parameters : {
        method : z.enum([
          'complementary','splitComplementary','triadic','tetradic',
          'monochromatic','doubleComplementary','compound','analogous',
        ]),
        baseHue: z.number().min(0).max(360),
      },
      async execute({ method, baseHue }) {
        return asResult(colorHarmonies[method](baseHue));
      },
    },

    /* 4 · uniqueRandomHues ------------------------------------ */
    {
      name       : 'uniqueRandomHues',
      description: 'Generate unique random hues.',
      parameters : {
        startHue        : z.number().min(0).max(360).optional(),
        total           : z.number().int().min(1).default(5).optional(),
        minHueDiffAngle : z.number().min(0).max(360).optional(),
      },
      async execute(args) {
        return asResult(uniqueRandomHues(z.object(this.parameters).parse(args)));
      },
    },

    /* 5 · harveyHue ------------------------------------------- */
    {
      name       : 'harveyHue',
      description: 'Perceptually even hue warp.',
      parameters : { h: z.number().min(0).max(360) },
      async execute({ h }) { return asResult(harveyHue(h)); },
    },

    /* 6 · utils ------------------------------------------------ */
    {
      name       : 'utils',
      description: 'Expose RampenSau utility helpers.',
      parameters : {
        fn   : z.enum(['shuffle','lerp','scaleSpread','curvePoint','curveEasings']),
        args : z.array(z.any()).optional(),
      },
      async execute({ fn, args = [] }) {
        const map = {
          shuffle     : () => shuffleArray(...args),
          lerp        : () => lerp(...args),
          scaleSpread : () => scaleSpreadArray(...args),
          curvePoint  : () => pointOnCurve(...args)(...args.slice(2)),
          curveEasings: () => makeCurveEasings(...args),
        };
        if (!map[fn]) throw new Error(`utils: unknown fn "${fn}"`);
        return asResult(map[fn]());
      },
    },
  ],
};

export default rampensauSpec;
