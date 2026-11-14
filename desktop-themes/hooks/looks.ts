import type { ThemeBackdropGlass, ThemeColors } from 'claude-code'

import { makeColors } from './make-colors.js'

// The four styles, in the order /ctxtheme lists them. Each one is a palette for
// both modes (makeColors turns a few anchors and role seeds into the app's ~100
// colors) plus an animated backdrop scene of the same id (scenes.ts).

export const STYLE_IDS = ['ember', 'contour', 'corona', 'dusk'] as const
export type StyleId = (typeof STYLE_IDS)[number]

export const DEFAULT_STYLE: StyleId = 'dusk'

export type Look = {
  name: string
  blurb: string
  colors: ThemeColors
  problems: string[]
  glass: ThemeBackdropGlass
}

function look(
  name: string,
  blurb: string,
  glass: ThemeBackdropGlass,
  definition: Parameters<typeof makeColors>[0],
): Look {
  const { theme, problems } = makeColors(definition)

  return { name, blurb, colors: theme, problems, glass }
}

export const LOOKS: Record<StyleId, Look> = {
  ember: look('Ember', 'warm charcoal, breathing coals and pulsing cracks of heat', { blur: 20, opacity: 0.6 }, {
    label: 'ctxline Ember',
    id: 'ctxline-ember',
    roles: { accent: '#d97757', danger: '#e5574b', success: '#9bb563', warning: '#e3a73f', pro: '#c493d8' },
    dark: {
      gray: {
        anchors: {
          'surface-0': '#17120f',
          'surface-1': '#1e1814',
          'surface-2': '#261e19',
          'surface-3': '#2d241e',
          'text-primary': '#f3e9df',
          'text-secondary': '#cfc1b3',
          'text-muted': '#a69686',
        },
      },
      git: { added: '#9bb563', removed: '#e5574b' },
    },
    light: {
      gray: {
        anchors: {
          'surface-0': '#efe5da',
          'surface-1': '#f5ede4',
          'surface-2': '#fbf6f0',
          'surface-3': '#fbf6f0',
          'text-primary': '#2b1f18',
          'text-secondary': '#5a4a3e',
          'text-muted': '#76665a',
        },
      },
      roles: { accent: '#c4643f', danger: '#c2412f', success: '#5d7d2c', warning: '#a8700f', pro: '#8a55a8' },
      git: { added: '#5d7d2c', removed: '#c2412f' },
    },
  }),

  contour: look('Contour', 'blue-slate night, drifting orange map lines that glow and fade', { blur: 12, opacity: 0.55 }, {
    label: 'ctxline Contour',
    id: 'ctxline-contour',
    roles: { accent: '#d97757', danger: '#ef6461', success: '#62bb8e', warning: '#e6b553', pro: '#93a2f2' },
    dark: {
      gray: {
        anchors: {
          'surface-0': '#0f1318',
          'surface-1': '#151a21',
          'surface-2': '#1b222b',
          'surface-3': '#222a35',
          'text-primary': '#e8edf3',
          'text-secondary': '#b9c2cd',
          'text-muted': '#8f9aa7',
        },
      },
      git: { added: '#62bb8e', removed: '#ef6461' },
    },
    light: {
      gray: {
        anchors: {
          'surface-0': '#e6eaee',
          'surface-1': '#eef1f4',
          'surface-2': '#f7f9fa',
          'surface-3': '#f7f9fa',
          'text-primary': '#17202a',
          'text-secondary': '#3e4a57',
          'text-muted': '#5e6a77',
        },
      },
      roles: { accent: '#c4643f', danger: '#c53d3b', success: '#2f8a5f', warning: '#a4740e', pro: '#5464c9' },
      git: { added: '#2f8a5f', removed: '#c53d3b' },
    },
  }),

  corona: look('Corona', 'near-black, an eclipse with turning flares, twinkling stars', { blur: 16, opacity: 0.6 }, {
    label: 'ctxline Corona',
    id: 'ctxline-corona',
    roles: { accent: '#e8845f', danger: '#f2665b', success: '#7fc78c', warning: '#f0b64b', pro: '#c99df2' },
    dark: {
      gray: {
        anchors: {
          'surface-0': '#0b0a0a',
          'surface-1': '#131211',
          'surface-2': '#1a1817',
          'surface-3': '#211e1c',
          'text-primary': '#f6f2ee',
          'text-secondary': '#cbc4bd',
          'text-muted': '#9c948c',
        },
      },
      git: { added: '#7fc78c', removed: '#f2665b' },
    },
    light: {
      gray: {
        anchors: {
          'surface-0': '#ebe8e5',
          'surface-1': '#f3f1ef',
          'surface-2': '#fbfaf9',
          'surface-3': '#fbfaf9',
          'text-primary': '#141210',
          'text-secondary': '#45403b',
          'text-muted': '#6b645d',
        },
      },
      roles: { accent: '#d2693f', danger: '#c93f35', success: '#3f8a4c', warning: '#a8730d', pro: '#8452c4' },
      git: { added: '#3f8a4c', removed: '#c93f35' },
    },
  }),

  dusk: look('Dusk', 'deep plum, orange and violet ribbons over dusk hills', { blur: 20, opacity: 0.55 }, {
    label: 'ctxline Dusk',
    id: 'ctxline-dusk',
    roles: { accent: '#e07f5a', danger: '#ec5f6a', success: '#7cc2a0', warning: '#e8b45a', pro: '#b896f0' },
    dark: {
      gray: {
        anchors: {
          'surface-0': '#141019',
          'surface-1': '#1a1520',
          'surface-2': '#211a28',
          'surface-3': '#282030',
          'text-primary': '#f1ebf5',
          'text-secondary': '#c8bdd1',
          'text-muted': '#9d91a8',
        },
      },
      git: { added: '#7cc2a0', removed: '#ec5f6a' },
    },
    light: {
      gray: {
        anchors: {
          'surface-0': '#ebe5ee',
          'surface-1': '#f2edf4',
          'surface-2': '#faf7fb',
          'surface-3': '#faf7fb',
          'text-primary': '#221a29',
          'text-secondary': '#4d4257',
          'text-muted': '#6c6177',
        },
      },
      roles: { accent: '#c8603c', danger: '#c23d4c', success: '#2f8768', warning: '#a26f12', pro: '#7650b8' },
      git: { added: '#2f8768', removed: '#c23d4c' },
    },
  }),
}

export function isStyleId(value: unknown): value is StyleId {
  return typeof value === 'string' && (STYLE_IDS as readonly string[]).includes(value)
}
