/* rampensau.mcp.js – alias-friendly, self-documenting API
   --------------------------------------------------------------- */
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
const asResult = (data) => ({
  content: [{
    type : 'text',
    text : typeof data === 'string'
      ? data
      : JSON.stringify(data, null, 2),
  }],
});

/* 0-1  or  0-100  ➜  0-1 */
const norm01 = z.number()
  .refine((v) => v >= 0 && v <= 100, 'must be between 0 and 100')
  .transform((v) => (v > 1 ? v / 100 : v));

const RangeTuple = z
  .tuple([norm01, norm01])
  .describe('min/max (0–1 or 0–100)');

/* ───────── shared option shapes ──────────────────────────────── */
const RampBase = {
  total       : z.number().int().min(3)
                 .describe('How many swatches.').default(10),

  hStart      : z.number().min(0).max(360)
                 .describe('Starting hue (°).').optional(),

  hStartCenter: norm01.describe('Randomise first hue by ± this fraction of 360°')
                 .optional(),

  hCycles     : z.number().min(1)
                 .describe('Number of hue wraps.').default(1).optional(),

  hueList     : z.array(z.number().min(0).max(360))
                 .describe('Explicit list of hues. Overrides hStart / cycles.')
                 .optional(),

  sRange      : RangeTuple.optional()
                 .describe('Saturation range. Ex: [0.7,1] or [70,100]'),

  lRange      : RangeTuple.optional()
                 .describe('Lightness range. Ex: [0.2,0.4] or [20,40]'),
};

const CurveExtra = {
  curveMethod : z.enum(['lamé', 'sine', 'power', 'linear'])
                 .describe('Curve algorithm for easing.').optional(),
  curveAccent : z.number().min(0).max(5)
                 .describe('Accent strength for curveMethod.').optional(),
};

/* Accept array / css-hsl / css-oklch / css (alias → css-hsl) */
const Format = z
  .enum(['array', 'css-hsl', 'css-oklch', 'css'])
  .default('array')
  .transform((f) => (f === 'css' ? 'css-hsl' : f))
  .describe('Output format: raw array, css-hsl, css-oklch (css = css-hsl)');

const FormatOpt = { format: Format.optional() };

/* ───────── spec object ───────────────────────────────────────── */
export const rampensauSpec = {
  id         : 'rampensau',
  instanceId : nanoid(),
  description: 'Colour-ramp generation & utilities from RampenSau.',

  tools: [
    /* 1 · generate palette -------------------------------------- */
    {
      name       : 'generate',
      description: 'Generate a colour ramp / palette.',
      parameters : { ...RampBase, ...CurveExtra, ...FormatOpt },
      examples   : [
        { total: 8, hStart: 220, sRange: [70,100], lRange: [20,40] },
        { total: 5, hCycles: 2, curveMethod: 'sine', format: 'css-hsl' },
        { total: 5, hueList: [120,140,160,180,200], format: 'css' },
      ],
      async execute(raw) {
        /* validate + alias handling */
        const parsed = z.object(this.parameters).parse(raw);
        const { format = 'array', curveMethod, ...opts } = parsed;

        const ramp = curveMethod
          ? generateColorRampWithCurve({ ...opts, curveMethod })
          : generateColorRamp(opts);

        const out =
          format === 'array'
            ? ramp
            : ramp.map((c) =>
                colorToCSS(c, format === 'css-hsl' ? 'hsl' : 'oklch'),
              );

        return asResult(out);
      },
    },

    /* 2 · uniqueRandomHues -------------------------------------- */
    {
      name       : 'uniqueRandomHues',
      description: 'Generate unique random hues.',
      parameters : {
        startHue        : z.number().min(0).max(360)
                           .describe('Central hue.').optional(),
        total           : z.number().int().min(1)
                           .describe('Quantity.').default(5).optional(),
        minHueDiffAngle : z.number().min(0).max(360)
                           .describe('Min separation (°).').optional(),
      },
      async execute(args) {
        const opts = z.object(this.parameters).parse(args);
        return asResult(uniqueRandomHues(opts));
      },
    },

    /* 3 · colorHarmony ----------------------------------------- */
    {
      name       : 'colorHarmony',
      description: 'Return harmony hues.',
      parameters : {
        method : z.enum([
          'complementary', 'splitComplementary', 'triadic',
          'tetradic', 'monochromatic', 'doubleComplementary',
          'compound', 'analogous',
        ]).describe('Harmony type.'),
        baseHue: z.number().min(0).max(360).describe('Base hue (°).'),
      },
      async execute({ method, baseHue }) {
        return asResult(colorHarmonies[method](baseHue));
      },
    },

    /* 4 · toCSS ------------------------------------------------- */
    {
      name       : 'toCSS',
      description: 'Convert [h,s,l] → CSS string.',
      parameters : {
        color: z.array(z.number()).length(3)
                 .describe('[h, s, l] from RampenSau'),
        mode : z
          .enum([
            'hsl', 'hsv', 'lch', 'oklch',
            'css', 'css-hsl', 'css-hsv', 'css-lch', 'css-oklch',
          ])
          .default('oklch')
          .transform((m) => {
            if (m === 'css' || m === 'css-hsl') return 'hsl';
            if (m === 'css-hsv')                return 'hsv';
            if (m === 'css-lch')                return 'lch';
            if (m === 'css-oklch')              return 'oklch';
            return m;
          })
          .describe('Output space (aliases allowed).')
          .optional(),
      },
      async execute({ color, mode }) {
        return asResult(colorToCSS(color, mode));
      },
    },

    /* 5 · harveyHue -------------------------------------------- */
    {
      name       : 'harveyHue',
      description: 'Perceptually even hue warp.',
      parameters : { h: z.number().min(0).max(360).describe('Hue (°).') },
      async execute({ h }) {
        return asResult(harveyHue(h));
      },
    },

    /* 6 · utils ------------------------------------------------- */
    {
      name       : 'utils',
      description: 'Expose RampenSau utility helpers.',
      parameters : {
        fn   : z.enum([
          'shuffle', 'lerp', 'scaleSpread', 'curvePoint', 'curveEasings',
        ]).describe('Utility name.'),
        args : z.array(z.any()).optional()
                 .describe('Arguments for fn.'),
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
