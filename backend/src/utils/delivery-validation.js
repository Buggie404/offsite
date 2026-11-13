// Server-side copy of the checkout delivery rules (frontend checkout.component.ts:
// validateName / validateMobile / validateCity / validateAddress), for addresses customers send
// outside checkout (redelivery confirmation). Keep the two in step.

const VIETNAM_CITIES = [
  'An Giang', 'Ba Ria - Vung Tau', 'Bac Giang', 'Bac Kan', 'Bac Lieu', 'Bac Ninh', 'Ben Tre', 'Binh Dinh', 'Binh Duong',
  'Binh Phuoc', 'Binh Thuan', 'Ca Mau', 'Can Tho', 'Cao Bang', 'Da Nang', 'Dak Lak', 'Dak Nong', 'Dien Bien', 'Dong Nai',
  'Dong Thap', 'Gia Lai', 'Ha Giang', 'Ha Nam', 'Ha Noi', 'Ha Tinh', 'Hai Duong', 'Hai Phong', 'Hau Giang', 'Hoa Binh',
  'Ho Chi Minh', 'Hung Yen', 'Khanh Hoa', 'Kien Giang', 'Kon Tum', 'Lai Chau', 'Lam Dong', 'Lang Son', 'Lao Cai', 'Long An',
  'Nam Dinh', 'Nghe An', 'Ninh Binh', 'Ninh Thuan', 'Phu Tho', 'Phu Yen', 'Quang Binh', 'Quang Nam', 'Quang Ngai',
  'Quang Ninh', 'Quang Tri', 'Soc Trang', 'Son La', 'Tay Ninh', 'Thai Binh', 'Thai Nguyen', 'Thanh Hoa', 'Thua Thien Hue',
  'Tien Giang', 'Tra Vinh', 'Tuyen Quang', 'Vinh Long', 'Vinh Phuc', 'Yen Bai'
];
const INTERNATIONAL_CITIES = [
  'San Francisco', 'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego',
  'Dallas', 'San Jose', 'Austin', 'Jacksonville', 'Seattle', 'Boston', 'Miami', 'Denver', 'London', 'Manchester',
  'Birmingham', 'Leeds', 'Glasgow', 'Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Tokyo', 'Osaka', 'Kyoto', 'Yokohama',
  'Nagoya', 'Singapore', 'Kuala Lumpur', 'Bangkok', 'Jakarta', 'Manila', 'Seoul', 'Busan', 'Incheon', 'Sydney', 'Melbourne',
  'Brisbane', 'Perth', 'Adelaide', 'Toronto', 'Montreal', 'Vancouver', 'Ottawa', 'Berlin', 'Munich', 'Frankfurt', 'Hamburg',
  'Rome', 'Milan', 'Naples', 'Turin', 'Madrid', 'Barcelona', 'Valencia', 'Seville', 'Amsterdam', 'Rotterdam', 'Utrecht',
  'Bangalore', 'Mumbai', 'Delhi', 'Kolkata', 'Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu'
];

const normalize = (str) => String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').trim();
const REAL_CITIES = new Set([
  ...VIETNAM_CITIES.map(normalize), ...INTERNATIONAL_CITIES.map(normalize),
  'hanoi', 'saigon', 'ho chi minh city', 'hcmc', 'hcm'
]);

function validateMobile(value) {
  const val = String(value || '');
  if (!val) return 'Mobile number is required.';
  const normalized = val.replace(/\s+/g, '');
  if (!/^\d+$/.test(normalized)) return 'Mobile number must contain digits and spaces only.';
  if (normalized.length < 10 || normalized.length > 11) return 'Mobile number must be 10 to 11 digits.';
  return null;
}

function validateCity(value) {
  const val = String(value || '').trim();
  if (!val) return 'City is required.';
  if (!REAL_CITIES.has(normalize(val))) return 'City not exists.';
  return null;
}

function validateAddress(value) {
  const val = String(value || '').trim();
  if (!val) return 'Address is required.';
  if (!/^\d+/.test(val)) return 'Address must start with a house number.';
  if (!val.includes(',')) return 'Address must include a comma to separate the street and ward.';
  const parts = val.split(',').map(p => p.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) return 'Address must contain street name and ward name.';
  const streetPart = parts[0].replace(/^\d+[-/a-zA-Z\d]*\s*/, '').trim();
  if (streetPart.length < 2) return 'Street name must be at least 2 characters long.';
  if (parts[1].length < 2) return 'Ward name must be at least 2 characters long.';
  return null;
}

// Redelivery contact + address. Returns { value } (cleaned) or { errors: { field: message } }.
function parseRedeliveryContact({ contact_phone, shipping_address, note } = {}) {
  const address = shipping_address || {};
  const errors = {};
  const phoneError = validateMobile(contact_phone);
  if (phoneError) errors.contact_phone = phoneError;
  if (!String(address.recipient_name || '').trim()) errors.recipient_name = 'Name is required.';
  const cityError = validateCity(address.city);
  if (cityError) errors.city = cityError;
  const addressError = validateAddress(address.address);
  if (addressError) errors.address = addressError;
  if (Object.keys(errors).length) return { errors };

  const phone = String(contact_phone).replace(/\s+/g, '');
  return {
    value: {
      contact_phone: phone,
      shipping_address: {
        recipient_name: String(address.recipient_name).trim().slice(0, 100),
        mobile: phone,
        email: address.email ? String(address.email).trim().slice(0, 200) : null,
        city: String(address.city).trim(),
        address: String(address.address).trim().slice(0, 300),
        note: ''
      },
      note: String(note || '').trim().slice(0, 500)
    }
  };
}

module.exports = { validateMobile, validateCity, validateAddress, parseRedeliveryContact };
