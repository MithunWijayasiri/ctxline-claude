import type { ThemeBackdropGlass, ThemeColors } from 'claude-code'

import { makeColors } from './make-colors.js'

// The styles, in the order /ctxtheme lists them. Each one is a palette for
// both modes (makeColors turns a few anchors and role seeds into the app's ~100
// colors) plus a backdrop scene of the same id (scenes.ts).

export const STYLE_IDS = ['ember', 'contour', 'phoenix', 'dusk', 'mosaic', 'keys'] as const
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
  ember: look('Ember', 'warm charcoal, glowing coals along the bottom', { blur: 20, opacity: 0.6 }, {
    label: 'ctxline Ember',
    id: 'ctxline-ember',
    codeTheme: { dark: 'gruvbox-dark-medium', light: 'gruvbox-light-medium' },
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
          'text-muted': '#736357',
        },
      },
      roles: { accent: '#c4643f', danger: '#c2412f', success: '#5d7d2c', warning: '#a8700f', pro: '#8a55a8' },
      git: { added: '#5d7d2c', removed: '#c2412f' },
    },
  }),

  contour: look('Contour', 'blue-slate night, orange map lines', { blur: 12, opacity: 0.55 }, {
    label: 'ctxline Contour',
    id: 'ctxline-contour',
    codeTheme: { dark: 'nord', light: 'github-light' },
    roles: { accent: '#7fa6d9', danger: '#ef6461', success: '#62bb8e', warning: '#e6b553', pro: '#c493d8' },
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
      roles: { accent: '#3f6aa8', danger: '#c53d3b', success: '#2f8a5f', warning: '#a4740e', pro: '#8a55a8' },
      git: { added: '#2f8a5f', removed: '#c53d3b' },
    },
  }),

  phoenix: look('Phoenix', 'warm black, a large gold black hole with a striped disk', { blur: 16, opacity: 0.6 }, {
    label: 'ctxline Phoenix',
    id: 'ctxline-phoenix',
    codeTheme: { dark: 'vitesse-dark', light: 'vitesse-light' },
    // Gold, to match the black hole.
    roles: { accent: '#e8b05a', danger: '#f06a5b', success: '#8fca8a', warning: '#e9c46a', pro: '#c9a0f0' },
    dark: {
      gray: {
        anchors: {
          'surface-0': '#0c0a08',
          'surface-1': '#141110',
          'surface-2': '#1b1714',
          'surface-3': '#221d19',
          'text-primary': '#f7f1e8',
          'text-secondary': '#cdc3b5',
          'text-muted': '#9f9484',
        },
      },
      git: { added: '#8fca8a', removed: '#f06a5b' },
    },
    light: {
      gray: {
        anchors: {
          'surface-0': '#ece6dc',
          'surface-1': '#f4efe8',
          'surface-2': '#fbf9f5',
          'surface-3': '#fbf9f5',
          'text-primary': '#17130e',
          'text-secondary': '#4a4238',
          'text-muted': '#6e6457',
        },
      },
      roles: { accent: '#a8701c', danger: '#c4402f', success: '#3d8546', warning: '#8f6a00', pro: '#7f52c0' },
      git: { added: '#3d8546', removed: '#c4402f' },
    },
  }),

  dusk: look('Dusk', 'deep plum, violet and orange dusk over mountains and a still lake', { blur: 20, opacity: 0.55 }, {
    label: 'ctxline Dusk',
    id: 'ctxline-dusk',
    codeTheme: { dark: 'rose-pine', light: 'rose-pine-dawn' },
    roles: { accent: '#a98bf0', danger: '#ec5f6a', success: '#7cc2a0', warning: '#e8b45a', pro: '#e08fb8' },
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
      roles: { accent: '#7650b8', danger: '#c23d4c', success: '#2f8768', warning: '#a26f12', pro: '#a8467a' },
      git: { added: '#2f8768', removed: '#c23d4c' },
    },
  }),

  mosaic: look('Mosaic', 'indigo, pixel tiles evenly across the screen', { blur: 16, opacity: 0.55 }, {
    label: 'ctxline Mosaic',
    id: 'ctxline-mosaic',
    codeTheme: { dark: 'tokyo-night', light: 'github-light' },
    roles: { accent: '#a093ff', danger: '#ec5f6a', success: '#7cc2a0', warning: '#e8b45a', pro: '#e08fb8' },
    dark: {
      gray: {
        anchors: {
          'surface-0': '#100f1c',
          'surface-1': '#161526',
          'surface-2': '#1c1b30',
          'surface-3': '#23223a',
          'text-primary': '#ecebf7',
          'text-secondary': '#c0bfd9',
          'text-muted': '#9392b0',
        },
      },
      git: { added: '#7cc2a0', removed: '#ec5f6a' },
    },
    light: {
      gray: {
        anchors: {
          'surface-0': '#e8e7f2',
          'surface-1': '#efeef6',
          'surface-2': '#f8f8fc',
          'surface-3': '#f8f8fc',
          'text-primary': '#1a1930',
          'text-secondary': '#45445f',
          'text-muted': '#64637f',
        },
      },
      roles: { accent: '#5847c8', danger: '#c23d4c', success: '#2f8768', warning: '#a26f12', pro: '#a8467a' },
      git: { added: '#2f8768', removed: '#c23d4c' },
    },
  }),

  keys: look('Keys', 'blue-black, tilted keyboards in outline across the screen', { blur: 16, opacity: 0.55 }, {
    label: 'ctxline Keys',
    id: 'ctxline-keys',
    codeTheme: { dark: 'github-dark-dimmed', light: 'github-light' },
    roles: { accent: '#5b9cff', danger: '#ef6461', success: '#6fc39a', warning: '#e6b553', pro: '#c493d8' },
    dark: {
      gray: {
        anchors: {
          'surface-0': '#0a0c12',
          'surface-1': '#10131a',
          'surface-2': '#161a22',
          'surface-3': '#1c212b',
          'text-primary': '#e9ecf2',
          'text-secondary': '#b9bfcc',
          'text-muted': '#8b92a1',
        },
      },
      git: { added: '#6fc39a', removed: '#ef6461' },
    },
    light: {
      gray: {
        anchors: {
          'surface-0': '#e6e9ee',
          'surface-1': '#eef0f4',
          'surface-2': '#f8f9fb',
          'surface-3': '#f8f9fb',
          'text-primary': '#13161d',
          'text-secondary': '#3c424e',
          'text-muted': '#5d6370',
        },
      },
      roles: { accent: '#2a5fc0', danger: '#c53d3b', success: '#2a8560', warning: '#9a6d0b', pro: '#8a55a8' },
      git: { added: '#2a8560', removed: '#c53d3b' },
    },
  }),
}

export function isStyleId(value: unknown): value is StyleId {
  return typeof value === 'string' && (STYLE_IDS as readonly string[]).includes(value)
}
