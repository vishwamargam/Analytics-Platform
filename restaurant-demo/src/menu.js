export const MENU_ITEMS = [
  {
    id: 'margherita',
    name: 'Margherita',
    description: 'San Marzano tomato, fresh mozzarella, basil, and a little olive oil.',
    priceMinor: 1299,
    category: 'Wood-fired pizza',
    emoji: '🍅'
  },
  {
    id: 'veggie',
    name: 'Roasted Veggie',
    description: 'Seasonal vegetables, whipped ricotta, herbs, and lemon.',
    priceMinor: 1499,
    category: 'Wood-fired pizza',
    emoji: '🥬'
  },
  {
    id: 'lemonade',
    name: 'Fresh Lemonade',
    description: 'House-squeezed lemons, cane sugar, and fresh mint.',
    priceMinor: 399,
    category: 'Something to sip',
    emoji: '🍋'
  }
];

export function formatPrice(minorUnits, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minorUnits / 100);
}
