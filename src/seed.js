'use strict';

// Starter data.
//
// Outlets: the 7 Raju Chinese Food outlets found in public listings (Zomato,
// Justdial, magicpin, Shoutlo, Mappls; Oct 2026). Sector 15, 34, 46, Phase 3B2
// and VIP Road Zirakpur are confirmed by several sources; Khuda Lahora (PGI) and
// Peer Muchalla by fewer, and Peer Muchalla's map point is estimated. Confirm
// addresses, map pins, phone numbers and hours with each outlet before launch.
//
// Still PLACEHOLDERS: menu prices, UPI IDs ("@example" is deliberately invalid
// so no test payment can reach a real account) and WhatsApp payment
// configuration names.

const outlets = [
  { slug: 'sec-15-chd', upiId: 'rc-sec-15-chd@example', waPaymentConfig: 'rc-sec-15-chd', name: 'Raju Chinese - Sector 15', city: 'Chandigarh', address: 'Booth 225, Patel Market, Sector 15-D, Chandigarh 160015', lat: 30.75266, lng: 76.77114, phone: '+917696295218', radiusKm: 20, opens: '11:00', closes: '22:00' },
  { slug: 'sec-34-chd', upiId: 'rc-sec-34-chd@example', waPaymentConfig: 'rc-sec-34-chd', name: 'Raju Chinese - Sector 34', city: 'Chandigarh', address: 'Himalaya Marg, Sector 34-C, Chandigarh', lat: 30.71998, lng: 76.76560, phone: '+919041234440', radiusKm: 20, opens: '11:00', closes: '23:00' },
  { slug: 'sec-46-chd', upiId: 'rc-sec-46-chd@example', waPaymentConfig: 'rc-sec-46-chd', name: 'Raju Chinese - Sector 46', city: 'Chandigarh', address: 'Booth 43, Sector 46-C, Chandigarh', lat: 30.70053, lng: 76.76582, phone: '+918557880159', radiusKm: 20, opens: '12:00', closes: '23:00' },
  { slug: 'phase-3b2-mohali', upiId: 'rc-phase-3b2-mohali@example', waPaymentConfig: 'rc-phase-3b2-mohali', name: 'Raju Chinese - Phase 3B2 Mohali', city: 'Mohali', address: 'Booth 15, Sector 60 (Phase 3B2), near Mohali Stadium Road, SAS Nagar', lat: 30.71221, lng: 76.71924, phone: '+917710767710', radiusKm: 20, opens: '11:00', closes: '23:00' },
  { slug: 'vip-road-zirakpur', upiId: 'rc-vip-road-zirakpur@example', waPaymentConfig: 'rc-vip-road-zirakpur', name: 'Raju Chinese - VIP Road Zirakpur', city: 'Zirakpur', address: 'Amcare Plaza, VIP Road, Zirakpur 140603', lat: 30.63884, lng: 76.81542, phone: '+919779020477', radiusKm: 20, opens: '11:00', closes: '22:00' },
  { slug: 'khuda-lahora', upiId: 'rc-khuda-lahora@example', waPaymentConfig: 'rc-khuda-lahora', name: 'Raju Chinese - Khuda Lahora (PGI)', city: 'Chandigarh', address: 'Shop 149, Khuda Lahora, near PGI, Chandigarh 160014', lat: 30.77347, lng: 76.77089, phone: '+919876767891', radiusKm: 20, opens: '11:00', closes: '23:00' },
  { slug: 'peer-muchalla', upiId: 'rc-peer-muchalla@example', waPaymentConfig: 'rc-peer-muchalla', name: 'Raju Chinese - Peer Muchalla', city: 'Zirakpur', address: 'SCO 5, near Dargah, Peer Muchalla', lat: 30.665, lng: 76.835, phone: '+919780292999', radiusKm: 20, opens: '11:00', closes: '23:00' },
];

