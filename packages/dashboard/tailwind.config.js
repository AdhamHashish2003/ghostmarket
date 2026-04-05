/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ghost: {
          bg: '#0a0a0a',
          card: '#27272a',
          border: '#3f3f46',
        },
      },
    },
  },
  plugins: [],
};
