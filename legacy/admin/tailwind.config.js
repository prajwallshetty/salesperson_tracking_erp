/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#F5F7F8',
        sidebar: {
          DEFAULT: '#E8EDEF',
          hover: '#DFE5E8',
          border: '#D8DFE4',
          active: '#FFFFFF',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F3F5F6',
          inset: '#F3F5F6',
        },
        border: {
          DEFAULT: '#CBD2D7',
          subtle: '#E2E7EC',
          strong: '#A9B5BE',
        },
        ink: {
          primary: '#0B1320',
          secondary: '#586570',
          muted: '#80909D',
        },
        primary: {
          DEFAULT: '#081224',
          hover: '#111F36',
          foreground: '#FFFFFF',
        },
        lime: {
          accent: '#B4E39C',
          soft: '#E6F4DD',
          dark: '#2E6819',
        },
        badge: {
          muted: '#CFDDE5',
          'muted-text': '#2C4656',
        },
        link: {
          DEFAULT: '#259DC3',
          hover: '#1B81A2',
        },
      },
      borderRadius: {
        'panel': '12px',
        'card': '10px',
        'btn': '8px',
      },
      boxShadow: {
        'subtle': '0 1px 2px 0 rgba(0, 0, 0, 0.02)',
        'panel': '0 1px 3px 0 rgba(11, 19, 32, 0.03)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
