'use strict';

// Fixed outlets and menu for tests (independent of the real data in src/seed.js,
// which will change as the business grows). Localities are shared.
const real = require('../../src/seed');
const menu = require('./menu');

const outlets = [
  { slug: 'sec-17-chd', upiId: 'rc-sec-17-chd@example', waPaymentConfig: 'rc-sec-17-chd', name: 'Raju Chinese - Sector 17', city: 'Chandigarh', address: 'SCO 00, Sector 17-C, Chandigarh', lat: 30.7410, lng: 76.7790, phone: '+910000000001', radiusKm: 20, opens: '11:00', closes: '23:00' },
  { slug: 'sec-35-chd', upiId: 'rc-sec-35-chd@example', waPaymentConfig: 'rc-sec-35-chd', name: 'Raju Chinese - Sector 35', city: 'Chandigarh', address: 'SCO 00, Sector 35-C, Chandigarh', lat: 30.7225, lng: 76.7570, phone: '+910000000002', radiusKm: 20, opens: '11:00', closes: '23:00' },
  { slug: 'manimajra', upiId: 'rc-manimajra@example', waPaymentConfig: 'rc-manimajra', name: 'Raju Chinese - Manimajra', city: 'Chandigarh', address: 'Main Market, Manimajra, Chandigarh', lat: 30.7290, lng: 76.8380, phone: '+910000000003', radiusKm: 20, opens: '11:00', closes: '23:00' },
  { slug: 'phase-7-mohali', upiId: 'rc-phase-7-mohali@example', waPaymentConfig: 'rc-phase-7-mohali', name: 'Raju Chinese - Phase 7 Mohali', city: 'Mohali', address: 'SCO 00, Phase 7, SAS Nagar, Mohali', lat: 30.7085, lng: 76.7195, phone: '+910000000004', radiusKm: 20, opens: '11:00', closes: '23:00' },
  { slug: 'kharar', upiId: 'rc-kharar@example', waPaymentConfig: 'rc-kharar', name: 'Raju Chinese - Kharar', city: 'Kharar', address: 'Landran Road, Kharar', lat: 30.7460, lng: 76.6450, phone: '+910000000005', radiusKm: 20, opens: '11:00', closes: '23:00' },
  { slug: 'zirakpur', upiId: 'rc-zirakpur@example', waPaymentConfig: 'rc-zirakpur', name: 'Raju Chinese - Zirakpur', city: 'Zirakpur', address: 'VIP Road, Zirakpur', lat: 30.6420, lng: 76.8170, phone: '+910000000006', radiusKm: 20, opens: '11:00', closes: '23:00' },
  { slug: 'sec-11-pkl', upiId: 'rc-sec-11-pkl@example', waPaymentConfig: 'rc-sec-11-pkl', name: 'Raju Chinese - Sector 11 Panchkula', city: 'Panchkula', address: 'SCO 00, Sector 11, Panchkula', lat: 30.6960, lng: 76.8480, phone: '+910000000007', radiusKm: 20, opens: '11:00', closes: '23:00' },
];

module.exports = { ...real, outlets, menu };
