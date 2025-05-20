/* rampensau.mcp.js – clearer API
   ------------------------------------------------------------------ */
import { nanoid }              from 'nanoid';
import { z }                   from 'zod';
import {
  generateColorRamp,
  generateColorRampWithCurve,
  colorUtils,
  utils,
}                              from 'rampensau';

const { colorToCSS, harveyHue, colorHarmonies, uniqueRandomHues } = colorUtils;
const { shuffleArray, lerp, scaleSpreadArray, pointOnCurve, makeCurveEasings } = utils;

/* ───────── helpers ─────────────────────────────────────────────── */
const asResult = (data) => ({
  content: [{ type: 'text', text: typeof data === 'string'
    ? data
    : JSON.stringify(data, null, 2) }],
});

/* Accept 0–1 **or** 0–100, return 0–1 ---------------------------- */
const norm01 = z.number()
  .refine(v => v >= 0 && v <= 100,
          'value must be between 0 and 100')
  .transform(v => v > 1 ? v / 100 : v);

const RangeTuple = z
  .tuple([norm01, norm01])
  .describe('Two numbers (0–1 or 0–100) → min/max');

/* ───────── shared option shapes ────────────────────────────────── */
const RampBase = {
  total       : z.number().int().min(3)
                 .describe('How many swatches in the ramp.')
                 .default(10),
  hStart      : z.number().min(0).max(360)
                 .describe('Starting hue in degrees. Optional.').optional(),
  hStartCenter: norm01.optional()
                 .describe('Randomise first hue ±this fraction of 360°'),
  hCycles     : z.number().min(1).describe('Number of hue wraps.').default(1).optional(),
  hueList     : z.array(z.number().min(0).max(360))
                 .describe('Explicit list of hues instead of algorithm.').optional(),
  sRange      : RangeTuple.optional()
                 .describe('Saturation range. Example: [0.7, 1] or [70, 100].'),
  lRange      : RangeTuple.optional()
                 .describe('Lightness range. Example: [0.2, 0.4] or [20, 40].'),
};

const CurveExtra = {
  curveMethod : z.enum(['lamé', 'sine', 'power', 'linear'])
                 .describe('Curve algorithm for HSL easing.').optional(),
  curveAccent : z.number().min(0).max(5)
                 .describe('Accent strength for curveMethod.').optional(),
};

const FormatOpt = {
  format: z.enum(['array', 'css-hsl', 'css-oklch'])
           .describe('Return raw array or CSS strings.')
           .default('array')
           .optional(),
};

/* ───────── spec ────────────────────────────────────────────────── */
export const rampensauSpec = {
  id         : 'rampensau',
  instanceId : nanoid(),
  description: 'Colour-ramp generation & helpers from RampenSau.',

  tools: [
    /* 1 · palette generation ------------------------------------- */
    {
      name       : 'generate',
      description: 'Generate a colour ramp / palette.',
      parameters : { ...RampBase, ...CurveExtra, ...FormatOpt },
      examples   : [
        { total: 8, hStart: 220, sRange: [70, 100], lRange: [20, 40] },
        { total: 5, hCycles: 2, curveMethod: 'sine', format: 'css-hsl' },
      ],
      async execute (raw) {
        /* Parse → normalise -------------------------------------- */
        const {
          format = 'array',
          curveMethod,
          ...opts
        } = z.object(this.parameters).parse(raw);

        const ramp = curveMethod
          ? generateColorRampWithCurve({ ...opts, curveMethod })
          : generateColorRamp(opts);

        const out =
          format === 'array'
            ? ramp
            : ramp.map(c => colorToCSS(c, format === 'css-hsl' ? 'hsl' : 'oklch'));

        return asResult(out);
      },
    },

    /* 2 · unique random hues ------------------------------------- */
    {
      name       : 'uniqueRandomHues',
      description: 'Generate an array of unique random hues.',
      parameters : {
        startHue        : z.number().min(0).max(360)
                           .describe('Hue to start near.').optional(),
        total           : z.number().int().min(1)
                           .describe('How many hues.').default(5).optional(),
        minHueDiffAngle : z.number().min(0).max(360)
                           .describe('Minimum separation between hues.').optional(),
      },
      async execute (args) {
        const opts = z.object(this.parameters).parse(args);
        return asResult(uniqueRandomHues(opts));
      },
    },

    /* 3 · colour harmony hues ------------------------------------ */
    {
      name       : 'colorHarmony',
      description: 'Return hues based on harmony theory.',
      parameters : {
        method : z.enum([
          'complementary', 'splitComplementary', 'triadic',
          'tetradic', 'monochromatic', 'doubleComplementary',
          'compound', 'analogous',
        ]).describe('Harmony method.'),
        baseHue: z.number().min(0).max(360).describe('Base hue in degrees.'),
      },
      async execute ({ method, baseHue }) {
        return asResult(colorHarmonies[method](baseHue));
      },
    },

    /* 4 · color → CSS string ------------------------------------- */
    {
      name       : 'toCSS',
      description: 'Convert a RampenSau colour to CSS string.',
      parameters : {
        color: z.array(z.number()).length(3).describe('[h, s, l] array'),
        mode : z.enum(['hsl', 'hsv', 'lch', 'oklch'])
                 .describe('CSS colour space.').default('oklch').optional(),
      },
      async execute ({ color, mode }) {
        return asResult(colorToCSS(color, mode));
      },
    },

    /* 5 · Harvey hue transform ----------------------------------- */
    {
      name       : 'harveyHue',
      description: 'Transform hue for perceptual evenness.',
      parameters : { h: z.number().min(0).max(360).describe('Hue in degrees.') },
      async execute ({ h }) {
        return asResult(harveyHue(h));
      },
    },

    /* 6 · assorted utilities ------------------------------------- */
    {
      name       : 'utils',
      description: 'Access RampenSau array/curve utilities.',
      parameters : {
        fn   : z.enum([
          'shuffle', 'lerp', 'scaleSpread', 'curvePoint', 'curveEasings',
        ]).describe('Utility function to run.'),
        args : z.array(z.any()).optional()
                 .describe('Positional arguments for chosen fn.'),
      },
      async execute ({ fn, args = [] }) {
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