// Prices in rupees. Keep every category at 10 items or fewer: WhatsApp list
// messages show at most 10 rows.
const menu = [
  { category: 'Soups', name: 'Veg Manchow Soup', price: 89, veg: true },
  { category: 'Soups', name: 'Veg Hot & Sour Soup', price: 89, veg: true },
  { category: 'Soups', name: 'Sweet Corn Soup', price: 89, veg: true },
  { category: 'Soups', name: 'Chicken Manchow Soup', price: 109, veg: false },
  { category: 'Soups', name: 'Chicken Hot & Sour Soup', price: 109, veg: false },

  { category: 'Momos', name: 'Veg Steam Momos (8 pcs)', price: 79, veg: true },
  { category: 'Momos', name: 'Veg Fried Momos (8 pcs)', price: 99, veg: true },
  { category: 'Momos', name: 'Paneer Momos (8 pcs)', price: 119, veg: true },
  { category: 'Momos', name: 'Chicken Steam Momos (8 pcs)', price: 109, veg: false },
  { category: 'Momos', name: 'Chicken Fried Momos (8 pcs)', price: 129, veg: false },
  { category: 'Momos', name: 'Kurkure Momos (8 pcs)', price: 139, veg: true },

  { category: 'Starters', name: 'Veg Spring Roll', price: 109, veg: true },
  { category: 'Starters', name: 'Honey Chilli Potato', price: 139, veg: true },
  { category: 'Starters', name: 'Chilli Paneer Dry', price: 179, veg: true },
  { category: 'Starters', name: 'Crispy Corn', price: 149, veg: true },
  { category: 'Starters', name: 'Chilli Chicken Dry', price: 199, veg: false },
  { category: 'Starters', name: 'Chicken Lollipop (6 pcs)', price: 219, veg: false },

  { category: 'Noodles', name: 'Veg Hakka Noodles', price: 119, veg: true },
  { category: 'Noodles', name: 'Chilli Garlic Noodles', price: 129, veg: true },
  { category: 'Noodles', name: 'Schezwan Noodles', price: 129, veg: true },
  { category: 'Noodles', name: 'Egg Hakka Noodles', price: 139, veg: false },
  { category: 'Noodles', name: 'Chicken Hakka Noodles', price: 159, veg: false },

  { category: 'Rice', name: 'Veg Fried Rice', price: 119, veg: true },
  { category: 'Rice', name: 'Schezwan Fried Rice', price: 129, veg: true },
  { category: 'Rice', name: 'Egg Fried Rice', price: 139, veg: false },
  { category: 'Rice', name: 'Chicken Fried Rice', price: 159, veg: false },

  { category: 'Main Course', name: 'Veg Manchurian Gravy', price: 149, veg: true },
  { category: 'Main Course', name: 'Chilli Paneer Gravy', price: 189, veg: true },
  { category: 'Main Course', name: 'Chilli Chicken Gravy', price: 209, veg: false },

  { category: 'Combos', name: 'Noodles + Manchurian Combo', price: 179, veg: true, description: 'Hakka noodles with veg manchurian gravy' },
  { category: 'Combos', name: 'Fried Rice + Chilli Paneer Combo', price: 219, veg: true, description: 'Veg fried rice with chilli paneer gravy' },
  { category: 'Combos', name: 'Fried Rice + Chilli Chicken Combo', price: 239, veg: false, description: 'Chicken fried rice with chilli chicken gravy' },

  { category: 'Beverages', name: 'Coke (300 ml)', price: 40, veg: true },
  { category: 'Beverages', name: 'Masala Lemonade', price: 59, veg: true },
];

// Approximate locality centroids: for picking an area in the web app and for
// placing typed WhatsApp addresses (src/geocode.js). Add more areas freely.
const localities = [
  ['Sector 8', 'Chandigarh', 30.7410, 76.8010], ['Sector 9', 'Chandigarh', 30.7480, 76.7930],
  ['Sector 15', 'Chandigarh', 30.7520, 76.7680], ['Sector 17', 'Chandigarh', 30.7410, 76.7790],
  ['Sector 22', 'Chandigarh', 30.7330, 76.7720], ['Sector 26', 'Chandigarh', 30.7300, 76.8070],
  ['Sector 32', 'Chandigarh', 30.7150, 76.7780], ['Sector 35', 'Chandigarh', 30.7225, 76.7570],
  ['Sector 43', 'Chandigarh', 30.7180, 76.7400], ['Sector 44', 'Chandigarh', 30.7080, 76.7550],
  ['Industrial Area Phase 1', 'Chandigarh', 30.7050, 76.8000], ['Manimajra', 'Chandigarh', 30.7290, 76.8380],
  ['Phase 3B2', 'Mohali', 30.7230, 76.7120], ['Phase 5', 'Mohali', 30.7140, 76.7200],
  ['Phase 7', 'Mohali', 30.7085, 76.7195], ['Phase 10', 'Mohali', 30.6930, 76.7310],
  ['Sector 70', 'Mohali', 30.6990, 76.7140], ['Sector 82 (IT City)', 'Mohali', 30.6680, 76.7180],
  ['Kharar', 'Kharar', 30.7460, 76.6450], ['Landran', 'Kharar', 30.7020, 76.6630],
  ['Zirakpur VIP Road', 'Zirakpur', 30.6420, 76.8170], ['Dhakoli', 'Zirakpur', 30.6560, 76.8420],
  ['Sector 5', 'Panchkula', 30.6940, 76.8600], ['Sector 11', 'Panchkula', 30.6960, 76.8480],
  ['Sector 20', 'Panchkula', 30.6710, 76.8410], ['Sector 26', 'Panchkula', 30.6870, 76.8800],
  ['Mansa Devi', 'Panchkula', 30.7310, 76.8610], ['Chandimandir', 'Panchkula', 30.7220, 76.8850],
  ['Peer Muchalla', 'Zirakpur', 30.6720, 76.8450], ['Bhabat', 'Zirakpur', 30.6400, 76.8250],
  ['Aerocity', 'Mohali', 30.6630, 76.7330], ['Sohana', 'Mohali', 30.6830, 76.7000], ['TDI City', 'Mohali', 30.6480, 76.6900],
  ['Sunny Enclave', 'Kharar', 30.7350, 76.6600], ['New Chandigarh', 'Mullanpur', 30.7870, 76.6950],
  ['PGI', 'Chandigarh', 30.7650, 76.7760], ['IT Park', 'Chandigarh', 30.7270, 76.8450],
  ['Pinjore', 'Pinjore', 30.7970, 76.9170], ['Dera Bassi', 'Dera Bassi', 30.5880, 76.8430],
  ['Kurali', 'Kurali', 30.8360, 76.5740], ['Banur', 'Banur', 30.5560, 76.7160],
].map(([name, city, lat, lng]) => ({ name, city, lat, lng }));

module.exports = { outlets, menu, localities };
