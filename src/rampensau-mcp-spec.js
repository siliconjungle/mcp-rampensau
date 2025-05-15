/* rampensau.mcp.js
   ────────────────────────────────────────────────────────────────────
   MCP wrapper for *all* public RampenSau helpers – no TypeScript,
   pure ESM JavaScript.  Drop into your registry and restart.
   ───────────────────────────────────────────────────────────────── */

import { nanoid }              from 'nanoid';
import { z }                   from 'zod';

import {
  generateColorRamp,
  generateColorRampWithCurve,
  uniqueRandomHues,
}                              from 'rampensau';

import { colorHarmonies }      from 'rampensau/hueGeneration';
import {
  colorToCSS,
  harveyHue,
}                              from 'rampensau/colorUtils';

import {
  shuffleArray,
  lerp,
  scaleSpreadArray,
  pointOnCurve,
  makeCurveEasings,
}                              from 'rampensau/utils';

/* ───────── helpers ─────────────────────────────────────────────── */
const asResult = (data) => ({
  content: [
    {
      type: 'text',
      text: typeof data === 'string'
        ? data
        : JSON.stringify(data, null, 2),
    },
  ],
});
const RangeTuple = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

/* ───────── shared option shapes ────────────────────────────────── */
const RampBase = {
  total       : z.number().int().min(3).optional(),
  hStart      : z.number().min(0).max(360).optional(),
  hStartCenter: z.number().min(0).max(1).optional(),
  hCycles     : z.number().optional(),
  hueList     : z.array(z.number().min(0).max(360)).optional(),
  sRange      : RangeTuple.optional(),
  lRange      : RangeTuple.optional(),
  hEasing     : z.any().optional(),
  sEasing     : z.any().optional(),
  lEasing     : z.any().optional(),
  transformFn : z.any().optional(),
};

const CurveExtra = {
  curveMethod : z.enum(['lamé', 'sine', 'power', 'linear']).optional(),
  curveAccent : z.number().min(0).max(5).optional(),
};

const FormatOpt = {
  format: z.enum(['array', 'css-hsl', 'css-oklch']).optional(),
};

/* ───────── spec ────────────────────────────────────────────────── */
export const rampensauSpec = {
  id         : 'rampensau',
  instanceId : nanoid(),
  description: 'Colour-palette and helper utilities from RampenSau.',

  tools: [
    /* 1 · palette generation ------------------------------------- */
    {
      name       : 'generate',
      description: 'Generate a colour ramp / palette.',
      parameters : { ...RampBase, ...CurveExtra, ...FormatOpt },
      async execute (raw) {
        const {
          format = 'array',
          curveMethod,
          ...opts
        } = z.object({ ...RampBase, ...CurveExtra, ...FormatOpt }).parse(raw);

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

    /* 2 · unique random hues ------------------------------------- */
    {
      name       : 'uniqueRandomHues',
      description: 'Generate an array of unique random hues.',
      parameters : {
        startHue        : z.number().min(0).max(360).optional(),
        total           : z.number().int().min(1).optional(),
        minHueDiffAngle : z.number().min(0).max(360).optional(),
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
          'complementary',
          'splitComplementary',
          'triadic',
          'tetradic',
          'monochromatic',
          'doubleComplementary',
          'compound',
          'analogous',
        ]),
        baseHue: z.number().min(0).max(360),
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
        color: z.array(z.number()).length(3),
        mode : z.enum(['hsl', 'hsv', 'lch', 'oklch']).optional(),
      },
      async execute ({ color, mode = 'oklch' }) {
        return asResult(colorToCSS(color, mode));
      },
    },

    /* 5 · Harvey hue transform ----------------------------------- */
    {
      name       : 'harveyHue',
      description: 'Transform hue for perceptual evenness.',
      parameters : { h: z.number().min(0).max(360) },
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
          'shuffle',
          'lerp',
          'scaleSpread',
          'curvePoint',
          'curveEasings',
        ]),
        args : z.array(z.any()).optional(),
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
